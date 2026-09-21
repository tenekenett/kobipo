"use client"

/**
 * Taranan DEKONTUN onay + kayıt kartı — para bize geldiyse TAHSİLAT (müşteri),
 * bizden çıktıysa ÖDEME (tedarikçi).
 *
 * Kayıt TEK istektir: `/api/finans/transactions` bir kasa/banka hareketi yazar
 * ve seçilen açık faturalara EN ESKİDEN dağıtır (dekont/to-payment.ts →
 * lib/cari/odeme-dagit.ts). Dekont bankada tek satır olduğu için burada da tek
 * hareket olmalı; faturalara sığmayan tutar cariye AVANS olarak kalır
 * (C1 kararı, 2026-09-21).
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/use-toast"
import { WriteAction } from "@/components/dashboard/write-guard"
import { useAccounts } from "@/lib/swr/use-company-data"
import { parseTrNumber } from "@/lib/format"
import type { Dekont } from "@/lib/belge-ocr/dekont/schema"
import { dekontDenetle, dekontYonu, ibanSade } from "@/lib/belge-ocr/dekont/validate"
import { dekontToIslem, type AcikFatura } from "@/lib/belge-ocr/dekont/to-payment"
import type { NormalBelge } from "@/lib/belge-ocr/sinif/normalize"
import { Alan, CariSecici, DenetimSeridi, EngelKutusu, KaydedildiKarti, KaynakRozeti, UyariListesi, hedefYaz, metin, mukerrerSor, tl, type MukerrerDurumu } from "./kabuk"
import { Loader2 } from "lucide-react"

type Form = { banka: string; islemTarihi: string; tutar: string; gonderenAd: string; gonderenIban: string; aliciAd: string; aliciIban: string; aciklama: string; referansNo: string }

const toForm = (d: Dekont): Form => ({
  banka: metin(d.banka),
  islemTarihi: metin(d.islemTarihi).slice(0, 10),
  tutar: metin(d.tutar),
  gonderenAd: metin(d.gonderenAd),
  gonderenIban: metin(d.gonderenIban),
  aliciAd: metin(d.aliciAd),
  aliciIban: metin(d.aliciIban),
  aciklama: metin(d.aciklama),
  referansNo: metin(d.referansNo),
})

const toDekont = (f: Form, o: Dekont): Dekont => ({
  ...o,
  banka: f.banka.trim() || null,
  islemTarihi: f.islemTarihi || null,
  tutar: parseTrNumber(f.tutar),
  gonderenAd: f.gonderenAd.trim() || null,
  gonderenIban: ibanSade(f.gonderenIban) || null,
  aliciAd: f.aliciAd.trim() || null,
  aliciIban: ibanSade(f.aliciIban) || null,
  aciklama: f.aciklama.trim() || null,
  referansNo: f.referansNo.trim() || null,
})

type Yon = "TAHSILAT" | "ODEME"

export function DekontOnayKarti({ scanId, index, dekont, yol, companyId }: { scanId: string | null; index: number; sinif: NormalBelge; dekont: Dekont; yol: string; companyId: string }) {
  const { toast } = useToast()
  const { accounts, mutate: mutateAccounts } = useAccounts(companyId)
  // "Bizim hesap" = kasa/banka kartlarındaki IBAN'lar; sunucu denetimi de aynı listeyle koştu.
  const bizimIbanlar = useMemo(() => accounts.map((a) => a.iban).filter((x): x is string => !!x), [accounts])
  const [form, setForm] = useState<Form>(() => toForm(dekont))
  const d = useMemo(() => toDekont(form, dekont), [form, dekont])
  const otomatikYon = dekontYonu(d, bizimIbanlar)
  const [yon, setYon] = useState<Yon>(() => (otomatikYon === "ODEME" ? "ODEME" : "TAHSILAT"))
  const [cariId, setCariId] = useState("")
  const [acikFaturalar, setAcikFaturalar] = useState<AcikFatura[]>([])
  const [secili, setSecili] = useState<Set<string>>(new Set())
  const [accountId, setAccountId] = useState("")
  const [ragmen, setRagmen] = useState(false)
  const [mukerrer, setMukerrer] = useState<MukerrerDurumu | null>(null)
  const [kaydediliyor, setKaydediliyor] = useState(false)
  const [kayit, setKayit] = useState<{ adet: number; toplam: number; avans: number } | null>(null)
  const [hata, setHata] = useState<string | null>(null)

  const denetimler = useMemo(() => dekontDenetle(d, { bizimIbanlar }), [d, bizimIbanlar])
  const karsiAd = yon === "TAHSILAT" ? form.gonderenAd : form.aliciAd
  // Yön değişince cari seçimi anlamını yitirir (tedarikçi id'si müşteri listesinde
  // yok). Sıfırlama YÖN DEĞİŞTİRME OLAYINDA, effect'te değil: `[yon]` effect'i
  // mount'ta da koşuyor ve CariSecici'nin aynı anda yaptığı VKN eşleşmesini
  // (onChange → id) siliyordu — çocuk effect'i "value hâlâ boş" gördüğü için bir
  // daha koşmuyor, kart "eşleşti" deyip seçili göstermiyordu (ölçüldü, çek kartı).
  const yonDegistir = useCallback((y: Yon) => {
    setYon(y)
    setCariId("")
    setSecili(new Set())
  }, [])

  // Bizim hesap: IBAN'ı belgeyle eşleşen kasa/banka kartı varsayılan olur.
  const bizimIban = ibanSade(yon === "TAHSILAT" ? d.aliciIban : d.gonderenIban)
  useEffect(() => {
    if (accountId || !bizimIban) return
    const a = accounts.find((x) => ibanSade(x.iban) === bizimIban)
    if (a) setAccountId(a.id)
  }, [accounts, bizimIban, accountId])

  useEffect(() => {
    if (!cariId) return setAcikFaturalar([])
    const qs = new URLSearchParams({ companyId, ...(yon === "TAHSILAT" ? { customerId: cariId } : { supplierId: cariId }) })
    fetch(`/api/cari/open-invoices?${qs}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((liste: Array<{ id: string; invoiceNo: string; date: string; openAmount: number }>) => {
        const f = (Array.isArray(liste) ? liste : []).map((x) => ({ id: x.id, invoiceNo: x.invoiceNo, date: String(x.date).slice(0, 10), kalan: Number(x.openAmount) }))
        setAcikFaturalar(f)
        // Varsayılan seçim: açıklamada numarası geçen fatura; yoksa tutarı tam tutan; yoksa en eskiden tutar dolana kadar.
        const tutar = d.tutar ?? 0
        const aciklama = (d.aciklama ?? "").toUpperCase()
        const anilan = f.filter((x) => x.invoiceNo && aciklama.includes(String(x.invoiceNo).toUpperCase()))
        if (anilan.length) return setSecili(new Set(anilan.map((x) => x.id)))
        const tam = f.find((x) => Math.abs(x.kalan - tutar) < 0.01)
        if (tam) return setSecili(new Set([tam.id]))
        const s = new Set<string>()
        let kalan = tutar
        for (const x of [...f].sort((a, b) => a.date.localeCompare(b.date))) {
          if (kalan <= 0) break
          s.add(x.id)
          kalan -= x.kalan
        }
        setSecili(s)
      })
      .catch(() => setAcikFaturalar([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cariId, companyId, yon])

  const donusum = useMemo(
    () => dekontToIslem(d, { companyId, yon, cariId, accountId, faturalar: acikFaturalar.filter((f) => secili.has(f.id)) }),
    [d, companyId, yon, cariId, accountId, acikFaturalar, secili]
  )
  const patlayan = denetimler.filter((x) => x.durum === "patladi")
  const agir = donusum.uyarilar.filter((u) => u.agir)
  const mukerrerAnahtari = `${d.referansNo}|${d.islemTarihi}|${d.tutar}`
  const gecerliMukerrer = mukerrer?.sorgu === mukerrerAnahtari ? mukerrer.kayit : null
  const kaydedilebilir = !!donusum.body && (!(patlayan.length || agir.length || gecerliMukerrer) || ragmen) && !kaydediliyor

  const kaydet = useCallback(async () => {
    setKaydediliyor(true)
    setHata(null)
    try {
      if (!(gecerliMukerrer && ragmen)) {
        const k = await mukerrerSor({ companyId, tur: "DEKONT", no: d.referansNo, date: d.islemTarihi, total: d.tutar != null ? String(d.tutar) : null })
        if (k) {
          setMukerrer({ sorgu: mukerrerAnahtari, kayit: k })
          setRagmen(false)
          setKaydediliyor(false)
          return
        }
      }
      if (!donusum.body) throw new Error("Kayıt için eksik bilgi var")
      // TEK istek: bir dekont = bir kasa/banka hareketi. Faturalara dağıtımı ve
      // artan tutarın avans kalmasını uç yapar (lib/cari/odeme-dagit.ts).
      const r = await fetch("/api/finans/transactions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(donusum.body) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.error || "Kayıt reddedildi")
      const adet = donusum.dagitim.length
      setKayit({ adet, toplam: donusum.body.amount, avans: donusum.avans })
      if (j?.id) await hedefYaz(scanId, index, "PAYMENT", String(j.id), d.referansNo)
      void mutateAccounts()
      toast({
        title: yon === "TAHSILAT" ? "Tahsilat kaydedildi" : "Ödeme kaydedildi",
        description: `${adet ? `${adet} fatura · ` : ""}${tl(donusum.body.amount)}${donusum.avans > 0 ? ` · ${tl(donusum.avans)} avans` : ""}`,
      })
    } catch (e: any) {
      setHata(e?.message || "Beklenmeyen hata")
    } finally {
      setKaydediliyor(false)
    }
  }, [gecerliMukerrer, ragmen, companyId, d, mukerrerAnahtari, donusum.body, donusum.dagitim.length, donusum.avans, scanId, index, mutateAccounts, toast, yon])

  if (kayit)
    return (
      <KaydedildiKarti
        baslik={`${index + 1}. Dekont · ${karsiAd || ""}`}
        aciklama={`${tl(kayit.toplam)} ${yon === "TAHSILAT" ? "tahsilat" : "ödeme"} yazıldı${kayit.adet ? ` — ${kayit.adet} faturaya dağıtıldı` : ""}${kayit.avans > 0 ? `, ${tl(kayit.avans)} cariye avans kaldı` : ""}`}
      />
    )

  const engelVar = patlayan.length > 0 || agir.length > 0 || !!gecerliMukerrer
  return (
    <Card className={engelVar ? "border-amber-400" : undefined}>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="text-base">{index + 1}. Dekont · {form.banka || "banka okunamadı"}</CardTitle>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="inline-flex overflow-hidden rounded-md border border-kobipo-border">
              {(["TAHSILAT", "ODEME"] as const).map((y) => (
                <button key={y} type="button" onClick={() => yonDegistir(y)} className={`px-3 py-1 font-semibold transition ${yon === y ? "bg-kobipo-blue text-white" : "bg-background text-muted-foreground hover:bg-kobipo-offwhite"}`}>
                  {y === "TAHSILAT" ? "Tahsilat (bize geldi)" : "Ödeme (biz gönderdik)"}
                </button>
              ))}
            </div>
            {otomatikYon === "BELIRSIZ" ? <span className="text-amber-700">IBAN&apos;lardan yön çıkmadı — seçin</span> : <span className="text-muted-foreground">IBAN eşleşmesinden</span>}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Dekont tutarı</div>
          <div className="text-lg font-bold tabular-nums">{tl(d.tutar)}</div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <DenetimSeridi denetimler={denetimler} ekRozetler={<KaynakRozeti yol={yol} />} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Alan etiket="Banka"><Input value={form.banka} onChange={(e) => setForm((x) => ({ ...x, banka: e.target.value }))} /></Alan>
          <Alan etiket="İşlem tarihi"><Input type="date" value={form.islemTarihi} onChange={(e) => setForm((x) => ({ ...x, islemTarihi: e.target.value }))} /></Alan>
          <Alan etiket="Tutar"><Input value={form.tutar} inputMode="decimal" onChange={(e) => setForm((x) => ({ ...x, tutar: e.target.value }))} className="tabular-nums font-semibold" /></Alan>
          <Alan etiket="Referans no"><Input value={form.referansNo} onChange={(e) => setForm((x) => ({ ...x, referansNo: e.target.value }))} /></Alan>
          <Alan etiket="Gönderen"><Input value={form.gonderenAd} onChange={(e) => setForm((x) => ({ ...x, gonderenAd: e.target.value }))} /></Alan>
          <Alan etiket="Gönderen IBAN"><Input value={form.gonderenIban} onChange={(e) => setForm((x) => ({ ...x, gonderenIban: e.target.value }))} className="font-mono text-xs" /></Alan>
          <Alan etiket="Alıcı"><Input value={form.aliciAd} onChange={(e) => setForm((x) => ({ ...x, aliciAd: e.target.value }))} /></Alan>
          <Alan etiket="Alıcı IBAN"><Input value={form.aliciIban} onChange={(e) => setForm((x) => ({ ...x, aliciIban: e.target.value }))} className="font-mono text-xs" /></Alan>
          <Alan etiket="Açıklama" className="sm:col-span-2 lg:col-span-4"><Input value={form.aciklama} onChange={(e) => setForm((x) => ({ ...x, aciklama: e.target.value }))} /></Alan>
        </div>

        <CariSecici companyId={companyId} kind={yon === "TAHSILAT" ? "customer" : "supplier"} vkn="" unvan={karsiAd} value={cariId} onChange={setCariId} zorunlu />

        {cariId && (
          <div className="rounded-md border border-kobipo-border p-3 text-sm">
            <div className="mb-1 text-xs font-medium text-muted-foreground">Açık faturalar — dekont seçilenlere en eskiden dağıtılır</div>
            {acikFaturalar.length === 0 ? (
              <p className="text-xs text-muted-foreground">Bu carinin açık faturası yok — tutarın tamamı cariye <strong>avans</strong> olarak yazılır.</p>
            ) : (
              acikFaturalar.map((f) => (
                <label key={f.id} className="flex items-center justify-between gap-2 py-0.5 text-xs">
                  <span className="flex items-center gap-2">
                    <input type="checkbox" className="h-4 w-4" checked={secili.has(f.id)} onChange={(e) => setSecili((s) => { const n = new Set(s); if (e.target.checked) n.add(f.id); else n.delete(f.id); return n })} />
                    {f.invoiceNo} · {new Date(f.date).toLocaleDateString("tr-TR")}
                  </span>
                  <span className="tabular-nums">açık {tl(f.kalan)}</span>
                </label>
              ))
            )}
            {donusum.dagitim.length > 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Dağıtım: {donusum.dagitim.map((o) => `${o.invoiceNo || "?"} ${tl(o.amount)}`).join(" · ")}
                {donusum.avans > 0 ? ` · avans ${tl(donusum.avans)}` : ""}
              </p>
            )}
          </div>
        )}

        <Alan etiket="Kasa / banka (zorunlu)" className="w-64">
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="h-9 w-full rounded-md border border-kobipo-border bg-background px-2 text-sm">
            <option value="">— seçin —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </Alan>

        <UyariListesi uyarilar={donusum.uyarilar} />
        {hata && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700 dark:bg-red-500/15 dark:text-red-300">{hata}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <EngelKutusu patlayan={patlayan.length} agir={agir.length} mukerrer={gecerliMukerrer ? <>Aynı ödeme kayıtlı görünüyor ({gecerliMukerrer.anahtar}): {gecerliMukerrer.no ?? gecerliMukerrer.id} · {tl(gecerliMukerrer.total)}</> : null} ragmen={ragmen} onRagmen={setRagmen} aciklama={<>Denetimler tutuyor. Tek {yon === "TAHSILAT" ? "tahsilat" : "ödeme"} hareketi yazılır{donusum.dagitim.length ? <>, <strong>{donusum.dagitim.length}</strong> faturaya dağıtılır</> : null}{donusum.avans > 0 ? <>, {tl(donusum.avans)} cariye <strong>avans</strong> kalır</> : null}.</>} />
          <WriteAction>
            <Button onClick={kaydet} disabled={!kaydedilebilir}>
              {kaydediliyor && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {yon === "TAHSILAT" ? "Tahsilat olarak kaydet" : "Ödeme olarak kaydet"}
            </Button>
          </WriteAction>
        </div>
      </CardContent>
    </Card>
  )
}
