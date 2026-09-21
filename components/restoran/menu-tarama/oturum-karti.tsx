"use client"

/**
 * Oturum kartı — FARK LİSTESİ ve satır satır kayıt (plan §3.4, §3.9, §3.10).
 *
 * Dört kova: YENİ (ürün oluştur) · FİYAT DEĞİŞMİŞ (fiyatı güncelle) · AYNI (bilgi)
 * · MENÜDE YOK (yalnız "tamamı" işaretliyse; isSellable=false).
 *
 * KAYIT KAPILARI mevcut uçlardır — ürün oluşturma mantığının ikinci kopyası yok:
 *   yeni ürün        → POST  /api/stok/products (KDV DAHİL fiyat + salePriceVatIncluded)
 *   varyant          → POST  /api/restoran/urun-secenekleri ("Boy" grubu, delta KDV DAHİL)
 *   fiyat            → PATCH /api/stok/products/[id] (salePrice, gerekirse vatRate)
 *   menüden kaldır   → PATCH /api/stok/products/[id] (isSellable=false)
 * Her yazma oturuma "hedef" izi olarak işlenir; tur bitince oturum SAVED olur.
 *
 * Ekranda gösterilen rakam KDV DAHİL (menüyle aynı); net küçük puntoyla yazar.
 * Kullanıcı satırda oranı değiştirince net yeniden hesaplanır (`netFiyat`).
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { CompanyLink } from "@/components/dashboard/company-link"
import { WriteAction } from "@/components/dashboard/write-guard"
import { DenetimSeridi, tl } from "@/components/alis/belge/kabuk"
import { useToast } from "@/components/ui/use-toast"
import { KDV_ORANLARI, netFiyat } from "@/lib/menu-ocr/fiyat"
import { KOVA_ETIKETI, MENU_HEDEF_ETIKETI, type FarkKovasi, type FarkSatiri, type MenuHedefi, type MenuOturumDetayi } from "@/lib/menu-ocr/turler"
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Loader2, Undo2 } from "lucide-react"

type SatirDuzeni = {
  secili: boolean
  kdvOrani: number
  grupAdi: string
  secenekAdlari: string[]
}

const KOVA_SIRASI: FarkKovasi[] = ["YENI", "FIYAT_DEGISMIS", "AYNI", "MENUDE_YOK"]
const KOVA_ACIKLAMA: Record<FarkKovasi, string> = {
  YENI: "Sistemde karşılığı yok; seçilenler satılabilir ürün olarak açılır (reçetesiz).",
  FIYAT_DEGISMIS: "Ad eşleşti, menüdeki fiyat farklı; seçilenlerin satış fiyatı güncellenir (ürünün kendi KDV oranıyla).",
  AYNI: "Ad ve fiyat eşleşiyor; dokunulmaz.",
  MENUDE_YOK: "Sistemde satılabilir ama bu menüde yok; seçilenler satış ekranından kaldırılır (silinmez).",
}

function varsayilanDuzen(f: FarkSatiri): SatirDuzeni {
  if (f.kova === "YENI") {
    return { secili: true, kdvOrani: f.oneri.kdvOrani, grupAdi: f.oneri.secenekGrubu?.ad ?? "", secenekAdlari: f.oneri.secenekGrubu?.secenekler.map((s) => s.ad) ?? [] }
  }
  if (f.kova === "FIYAT_DEGISMIS") return { secili: true, kdvOrani: f.kdvOrani, grupAdi: "", secenekAdlari: [] }
  // MENÜDE YOK: kapatmak gerçek hasar olabilir, varsayılan SEÇİLİ DEĞİL.
  return { secili: false, kdvOrani: 0, grupAdi: "", secenekAdlari: [] }
}

async function jsonIstek(url: string, init: RequestInit): Promise<any> {
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j?.error || `${r.status} ${r.statusText}`)
  return j
}

export function OturumKarti({ companyId, sessionId, yenilemeAnahtari, onDegisti }: { companyId: string; sessionId: string; /** Aynı oturuma dosya eklenince artar; kart yeniden okur (id değişmez) */ yenilemeAnahtari: number; onDegisti: () => void }) {
  const { toast } = useToast()
  const [detay, setDetay] = useState<MenuOturumDetayi | null>(null)
  const [yukleniyor, setYukleniyor] = useState(false)
  const [hata, setHata] = useState<string | null>(null)
  // Oturum ayarları: değişince fark listesi sunucudan yeniden kurulur.
  const [kdv, setKdv] = useState<number | null>(null)
  const [tamami, setTamami] = useState<boolean | null>(null)
  const [duzen, setDuzen] = useState<Record<string, SatirDuzeni>>({})
  const [acik, setAcik] = useState<Record<FarkKovasi, boolean>>({ YENI: true, FIYAT_DEGISMIS: true, AYNI: false, MENUDE_YOK: true })
  const [ilerleme, setIlerleme] = useState<{ yapilan: number; toplam: number; hatalar: string[] } | null>(null)
  const [geriAliniyor, setGeriAliniyor] = useState(false)

  const yukle = useCallback(async () => {
    setYukleniyor(true)
    setHata(null)
    try {
      const sp = new URLSearchParams({ companyId })
      if (kdv != null) sp.set("kdv", String(kdv))
      if (tamami != null) sp.set("tamami", tamami ? "1" : "0")
      const r = await fetch(`/api/restoran/menu-tarama/oturum/${encodeURIComponent(sessionId)}?${sp}`)
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.error || "Oturum alınamadı")
      const d = j as MenuOturumDetayi
      setDetay(d)
      if (kdv == null) setKdv(d.oturumKdv)
      if (tamami == null) setTamami(d.tamMenu)
      // Satır düzenleri korunur (kullanıcı oranı/adı değiştirmiş olabilir); yeni satırlar varsayılan alır.
      setDuzen((eski) => {
        const yeni: Record<string, SatirDuzeni> = {}
        for (const f of d.fark) yeni[f.anahtar] = eski[f.anahtar] ?? varsayilanDuzen(f)
        return yeni
      })
    } catch (e: any) {
      setHata(e?.message || "Oturum alınamadı")
    } finally {
      setYukleniyor(false)
    }
  }, [companyId, sessionId, kdv, tamami])

  // Oturum değişince ayarlar sıfırlanır ki başka menünün oranı taşınmasın.
  useEffect(() => {
    setKdv(null)
    setTamami(null)
    setDuzen({})
    setIlerleme(null)
  }, [sessionId])

  // `yenilemeAnahtari` bağımlılıkta ama gövdede yok: aynı oturuma yeni sayfa
  // eklendiğinde (id aynı) kart yeniden okusun diye — Chrome turunda 2. dosya
  // eklenince kart "1 dosya, 8 kalem"de kalmıştı.
  useEffect(() => {
    void yukle()
  }, [yukle, yenilemeAnahtari])

  const kaydedilen = useMemo(() => {
    const m = new Map<string, MenuHedefi[]>()
    for (const h of detay?.hedefler ?? []) {
      if (h.geriAlma) continue
      const l = m.get(h.anahtar) ?? []
      l.push(h)
      m.set(h.anahtar, l)
    }
    return m
  }, [detay])

  const kovaSatirlari = useMemo(() => {
    const g: Record<FarkKovasi, FarkSatiri[]> = { YENI: [], FIYAT_DEGISMIS: [], AYNI: [], MENUDE_YOK: [] }
    for (const f of detay?.fark ?? []) g[f.kova].push(f)
    return g
  }, [detay])

  const yazilabilir = (f: FarkSatiri) => f.kova !== "AYNI" && !kaydedilen.has(f.anahtar)
  const seciliSayisi = (detay?.fark ?? []).filter((f) => yazilabilir(f) && duzen[f.anahtar]?.secili).length

  const hepsiniSec = (kova: FarkKovasi, deger: boolean) =>
    setDuzen((d) => {
      const y = { ...d }
      for (const f of kovaSatirlari[kova]) if (yazilabilir(f) && y[f.anahtar]) y[f.anahtar] = { ...y[f.anahtar], secili: deger }
      return y
    })

  const satirDegistir = (anahtar: string, degisiklik: Partial<SatirDuzeni>) =>
    setDuzen((d) => ({ ...d, [anahtar]: { ...d[anahtar], ...degisiklik } }))

  const hedefYaz = async (h: Omit<MenuHedefi, "at">) => {
    await jsonIstek(`/api/restoran/menu-tarama/oturum/${encodeURIComponent(sessionId)}`, {
      method: "PATCH",
      body: JSON.stringify({ companyId, action: "hedef", ...h }),
    })
  }

  // Satır satır yazma (kullanıcı kararı): her satır ayrı istek, ekran n/N ilerleme.
  const kaydet = async () => {
    if (!detay) return
    const secilenler = detay.fark.filter((f) => yazilabilir(f) && duzen[f.anahtar]?.secili)
    if (secilenler.length === 0) return
    const hatalar: string[] = []
    setIlerleme({ yapilan: 0, toplam: secilenler.length, hatalar })
    let yapilan = 0
    for (const f of secilenler) {
      const d = duzen[f.anahtar]
      try {
        if (f.kova === "YENI") {
          const urun = await jsonIstek("/api/stok/products", {
            method: "POST",
            body: JSON.stringify({
              companyId,
              name: f.kalem.ad,
              category: f.oneri.kategori,
              unit: "ADET",
              vatRate: d.kdvOrani,
              // KDV DAHİL gönderilir; uç net'e çevirir (DB net saklar).
              salePrice: f.oneri.brut,
              salePriceVatIncluded: true,
              isSellable: true,
            }),
          })
          await hedefYaz({ anahtar: f.anahtar, type: "PRODUCT", id: urun.id, no: urun.name })
          const grup = f.oneri.secenekGrubu
          if (grup) {
            const g = await jsonIstek("/api/restoran/urun-secenekleri", {
              method: "POST",
              body: JSON.stringify({
                companyId,
                productId: urun.id,
                name: d.grupAdi.trim() || grup.ad,
                isRequired: true,
                options: grup.secenekler.map((s, i) => ({ name: d.secenekAdlari[i]?.trim() || s.ad, priceDelta: s.priceDelta, isDefault: s.isDefault })),
              }),
            })
            await hedefYaz({ anahtar: f.anahtar, type: "OPTION_GROUP", id: g.id, no: urun.name })
          }
        } else if (f.kova === "FIYAT_DEGISMIS") {
          const govde: Record<string, unknown> = { salePrice: f.yeniBrut, salePriceVatIncluded: true }
          // Oran yalnız kullanıcı DEĞİŞTİRDİYSE gider; aksi halde ürünün kendi oranı kalır (karar B).
          if (d.kdvOrani !== f.urun.vatRate) govde.vatRate = d.kdvOrani
          await jsonIstek(`/api/stok/products/${encodeURIComponent(f.urun.id)}?companyId=${encodeURIComponent(companyId)}`, { method: "PATCH", body: JSON.stringify(govde) })
          await hedefYaz({ anahtar: f.anahtar, type: "PRICE", id: f.urun.id, no: f.urun.name })
        } else if (f.kova === "MENUDE_YOK") {
          await jsonIstek(`/api/stok/products/${encodeURIComponent(f.urun.id)}?companyId=${encodeURIComponent(companyId)}`, { method: "PATCH", body: JSON.stringify({ isSellable: false }) })
          await hedefYaz({ anahtar: f.anahtar, type: "UNLISTED", id: f.urun.id, no: f.urun.name })
        }
      } catch (e: any) {
        const ad = f.kova === "MENUDE_YOK" ? f.urun.name : f.kalem.ad
        hatalar.push(`${ad}: ${e?.message || "yazılamadı"}`)
      }
      yapilan++
      setIlerleme({ yapilan, toplam: secilenler.length, hatalar: [...hatalar] })
    }
    try {
      await jsonIstek(`/api/restoran/menu-tarama/oturum/${encodeURIComponent(sessionId)}`, { method: "PATCH", body: JSON.stringify({ companyId, action: "tamamla" }) })
    } catch (e: any) {
      hatalar.push(`Oturum kapatılamadı: ${e?.message}`)
    }
    setIlerleme({ yapilan, toplam: secilenler.length, hatalar: [...hatalar] })
    toast({
      title: hatalar.length ? `${yapilan - hatalar.length}/${yapilan} satır yazıldı` : `${yapilan} satır yazıldı`,
      description: hatalar.length ? "Yazılamayan satırlar kartta listelendi." : "Ürünler Restoran & Kafe satış ekranında hazır.",
      variant: hatalar.length ? "destructive" : "default",
    })
    onDegisti()
    await yukle()
  }

  const reddet = async () => {
    try {
      await jsonIstek(`/api/restoran/menu-tarama/oturum/${encodeURIComponent(sessionId)}`, { method: "PATCH", body: JSON.stringify({ companyId, action: "reddet" }) })
      onDegisti()
      await yukle()
    } catch (e: any) {
      toast({ title: "Reddedilemedi", description: e?.message, variant: "destructive" })
    }
  }

  const geriAl = async () => {
    setGeriAliniyor(true)
    try {
      const j = await jsonIstek(`/api/restoran/menu-tarama/oturum/${encodeURIComponent(sessionId)}/geri-al`, { method: "POST", body: JSON.stringify({ companyId }) })
      const o = j.ozet as Record<string, number>
      toast({ title: "Tarama geri alındı", description: `${o.silindi} ürün silindi, ${o["menuden-kaldirildi"]} ürün satılmış olduğu için yalnız menüden kaldırıldı, ${o["geri-acildi"]} ürün menüye geri açıldı. Fiyat güncellemeleri geri alınmaz.` })
      // "14/14 yazıldı" artık geçersiz: satırlar yeniden YENİ'ye düştü.
      setIlerleme(null)
      onDegisti()
      await yukle()
    } catch (e: any) {
      toast({ title: "Geri alınamadı", description: e?.message, variant: "destructive" })
    } finally {
      setGeriAliniyor(false)
    }
  }

  if (hata) return <Card><CardContent className="p-6 text-sm text-red-700">{hata}</CardContent></Card>
  if (!detay) return <Card><CardContent className="p-6 text-sm text-muted-foreground">Yükleniyor…</CardContent></Card>

  const kaydedilmisHedef = (detay.hedefler ?? []).filter((h) => !h.geriAlma)
  const yeniSayisi = kovaSatirlari.YENI.filter((f) => yazilabilir(f) && duzen[f.anahtar]?.secili).length
  const kilitli = detay.status === "REJECTED" || ilerleme != null && ilerleme.yapilan < ilerleme.toplam

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">
              Menü okundu — {detay.dosyalar.length} dosya, {detay.dosyalar.reduce((a, d) => a + d.pageCount, 0)} sayfa, {detay.kalemler.length} kalem
            </CardTitle>
            <span className="text-xs text-muted-foreground">{new Date(detay.createdAt).toLocaleString("tr-TR")}</span>
          </div>
          <DenetimSeridi denetimler={detay.denetimler} />
          {detay.dosyalar.some((d) => d.status === "FAILED") && (
            <ul className="text-xs text-red-700">
              {detay.dosyalar.filter((d) => d.status === "FAILED").map((d) => <li key={d.id}>{d.fileName}: {d.error}</li>)}
            </ul>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              <span className="text-muted-foreground">Yeni ürünlerde KDV</span>
              <select value={kdv ?? detay.oturumKdv} onChange={(e) => setKdv(Number(e.target.value))} disabled={kilitli} className="h-8 rounded-md border border-kobipo-border bg-background px-2 text-sm">
                {KDV_ORANLARI.map((o) => <option key={o} value={o}>%{o}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={tamami ?? detay.tamMenu} onChange={(e) => setTamami(e.target.checked)} disabled={kilitli} className="h-4 w-4" />
              <span>Bu yüklenenler menünün <strong>tamamı</strong></span>
            </label>
            {yukleniyor && <Loader2 className="h-4 w-4 animate-spin text-kobipo-blue" />}
          </div>

          {!detay.menuyeBenziyor && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
              Bu dosyalar bir menüye benzemiyor (fiyatlı satır okunmadı). Ürün üretilmez; daha net bir fotoğraf yükleyin.
            </p>
          )}

          {yeniSayisi > 0 && (
            <p className="flex items-start gap-2 rounded-md bg-kobipo-offwhite px-3 py-2 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Oluşturulacak {yeniSayisi} ürün <strong>reçetesiz</strong> doğar: satışta stoktan düşmez. Reçeteyi{" "}
                <CompanyLink href="/restoran/menu" className="underline">Menü &amp; Reçeteler</CompanyLink> ekranından kurabilirsiniz.
              </span>
            </p>
          )}

          {KOVA_SIRASI.map((kova) => {
            const satirlar = kovaSatirlari[kova]
            if (kova === "MENUDE_YOK" && !(tamami ?? detay.tamMenu)) return null
            const secilebilir = satirlar.filter(yazilabilir)
            const hepsiSecili = secilebilir.length > 0 && secilebilir.every((f) => duzen[f.anahtar]?.secili)
            return (
              <div key={kova} className="rounded-lg border border-kobipo-border">
                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <button type="button" onClick={() => setAcik((a) => ({ ...a, [kova]: !a[kova] }))} className="flex items-center gap-2 text-sm font-semibold">
                    {acik[kova] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    {satirlar.length} {KOVA_ETIKETI[kova].toUpperCase()}
                  </button>
                  {kova !== "AYNI" && secilebilir.length > 0 && (
                    <WriteAction>
                      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" disabled={kilitli} onClick={() => hepsiniSec(kova, !hepsiSecili)}>
                        {hepsiSecili ? "seçimi kaldır" : "hepsini seç"}
                      </Button>
                    </WriteAction>
                  )}
                </div>
                {acik[kova] && (
                  <div className="border-t">
                    <p className="px-3 py-1.5 text-xs text-muted-foreground">{KOVA_ACIKLAMA[kova]}</p>
                    {satirlar.length === 0 && <p className="px-3 pb-3 text-xs text-muted-foreground">—</p>}
                    <ul className="divide-y">
                      {satirlar.map((f) => (
                        <FarkSatir key={f.anahtar} f={f} d={duzen[f.anahtar]} kaydedilen={kaydedilen.get(f.anahtar) ?? []} kilitli={kilitli} onDegistir={(x) => satirDegistir(f.anahtar, x)} />
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )
          })}

          {ilerleme && (
            <div className="space-y-1 text-sm">
              <p>
                {ilerleme.yapilan}/{ilerleme.toplam} yazıldı
                {ilerleme.yapilan < ilerleme.toplam && <Loader2 className="ml-2 inline h-4 w-4 animate-spin text-kobipo-blue" />}
              </p>
              {ilerleme.hatalar.length > 0 && (
                <ul className="space-y-0.5 text-xs text-red-700">{ilerleme.hatalar.map((h, i) => <li key={i}>{h}</li>)}</ul>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <WriteAction>
              <Button onClick={kaydet} disabled={kilitli || seciliSayisi === 0 || yukleniyor}>
                {seciliSayisi > 0 ? `${seciliSayisi} seçileni kaydet` : "Seçilenleri kaydet"}
              </Button>
            </WriteAction>
            {detay.status !== "SAVED" && detay.status !== "REJECTED" && (
              <WriteAction>
                <Button variant="outline" onClick={reddet} disabled={kilitli}>Reddet</Button>
              </WriteAction>
            )}
            {kaydedilmisHedef.length > 0 && (
              <WriteAction>
                <Button variant="outline" onClick={geriAl} disabled={geriAliniyor || kilitli}>
                  <Undo2 className="mr-2 h-4 w-4" />{geriAliniyor ? "Geri alınıyor…" : "Bu taramayı geri al"}
                </Button>
              </WriteAction>
            )}
          </div>

          {(detay.hedefler ?? []).length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground">Kayıt izleri ({detay.hedefler.length})</summary>
              <ul className="mt-1 space-y-0.5">
                {detay.hedefler.map((h, i) => (
                  <li key={i} className={h.geriAlma ? "text-muted-foreground line-through" : ""}>
                    {MENU_HEDEF_ETIKETI[h.type]} · {h.no ?? h.id} · {new Date(h.at).toLocaleString("tr-TR")}
                    {h.geriAlma ? ` — geri alındı (${h.geriAlma.sonuc})` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function FarkSatir({ f, d, kaydedilen, kilitli, onDegistir }: { f: FarkSatiri; d: SatirDuzeni | undefined; kaydedilen: MenuHedefi[]; kilitli: boolean; onDegistir: (x: Partial<SatirDuzeni>) => void }) {
  const yazildi = kaydedilen.length > 0
  const secilebilir = f.kova !== "AYNI" && !yazildi && d
  const oran = d?.kdvOrani ?? (f.kova === "YENI" ? f.oneri.kdvOrani : f.kova === "MENUDE_YOK" ? f.urun.vatRate : f.kova === "FIYAT_DEGISMIS" ? f.kdvOrani : f.urun.vatRate)
  const brut = f.kova === "YENI" ? f.oneri.brut : f.kova === "FIYAT_DEGISMIS" ? f.yeniBrut : null
  const net = brut == null ? null : netFiyat(brut, oran)
  const ad = f.kova === "MENUDE_YOK" ? f.urun.name : f.kalem.ad
  const bolum = f.kova === "MENUDE_YOK" ? f.urun.category : f.kalem.bolum
  const patlayan = f.denetimler.filter((x) => x.durum === "patladi")

  return (
    <li className={`flex flex-wrap items-start gap-3 px-3 py-2 text-sm ${patlayan.length ? "bg-red-50/40 dark:bg-red-500/5" : ""}`}>
      <div className="flex h-6 w-5 shrink-0 items-center">
        {secilebilir ? (
          <input type="checkbox" checked={d.secili} disabled={kilitli} onChange={(e) => onDegistir({ secili: e.target.checked })} className="h-4 w-4" />
        ) : yazildi ? (
          <CheckCircle2 className="h-4 w-4 text-kobipo-green-dark" />
        ) : null}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{ad}</span>
          {bolum && <span className="text-xs text-muted-foreground">{bolum}</span>}
          {f.kova !== "MENUDE_YOK" && f.kalem.fiyatlar.length > 1 && (
            <span className="text-xs text-muted-foreground">[{f.kalem.fiyatlar.map((p) => `${p.etiket ?? "?"} ${p.fiyat}`).join(" / ")}]</span>
          )}
          {yazildi && <span className="rounded-full bg-kobipo-green-light px-2 py-0.5 text-[11px] font-semibold text-kobipo-green-dark">{kaydedilen.map((h) => MENU_HEDEF_ETIKETI[h.type]).join(" + ")}</span>}
        </div>
        {f.kova !== "MENUDE_YOK" && f.kalem.aciklama && <p className="text-xs text-muted-foreground">{f.kalem.aciklama}</p>}
        {f.denetimler.length > 0 && <DenetimSeridi denetimler={f.denetimler} />}
        {f.kova === "YENI" && f.oneri.secenekGrubu && d && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted-foreground">Seçenek grubu</span>
            <Input value={d.grupAdi} disabled={kilitli || yazildi} onChange={(e) => onDegistir({ grupAdi: e.target.value })} className="h-7 w-24 text-xs" />
            {f.oneri.secenekGrubu.secenekler.map((s, i) => (
              <span key={i} className="flex items-center gap-1">
                <Input value={d.secenekAdlari[i] ?? s.ad} disabled={kilitli || yazildi} onChange={(e) => onDegistir({ secenekAdlari: d.secenekAdlari.map((x, j) => (j === i ? e.target.value : x)) })} className="h-7 w-24 text-xs" />
                <span className="text-muted-foreground">{s.priceDelta > 0 ? `+${tl(s.priceDelta)}` : "taban"}</span>
              </span>
            ))}
            {f.oneri.secenekGrubu.etiketTaninmadi && <span className="text-amber-800">adları düzeltin</span>}
          </div>
        )}
      </div>
      <div className="shrink-0 text-right">
        {f.kova === "FIYAT_DEGISMIS" && (
          <div className="text-xs text-muted-foreground">{f.eskiBrut == null ? "—" : tl(f.eskiBrut)} →</div>
        )}
        {brut != null && (
          <div className="font-semibold">{tl(brut)}</div>
        )}
        {f.kova === "AYNI" && <div className="font-semibold">{tl(f.kalem.fiyatlar[0].fiyat)}</div>}
        {f.kova === "MENUDE_YOK" && <div className="font-semibold">{f.urun.salePrice == null ? "—" : tl(f.urun.salePrice * (1 + f.urun.vatRate / 100))}</div>}
        {net != null && d && (
          <div className="flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
            net {net.toFixed(2)} ·
            <select value={oran} disabled={kilitli || yazildi} onChange={(e) => onDegistir({ kdvOrani: Number(e.target.value) })} className="h-5 rounded border border-kobipo-border bg-background px-1 text-[11px]">
              {KDV_ORANLARI.map((o) => <option key={o} value={o}>%{o}</option>)}
              {!(KDV_ORANLARI as readonly number[]).includes(oran) && <option value={oran}>%{oran}</option>}
            </select>
            {f.kova === "FIYAT_DEGISMIS" && <span title="Ürünün kendi oranı">(ürün)</span>}
          </div>
        )}
      </div>
    </li>
  )
}
