"use client"

/**
 * Taranan İRSALİYENİN onay + kayıt kartı — alış (tedarikçi, "Teslim alındı" ile
 * stok girer) ve satış (müşteri). Kayıt `/api/irsaliye` POST; teslim alındıysa
 * ardından PUT status DELIVERED (stok o zaman, BİR KEZ — stockProcessed).
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/use-toast"
import { WriteAction } from "@/components/dashboard/write-guard"
import { useRouteAccess } from "@/components/dashboard/dashboard-company-provider"
import { useProducts } from "@/lib/swr/use-company-data"
import { parseTrNumber } from "@/lib/format"
import type { Irsaliye } from "@/lib/belge-ocr/irsaliye/schema"
import { irsaliyeDenetle } from "@/lib/belge-ocr/irsaliye/validate"
import { irsaliyeToWaybillBody } from "@/lib/belge-ocr/irsaliye/to-waybill"
import { aliasAnahtari, kalemleriEsle, urunSozlugu } from "@/lib/belge-ocr/eslestir/alias"
import type { NormalBelge } from "@/lib/belge-ocr/sinif/normalize"
import type { Yon } from "@/lib/belge-ocr/turler"
import { Alan, CariSecici, DenetimSeridi, EngelKutusu, KaydedildiKarti, KaynakRozeti, UyariListesi, YonSecici, hedefYaz, metin, mukerrerSor, rakam, type MukerrerDurumu } from "./kabuk"
import { Loader2, Plus, Trash2 } from "lucide-react"

type SatirForm = { ad: string; saticiKodu: string; miktar: string; birim: string }
type Form = {
  saticiUnvan: string
  saticiVknTckn: string
  aliciUnvan: string
  aliciVknTckn: string
  irsaliyeNo: string
  duzenlemeTarihi: string
  sevkTarihi: string
  tasiyici: string
  plaka: string
  sofor: string
  sevkAdresi: string
  kalemler: SatirForm[]
}

const toForm = (i: Irsaliye): Form => ({
  saticiUnvan: metin(i.saticiUnvan),
  saticiVknTckn: metin(i.saticiVknTckn),
  aliciUnvan: metin(i.aliciUnvan),
  aliciVknTckn: metin(i.aliciVknTckn),
  irsaliyeNo: metin(i.irsaliyeNo),
  duzenlemeTarihi: metin(i.duzenlemeTarihi).slice(0, 10),
  sevkTarihi: metin(i.sevkTarihi).slice(0, 10),
  tasiyici: metin(i.tasiyici),
  plaka: metin(i.plaka),
  sofor: metin(i.sofor),
  sevkAdresi: metin(i.sevkAdresi),
  kalemler: i.kalemler.map((k) => ({ ad: metin(k.ad), saticiKodu: metin(k.saticiKodu), miktar: metin(k.miktar), birim: metin(k.birim) })),
})

const toIrsaliye = (form: Form, o: Irsaliye): Irsaliye => ({
  ...o,
  saticiUnvan: form.saticiUnvan.trim() || null,
  saticiVknTckn: rakam(form.saticiVknTckn) || null,
  aliciUnvan: form.aliciUnvan.trim() || null,
  aliciVknTckn: rakam(form.aliciVknTckn) || null,
  irsaliyeNo: form.irsaliyeNo.trim() || null,
  duzenlemeTarihi: form.duzenlemeTarihi || null,
  sevkTarihi: form.sevkTarihi || null,
  tasiyici: form.tasiyici.trim() || null,
  plaka: form.plaka.trim() || null,
  sofor: form.sofor.trim() || null,
  sevkAdresi: form.sevkAdresi.trim() || null,
  kalemler: form.kalemler.map((k) => ({ ad: k.ad, saticiKodu: k.saticiKodu.trim() || null, miktar: parseTrNumber(k.miktar), birim: k.birim.trim() || null })),
})

export function IrsaliyeOnayKarti({ scanId, index, sinif, irsaliye, yol, firmaVkn, companyId }: { scanId: string | null; index: number; sinif: NormalBelge; irsaliye: Irsaliye; yol: string; firmaVkn: string | null; companyId: string }) {
  const { toast } = useToast()
  const { products } = useProducts(companyId)
  const routeAccess = useRouteAccess()
  const [form, setForm] = useState<Form>(() => toForm(irsaliye))
  const [yon, setYon] = useState<Yon>(sinif.yon === "BELIRSIZ" ? "ALIS" : sinif.yon)
  const [cariId, setCariId] = useState("")
  const [urunSecimi, setUrunSecimi] = useState<Map<number, string>>(new Map())
  const [aliasHaritasi, setAliasHaritasi] = useState<Map<string, string>>(new Map())
  const [teslimAlindi, setTeslimAlindi] = useState(true)
  const [ragmen, setRagmen] = useState(false)
  const [mukerrer, setMukerrer] = useState<MukerrerDurumu | null>(null)
  const [kaydediliyor, setKaydediliyor] = useState(false)
  const [kayit, setKayit] = useState<{ id: string; waybillNo: string; teslim: boolean } | null>(null)
  const [hata, setHata] = useState<string | null>(null)

  const i = useMemo(() => toIrsaliye(form, irsaliye), [form, irsaliye])
  const denetimler = useMemo(() => irsaliyeDenetle(i, { firmaVkn, yon }), [i, firmaVkn, yon])
  const karsiVkn = rakam(yon === "SATIS" ? form.aliciVknTckn : form.saticiVknTckn)
  const karsiUnvan = yon === "SATIS" ? form.aliciUnvan : form.saticiUnvan
  // Yön değişince cari seçimi anlamını yitirir (tedarikçi id'si müşteri listesinde
  // yok). Sıfırlama YÖN DEĞİŞTİRME OLAYINDA, effect'te değil: `[yon]` effect'i
  // mount'ta da koşuyor ve CariSecici'nin aynı anda yaptığı VKN eşleşmesini
  // (onChange → id) siliyordu — çocuk effect'i "value hâlâ boş" gördüğü için bir
  // daha koşmuyor, kart "eşleşti" deyip seçili göstermiyordu (ölçüldü, çek kartı).
  const yonDegistir = useCallback((y: Yon) => {
    setYon(y)
    setCariId("")
  }, [])

  useEffect(() => {
    if (!cariId) return setAliasHaritasi(new Map())
    const keys = i.kalemler.map((k) => aliasAnahtari(k)?.key).filter(Boolean) as string[]
    if (!keys.length) return
    fetch(`/api/alis/belge-tarama/alias?${new URLSearchParams({ companyId, cariId, keys: keys.join("|") })}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((j) => setAliasHaritasi(new Map(Object.entries(j || {}))))
      .catch(() => setAliasHaritasi(new Map()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cariId, companyId])
  const otomatik = useMemo(() => kalemleriEsle(i.kalemler, aliasHaritasi, urunSozlugu(products)), [i.kalemler, aliasHaritasi, products])
  const urunEslesme = useMemo(() => {
    const m = new Map<number, string>()
    i.kalemler.forEach((_, idx) => {
      const secim = urunSecimi.get(idx)
      if (secim === "") return
      const id = secim ?? otomatik.get(idx)?.productId
      if (id) m.set(idx, id)
    })
    return m
  }, [i.kalemler, urunSecimi, otomatik])

  const donusum = useMemo(
    () => irsaliyeToWaybillBody(i, { companyId, yon, supplierId: yon === "ALIS" ? cariId : null, customerId: yon === "SATIS" ? cariId : null, urunEslesme, kaynak: yol === "xml" ? "UBL XML" : yol === "metin" ? "PDF" : "fotoğraf" }),
    [i, companyId, yon, cariId, urunEslesme, yol]
  )
  const patlayan = denetimler.filter((d) => d.durum === "patladi")
  const agir = donusum.uyarilar.filter((u) => u.agir)
  const mukerrerAnahtari = `${yon}|${cariId}|${i.irsaliyeNo}`
  const gecerliMukerrer = mukerrer?.sorgu === mukerrerAnahtari ? mukerrer.kayit : null
  const kaydedilebilir = donusum.body.items.length > 0 && !!cariId && (!(patlayan.length || agir.length || gecerliMukerrer) || ragmen) && !kaydediliyor

  const satirDegis = useCallback((idx: number, alan: keyof SatirForm, deger: string) => {
    setForm((x) => ({ ...x, kalemler: x.kalemler.map((k, j) => (j === idx ? { ...k, [alan]: deger } : k)) }))
  }, [])

  const kaydet = useCallback(async () => {
    setKaydediliyor(true)
    setHata(null)
    try {
      if (!(gecerliMukerrer && ragmen)) {
        const k = await mukerrerSor({ companyId, tur: "IRSALIYE", yon, no: i.irsaliyeNo, cariId })
        if (k) {
          setMukerrer({ sorgu: mukerrerAnahtari, kayit: k })
          setRagmen(false)
          setKaydediliyor(false)
          return
        }
      }
      const res = await fetch("/api/irsaliye", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(donusum.body) })
      const w = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(w?.error || "İrsaliye oluşturulamadı")
      let teslim = false
      if (teslimAlindi && yon === "ALIS") {
        const put = await fetch(`/api/irsaliye/${w.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId, status: "DELIVERED" }) })
        if (!put.ok) {
          const pe = await put.json().catch(() => ({}))
          toast({ title: "İrsaliye kaydedildi, teslim işaretlenemedi", description: pe?.error || "Alış İrsaliyesi ekranından 'Teslim alındı' yapın.", variant: "destructive" })
        } else teslim = true
      }
      setKayit({ id: w.id, waybillNo: w.waybillNo, teslim })
      await hedefYaz(scanId, index, "WAYBILL", w.id, w.waybillNo)
      if (cariId && urunEslesme.size > 0) {
        const eslesmeler = [...urunEslesme.entries()].map(([idx, productId]) => { const a = aliasAnahtari(i.kalemler[idx]); return a ? { key: a.key, label: a.label, productId } : null }).filter(Boolean)
        const ar = await fetch("/api/alis/belge-tarama/alias", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId, cariId, cariKind: yon === "SATIS" ? "CUSTOMER" : "SUPPLIER", eslesmeler }) })
        if (!ar.ok) toast({ title: "Ürün eşleşmeleri öğrenilemedi", variant: "destructive" })
      }
      toast({ title: yon === "SATIS" ? "Satış irsaliyesi kaydedildi" : teslim ? "Alış irsaliyesi kaydedildi, stok girdi" : "Alış irsaliyesi kaydedildi (taslak)", description: w.waybillNo })
    } catch (e: any) {
      setHata(e?.message || "Beklenmeyen hata")
    } finally {
      setKaydediliyor(false)
    }
  }, [gecerliMukerrer, ragmen, companyId, yon, i, cariId, mukerrerAnahtari, donusum.body, teslimAlindi, scanId, index, urunEslesme, toast])

  if (kayit) {
    const sayfa = yon === "SATIS" ? "/satis/irsaliye" : "/alis/irsaliye"
    return <KaydedildiKarti baslik={`${index + 1}. ${karsiUnvan || "İrsaliye"}`} aciklama={`${yon === "SATIS" ? "satış" : "alış"} irsaliyesi olarak kaydedildi — ${kayit.waybillNo}${kayit.teslim ? " · teslim alındı, stok girdi" : ""}`} href={routeAccess(sayfa) ? `${sayfa}?company=${encodeURIComponent(companyId)}` : null} hrefEtiketi="İrsaliyelere git" />
  }

  const engelVar = patlayan.length > 0 || agir.length > 0 || !!gecerliMukerrer
  return (
    <Card className={engelVar ? "border-amber-400" : undefined}>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">{index + 1}. İrsaliye · {karsiUnvan || "karşı taraf okunamadı"}</CardTitle>
        <YonSecici yon={yon} dayanak={sinif.yonDayanagi} onChange={yonDegistir} alisEtiketi="Alış (bize geldi)" satisEtiketi="Satış (biz sevk ettik)" />
      </CardHeader>
      <CardContent className="space-y-4">
        <DenetimSeridi denetimler={denetimler} ekRozetler={<KaynakRozeti yol={yol} />} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Alan etiket="Satıcı ünvanı"><Input value={form.saticiUnvan} onChange={(e) => setForm((x) => ({ ...x, saticiUnvan: e.target.value }))} /></Alan>
          <Alan etiket="Satıcı VKN/TCKN"><Input value={form.saticiVknTckn} inputMode="numeric" onChange={(e) => setForm((x) => ({ ...x, saticiVknTckn: e.target.value }))} /></Alan>
          <Alan etiket="Alıcı ünvanı"><Input value={form.aliciUnvan} onChange={(e) => setForm((x) => ({ ...x, aliciUnvan: e.target.value }))} /></Alan>
          <Alan etiket="Alıcı VKN/TCKN"><Input value={form.aliciVknTckn} inputMode="numeric" onChange={(e) => setForm((x) => ({ ...x, aliciVknTckn: e.target.value }))} /></Alan>
          <Alan etiket="İrsaliye no"><Input value={form.irsaliyeNo} onChange={(e) => setForm((x) => ({ ...x, irsaliyeNo: e.target.value }))} /></Alan>
          <Alan etiket="Düzenleme tarihi"><Input type="date" value={form.duzenlemeTarihi} onChange={(e) => setForm((x) => ({ ...x, duzenlemeTarihi: e.target.value }))} /></Alan>
          <Alan etiket="Sevk tarihi"><Input type="date" value={form.sevkTarihi} onChange={(e) => setForm((x) => ({ ...x, sevkTarihi: e.target.value }))} /></Alan>
          <Alan etiket="Plaka"><Input value={form.plaka} onChange={(e) => setForm((x) => ({ ...x, plaka: e.target.value }))} /></Alan>
          <Alan etiket="Taşıyıcı"><Input value={form.tasiyici} onChange={(e) => setForm((x) => ({ ...x, tasiyici: e.target.value }))} /></Alan>
          <Alan etiket="Şoför"><Input value={form.sofor} onChange={(e) => setForm((x) => ({ ...x, sofor: e.target.value }))} /></Alan>
          <Alan etiket="Sevk adresi" className="sm:col-span-2"><Input value={form.sevkAdresi} onChange={(e) => setForm((x) => ({ ...x, sevkAdresi: e.target.value }))} /></Alan>
        </div>

        <CariSecici companyId={companyId} kind={yon === "SATIS" ? "customer" : "supplier"} vkn={karsiVkn} unvan={karsiUnvan} value={cariId} onChange={setCariId} zorunlu />

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-1 pr-2 font-medium">Kalem</th>
                <th className="w-28 py-1 px-2 font-medium">Kod</th>
                <th className="w-24 py-1 px-2 font-medium">Miktar</th>
                <th className="w-20 py-1 px-2 font-medium">Birim</th>
                <th className="w-48 py-1 px-2 font-medium">Ürün kartı</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {form.kalemler.map((k, idx) => {
                const oto = otomatik.get(idx)
                const secili = urunEslesme.get(idx) ?? ""
                return (
                  <tr key={idx} className="border-b last:border-0">
                    <td className="py-1 pr-2"><Input value={k.ad} onChange={(e) => satirDegis(idx, "ad", e.target.value)} className="h-8" /></td>
                    <td className="py-1 px-2"><Input value={k.saticiKodu} onChange={(e) => satirDegis(idx, "saticiKodu", e.target.value)} className="h-8" /></td>
                    <td className="py-1 px-2"><Input value={k.miktar} inputMode="decimal" onChange={(e) => satirDegis(idx, "miktar", e.target.value)} className="h-8 tabular-nums" /></td>
                    <td className="py-1 px-2"><Input value={k.birim} onChange={(e) => satirDegis(idx, "birim", e.target.value)} className="h-8" /></td>
                    <td className="py-1 px-2">
                      <select value={secili} onChange={(e) => setUrunSecimi((m) => new Map(m).set(idx, e.target.value))} className="h-8 w-full rounded-md border border-kobipo-border bg-background px-1 text-xs">
                        <option value="">— eşleşme yok (stoğa girmez) —</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      {oto && secili === oto.productId && <span className="text-[10px] font-semibold text-kobipo-green-dark">{oto.kaynak === "alias" ? "öğrenilmiş" : "otomatik"}</span>}
                    </td>
                    <td className="py-1">
                      <button type="button" title="Satırı sil" onClick={() => setForm((x) => ({ ...x, kalemler: x.kalemler.filter((_, j) => j !== idx) }))} className="text-muted-foreground transition hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="outline" size="sm" onClick={() => setForm((x) => ({ ...x, kalemler: [...x.kalemler, { ad: "", saticiKodu: "", miktar: "1", birim: "ADET" }] }))}><Plus className="mr-2 h-4 w-4" />Satır ekle</Button>
          {yon === "ALIS" && (
            <label className="flex items-center gap-3 rounded-md border border-kobipo-border p-2 text-sm">
              <Switch checked={teslimAlindi} onCheckedChange={setTeslimAlindi} />
              <span>Teslim alındı <span className="block text-xs text-muted-foreground">Açıkken kayıt DELIVERED olur ve eşleşen {urunEslesme.size}/{form.kalemler.length} satır stoğa girer.</span></span>
            </label>
          )}
        </div>

        <UyariListesi uyarilar={donusum.uyarilar} />
        {hata && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700 dark:bg-red-500/15 dark:text-red-300">{hata}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <EngelKutusu patlayan={patlayan.length} agir={agir.length} mukerrer={gecerliMukerrer ? <>Aynı numaralı irsaliye kayıtlı: <strong>{gecerliMukerrer.no}</strong></> : null} ragmen={ragmen} onRagmen={setRagmen} aciklama={<>Denetimler tutuyor. Kayıt <strong>{yon === "SATIS" ? "satış" : "alış"} irsaliyesi</strong> olarak açılır.</>} />
          <WriteAction>
            <Button onClick={kaydet} disabled={!kaydedilebilir}>
              {kaydediliyor && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {yon === "SATIS" ? "Satış irsaliyesi olarak kaydet" : "Alış irsaliyesi olarak kaydet"}
            </Button>
          </WriteAction>
        </div>
      </CardContent>
    </Card>
  )
}
