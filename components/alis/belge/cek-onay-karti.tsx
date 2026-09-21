"use client"

/**
 * Taranan ÇEK / SENEDİN onay + kayıt kartı. Keşideci bizsek VERİLEN (tedarikçi),
 * lehtar bizsek ALINAN (müşteri). Kayıt `/api/cek-senet` POST — portföye
 * PORTFÖYDE durumuyla girer; tahsil/ciro işlemleri kendi ekranında.
 */

import { useCallback, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/use-toast"
import { WriteAction } from "@/components/dashboard/write-guard"
import { useRouteAccess } from "@/components/dashboard/dashboard-company-provider"
import { parseTrNumber } from "@/lib/format"
import type { CekSenet } from "@/lib/belge-ocr/cek/schema"
import { cekDenetle, cekToBody, cekTuruNormalize } from "@/lib/belge-ocr/cek/validate"
import type { NormalBelge } from "@/lib/belge-ocr/sinif/normalize"
import type { Yon } from "@/lib/belge-ocr/turler"
import { Alan, CariSecici, DenetimSeridi, EngelKutusu, KaydedildiKarti, KaynakRozeti, UyariListesi, YonSecici, hedefYaz, metin, mukerrerSor, rakam, tl, type MukerrerDurumu } from "./kabuk"
import { Loader2 } from "lucide-react"

type Form = { tur: "CEK" | "SENET"; banka: string; sube: string; hesapNo: string; seriNo: string; tutar: string; kesideTarihi: string; vadeTarihi: string; kesideci: string; kesideciVknTckn: string; lehtar: string; lehtarVknTckn: string; kesideYeri: string }

const toForm = (c: CekSenet): Form => ({
  tur: cekTuruNormalize(c.tur),
  banka: metin(c.banka),
  sube: metin(c.sube),
  hesapNo: metin(c.hesapNo),
  seriNo: metin(c.seriNo),
  tutar: metin(c.tutar),
  kesideTarihi: metin(c.kesideTarihi).slice(0, 10),
  vadeTarihi: metin(c.vadeTarihi).slice(0, 10),
  kesideci: metin(c.kesideci),
  kesideciVknTckn: metin(c.kesideciVknTckn),
  lehtar: metin(c.lehtar),
  lehtarVknTckn: metin(c.lehtarVknTckn),
  kesideYeri: metin(c.kesideYeri),
})

const toCek = (f: Form, o: CekSenet): CekSenet => ({
  ...o,
  tur: f.tur,
  banka: f.banka.trim() || null,
  sube: f.sube.trim() || null,
  hesapNo: f.hesapNo.trim() || null,
  seriNo: f.seriNo.trim() || null,
  tutar: parseTrNumber(f.tutar),
  kesideTarihi: f.kesideTarihi || null,
  vadeTarihi: f.vadeTarihi || null,
  kesideci: f.kesideci.trim() || null,
  kesideciVknTckn: rakam(f.kesideciVknTckn) || null,
  lehtar: f.lehtar.trim() || null,
  lehtarVknTckn: rakam(f.lehtarVknTckn) || null,
  kesideYeri: f.kesideYeri.trim() || null,
})

export function CekOnayKarti({ scanId, index, sinif, cek, yol, firmaVkn, companyId }: { scanId: string | null; index: number; sinif: NormalBelge; cek: CekSenet; yol: string; firmaVkn: string | null; companyId: string }) {
  const { toast } = useToast()
  const routeAccess = useRouteAccess()
  const [form, setForm] = useState<Form>(() => toForm(cek))
  // Çekte "SATIS" = keşideci biziz = VERİLEN; "ALIS" = lehtar biziz = ALINAN.
  const [yon, setYon] = useState<Yon>(sinif.yon === "BELIRSIZ" ? "ALIS" : sinif.yon)
  const [cariId, setCariId] = useState("")
  const [ragmen, setRagmen] = useState(false)
  const [mukerrer, setMukerrer] = useState<MukerrerDurumu | null>(null)
  const [kaydediliyor, setKaydediliyor] = useState(false)
  const [kayit, setKayit] = useState<{ id: string; no: string } | null>(null)
  const [hata, setHata] = useState<string | null>(null)

  const c = useMemo(() => toCek(form, cek), [form, cek])
  const denetimler = useMemo(() => cekDenetle(c, { firmaVkn, yon }), [c, firmaVkn, yon])
  // Yön değişince cari seçimi anlamını yitirir (tedarikçi id'si müşteri listesinde
  // yok). Sıfırlama YÖN DEĞİŞTİRME OLAYINDA, effect'te değil: `[yon]` effect'i
  // mount'ta da koşuyor ve CariSecici'nin aynı anda yaptığı VKN eşleşmesini
  // (onChange → id) siliyordu — çocuk effect'i "value hâlâ boş" gördüğü için bir
  // daha koşmuyor, kart "eşleşti" deyip seçili göstermiyordu (ölçüldü, çek kartı).
  const yonDegistir = useCallback((y: Yon) => {
    setYon(y)
    setCariId("")
  }, [])
  const verilen = yon === "SATIS"
  const karsiVkn = rakam(verilen ? form.lehtarVknTckn : form.kesideciVknTckn)
  const karsiUnvan = verilen ? form.lehtar : form.kesideci
  const donusum = useMemo(() => cekToBody(c, { companyId, yon, supplierId: verilen ? cariId : null, customerId: verilen ? null : cariId, kaynak: yol === "metin" ? "PDF" : "fotoğraf" }), [c, companyId, yon, verilen, cariId, yol])
  const patlayan = denetimler.filter((d) => d.durum === "patladi")
  const agir = donusum.uyarilar.filter((u) => u.agir)
  const mukerrerAnahtari = `${form.tur}|${c.seriNo}`
  const gecerliMukerrer = mukerrer?.sorgu === mukerrerAnahtari ? mukerrer.kayit : null
  const kaydedilebilir = !!c.seriNo && (c.tutar ?? 0) > 0 && (form.tur === "SENET" || !!c.banka) && (!(patlayan.length || agir.length || gecerliMukerrer) || ragmen) && !kaydediliyor

  const kaydet = useCallback(async () => {
    setKaydediliyor(true)
    setHata(null)
    try {
      if (!(gecerliMukerrer && ragmen)) {
        const k = await mukerrerSor({ companyId, tur: form.tur, no: c.seriNo })
        if (k) {
          setMukerrer({ sorgu: mukerrerAnahtari, kayit: k })
          setRagmen(false)
          setKaydediliyor(false)
          return
        }
      }
      const r = await fetch("/api/cek-senet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(donusum.body) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.error || "Kayıt oluşturulamadı")
      const no = j.checkNo ?? j.noteNo ?? c.seriNo ?? ""
      setKayit({ id: j.id, no })
      await hedefYaz(scanId, index, form.tur === "CEK" ? "CHECK" : "PROMISSORY_NOTE", j.id, no)
      toast({ title: `${form.tur === "CEK" ? "Çek" : "Senet"} portföye alındı`, description: `${no} · ${tl(c.tutar)} · ${verilen ? "verilen" : "alınan"}` })
    } catch (e: any) {
      setHata(e?.message || "Beklenmeyen hata")
    } finally {
      setKaydediliyor(false)
    }
  }, [gecerliMukerrer, ragmen, companyId, form.tur, c.seriNo, c.tutar, mukerrerAnahtari, donusum.body, scanId, index, toast, verilen])

  if (kayit) {
    const sayfa = form.tur === "CEK" ? "/cek-senet/cek" : "/cek-senet/senet"
    return <KaydedildiKarti baslik={`${index + 1}. ${form.tur === "CEK" ? "Çek" : "Senet"} · ${karsiUnvan || ""}`} aciklama={`${verilen ? "verilen" : "alınan"} olarak portföye alındı — ${kayit.no} · ${tl(c.tutar)}`} href={routeAccess(sayfa) ? `${sayfa}?company=${encodeURIComponent(companyId)}` : null} hrefEtiketi="Portföye git" />
  }

  const engelVar = patlayan.length > 0 || agir.length > 0 || !!gecerliMukerrer
  return (
    <Card className={engelVar ? "border-amber-400" : undefined}>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="text-base">
            {index + 1}. {form.tur === "CEK" ? "Çek" : "Senet"} · {karsiUnvan || "karşı taraf okunamadı"}
          </CardTitle>
          <YonSecici yon={yon} dayanak={sinif.yonDayanagi} onChange={yonDegistir} alisEtiketi="Alınan (lehtar biziz)" satisEtiketi="Verilen (keşideci biziz)" />
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Tutar</div>
          <div className="text-lg font-bold tabular-nums">{tl(c.tutar)}</div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <DenetimSeridi denetimler={denetimler} ekRozetler={<KaynakRozeti yol={yol} />} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Alan etiket="Tür">
            <select value={form.tur} onChange={(e) => setForm((x) => ({ ...x, tur: e.target.value === "SENET" ? "SENET" : "CEK" }))} className="h-9 w-full rounded-md border border-kobipo-border bg-background px-2 text-sm">
              <option value="CEK">Çek</option>
              <option value="SENET">Senet / bono</option>
            </select>
          </Alan>
          <Alan etiket={form.tur === "CEK" ? "Çek no" : "Senet no"}><Input value={form.seriNo} onChange={(e) => setForm((x) => ({ ...x, seriNo: e.target.value }))} /></Alan>
          <Alan etiket="Tutar"><Input value={form.tutar} inputMode="decimal" onChange={(e) => setForm((x) => ({ ...x, tutar: e.target.value }))} className="tabular-nums font-semibold" /></Alan>
          <Alan etiket="Vade"><Input type="date" value={form.vadeTarihi} onChange={(e) => setForm((x) => ({ ...x, vadeTarihi: e.target.value }))} /></Alan>
          <Alan etiket="Keşide tarihi"><Input type="date" value={form.kesideTarihi} onChange={(e) => setForm((x) => ({ ...x, kesideTarihi: e.target.value }))} /></Alan>
          {form.tur === "CEK" && (
            <>
              <Alan etiket="Banka"><Input value={form.banka} onChange={(e) => setForm((x) => ({ ...x, banka: e.target.value }))} /></Alan>
              <Alan etiket="Şube"><Input value={form.sube} onChange={(e) => setForm((x) => ({ ...x, sube: e.target.value }))} /></Alan>
              <Alan etiket="Hesap no"><Input value={form.hesapNo} onChange={(e) => setForm((x) => ({ ...x, hesapNo: e.target.value }))} /></Alan>
            </>
          )}
          <Alan etiket="Keşideci (ödeyecek)"><Input value={form.kesideci} onChange={(e) => setForm((x) => ({ ...x, kesideci: e.target.value }))} /></Alan>
          <Alan etiket="Keşideci VKN/TCKN"><Input value={form.kesideciVknTckn} inputMode="numeric" onChange={(e) => setForm((x) => ({ ...x, kesideciVknTckn: e.target.value }))} /></Alan>
          <Alan etiket="Lehtar (alacaklı)"><Input value={form.lehtar} onChange={(e) => setForm((x) => ({ ...x, lehtar: e.target.value }))} /></Alan>
          <Alan etiket="Lehtar VKN/TCKN"><Input value={form.lehtarVknTckn} inputMode="numeric" onChange={(e) => setForm((x) => ({ ...x, lehtarVknTckn: e.target.value }))} /></Alan>
          <Alan etiket="Keşide yeri"><Input value={form.kesideYeri} onChange={(e) => setForm((x) => ({ ...x, kesideYeri: e.target.value }))} /></Alan>
        </div>

        <CariSecici companyId={companyId} kind={verilen ? "supplier" : "customer"} vkn={karsiVkn} unvan={karsiUnvan} value={cariId} onChange={setCariId} />

        <UyariListesi uyarilar={donusum.uyarilar} />
        {hata && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700 dark:bg-red-500/15 dark:text-red-300">{hata}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <EngelKutusu patlayan={patlayan.length} agir={agir.length} mukerrer={gecerliMukerrer ? <>Aynı numaralı {form.tur === "CEK" ? "çek" : "senet"} portföyde: <strong>{gecerliMukerrer.no}</strong> · {tl(gecerliMukerrer.total)}</> : null} ragmen={ragmen} onRagmen={setRagmen} aciklama={<>Denetimler tutuyor. Portföye <strong>{verilen ? "verilen" : "alınan"}</strong> olarak girer{cariId ? "" : " — cari seçilmedi, ekstreye düşmez"}.</>} />
          <WriteAction>
            <Button onClick={kaydet} disabled={!kaydedilebilir}>
              {kaydediliyor && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Portföye kaydet
            </Button>
          </WriteAction>
        </div>
      </CardContent>
    </Card>
  )
}
