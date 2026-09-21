"use client"

/**
 * Taranan FATURANIN onay + kayıt kartı — alış (tedarikçi) ve satış (müşteri).
 *
 * Model çıktısı TASLAKTIR: her alan düzenlenebilir; düzeltme yapıldıkça
 * denetimler (fatura/validate.ts) ve kaydedilecek gövde (fatura/to-invoice.ts)
 * YENİDEN kurulur — ikisi de saf, sunucuyla aynı modül.
 *
 * KAYDI BU BİLEŞEN YAZMAZ: gövde `/api/e-donusum/invoices`e gider (fiş kartıyla
 * aynı kapı). Kaydın ardından: tarama satırına iz (hedefYaz), öğrenilen ürün
 * eşleşmeleri (alias), seçildiyse tahsilat/ödeme.
 *
 * İKİ KAPI kaydı tutar, tek onay kutusuyla aşılır: patlayan denetim / ağır
 * uyarı ve mükerrer (ETTN › cari+no › gün+tutar).
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/use-toast"
import { WriteAction } from "@/components/dashboard/write-guard"
import { useRouteAccess } from "@/components/dashboard/dashboard-company-provider"
import { useAccounts, useProducts, useWarehouses, type RefAccount } from "@/lib/swr/use-company-data"
import { defaultedAccountNote, withAccountNote } from "@/lib/finans/hesapsiz-odeme"
import { parseTrNumber } from "@/lib/format"
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type PaymentMethod } from "@/lib/satis/payment"
import type { Fatura, FaturaKalem } from "@/lib/belge-ocr/fatura/schema"
import { faturaDenetle } from "@/lib/belge-ocr/fatura/validate"
import { faturaToInvoiceBody } from "@/lib/belge-ocr/fatura/to-invoice"
import { aliasAnahtari, kalemleriEsle, urunSozlugu } from "@/lib/belge-ocr/eslestir/alias"
import type { GibKarekodu } from "@/lib/belge-ocr/girdi/karekod"
import type { NormalBelge } from "@/lib/belge-ocr/sinif/normalize"
import type { Yon } from "@/lib/belge-ocr/turler"
import {
  Alan,
  CariSecici,
  DenetimSeridi,
  EngelKutusu,
  KaydedildiKarti,
  KaynakRozeti,
  UyariListesi,
  YonSecici,
  hedefYaz,
  metin,
  mukerrerSor,
  rakam,
  tl,
  type MukerrerDurumu,
} from "./kabuk"
import { Loader2, Plus, Trash2 } from "lucide-react"

type SatirForm = { ad: string; saticiKodu: string; miktar: string; birim: string; birimFiyat: string; iskonto: string; kdvOrani: string; satirTutar: string }
type Form = {
  saticiUnvan: string
  saticiVknTckn: string
  aliciUnvan: string
  aliciVknTckn: string
  faturaNo: string
  tarih: string
  vade: string
  paraBirimi: string
  kalemler: SatirForm[]
  genelIskonto: string
  kdvsizEk: string
  odenecek: string
}

function toForm(f: Fatura): Form {
  return {
    saticiUnvan: metin(f.saticiUnvan),
    saticiVknTckn: metin(f.saticiVknTckn),
    aliciUnvan: metin(f.aliciUnvan),
    aliciVknTckn: metin(f.aliciVknTckn),
    faturaNo: metin(f.faturaNo),
    tarih: metin(f.tarih).slice(0, 10),
    vade: metin(f.vade).slice(0, 10),
    paraBirimi: metin(f.paraBirimi) || "TRY",
    kalemler: f.kalemler.map((k) => ({
      ad: metin(k.ad),
      saticiKodu: metin(k.saticiKodu),
      miktar: metin(k.miktar),
      birim: metin(k.birim),
      birimFiyat: metin(k.birimFiyat),
      iskonto: metin(k.iskontoTutar),
      kdvOrani: metin(k.kdvOrani),
      satirTutar: metin(k.satirTutar),
    })),
    genelIskonto: metin(f.genelIskonto),
    kdvsizEk: metin(f.kdvsizEk),
    odenecek: metin(f.odenecek),
  }
}

function toFatura(form: Form, orijinal: Fatura): Fatura {
  const kalemler: FaturaKalem[] = form.kalemler.map((k, i) => ({
    ad: k.ad,
    saticiKodu: k.saticiKodu.trim() || null,
    miktar: parseTrNumber(k.miktar),
    birim: k.birim.trim() || null,
    birimFiyat: parseTrNumber(k.birimFiyat),
    iskontoTutar: parseTrNumber(k.iskonto),
    kdvOrani: parseTrNumber(k.kdvOrani),
    kdvTutar: orijinal.kalemler[i]?.kdvTutar ?? null,
    satirTutar: parseTrNumber(k.satirTutar),
    tevkifatOrani: orijinal.kalemler[i]?.tevkifatOrani ?? null,
  }))
  return {
    ...orijinal,
    saticiUnvan: form.saticiUnvan.trim() || null,
    saticiVknTckn: rakam(form.saticiVknTckn) || null,
    aliciUnvan: form.aliciUnvan.trim() || null,
    aliciVknTckn: rakam(form.aliciVknTckn) || null,
    faturaNo: form.faturaNo.trim() || null,
    tarih: form.tarih || null,
    vade: form.vade || null,
    paraBirimi: form.paraBirimi.trim().toUpperCase() || "TRY",
    kalemler,
    genelIskonto: parseTrNumber(form.genelIskonto),
    kdvsizEk: parseTrNumber(form.kdvsizEk),
    odenecek: parseTrNumber(form.odenecek),
  }
}

function hesapSec(method: PaymentMethod, accounts: RefAccount[]): string {
  const bul = (t: string) => accounts.find((a) => a.type === t)?.id
  if (method === "CASH") return bul("CASH") ?? accounts[0]?.id ?? ""
  if (method === "CREDIT_CARD") return bul("CREDIT_CARD") ?? bul("POS") ?? bul("BANK") ?? accounts[0]?.id ?? ""
  return bul("BANK") ?? accounts.find((a) => a.type !== "CASH")?.id ?? accounts[0]?.id ?? ""
}

type Irsaliye = { id: string; waybillNo: string; supplierId: string | null; invoiceId: string | null; stockProcessed?: boolean; date: string }

export function FaturaOnayKarti({
  scanId,
  index,
  sinif,
  fatura,
  karekod,
  yol,
  firmaVkn,
  companyId,
}: {
  scanId: string | null
  index: number
  sinif: NormalBelge
  fatura: Fatura
  karekod: GibKarekodu | null
  yol: string
  firmaVkn: string | null
  companyId: string
}) {
  const { toast } = useToast()
  const { products } = useProducts(companyId)
  const { accounts, mutate: mutateAccounts } = useAccounts(companyId)
  const { warehouses } = useWarehouses(companyId)
  const faturaSayfasiAcilabilir = useRouteAccess()

  const [form, setForm] = useState<Form>(() => toForm(fatura))
  const [yon, setYon] = useState<Yon>(sinif.yon === "BELIRSIZ" ? "ALIS" : sinif.yon)
  const [cariId, setCariId] = useState("")
  const [urunSecimi, setUrunSecimi] = useState<Map<number, string>>(new Map())
  const [aliasHaritasi, setAliasHaritasi] = useState<Map<string, string>>(new Map())
  const [stogaIsle, setStogaIsle] = useState(false)
  const [irsaliyeler, setIrsaliyeler] = useState<Irsaliye[]>([])
  const [bagliIrsaliye, setBagliIrsaliye] = useState<Set<string>>(new Set())
  const [odemeSekli, setOdemeSekli] = useState<PaymentMethod | "ACIK_HESAP">("ACIK_HESAP")
  const [accountId, setAccountId] = useState("")
  const [ragmen, setRagmen] = useState(false)
  const [mukerrer, setMukerrer] = useState<MukerrerDurumu | null>(null)
  const [kaydediliyor, setKaydediliyor] = useState(false)
  const [kayit, setKayit] = useState<{ id: string; slug: string; invoiceNo: string; toplam: number } | null>(null)
  const [hata, setHata] = useState<string | null>(null)

  const f = useMemo(() => toFatura(form, fatura), [form, fatura])
  const denetimler = useMemo(() => faturaDenetle(f, { firmaVkn, yon, karekod }), [f, firmaVkn, yon, karekod])

  // Karşı taraf: alışta satıcı, satışta alıcı.
  const karsiVkn = rakam(yon === "SATIS" ? form.aliciVknTckn : form.saticiVknTckn)
  const karsiUnvan = yon === "SATIS" ? form.aliciUnvan : form.saticiUnvan
  const cariKind = yon === "SATIS" ? "customer" : "supplier"
  // Yön değişince cari seçimi anlamını yitirir (tedarikçi id'si müşteri listesinde
  // yok). Sıfırlama YÖN DEĞİŞTİRME OLAYINDA, effect'te değil: `[yon]` effect'i
  // mount'ta da koşuyor ve CariSecici'nin aynı anda yaptığı VKN eşleşmesini
  // (onChange → id) siliyordu — çocuk effect'i "value hâlâ boş" gördüğü için bir
  // daha koşmuyor, kart "eşleşti" deyip seçili göstermiyordu (ölçüldü, çek kartı).
  const yonDegistir = useCallback((y: Yon) => {
    setYon(y)
    setCariId("")
    setBagliIrsaliye(new Set())
  }, [])

  // Öğrenilmiş ürün eşleşmeleri (cari bazında) + yerel tam eşitlik.
  useEffect(() => {
    if (!cariId) {
      setAliasHaritasi(new Map())
      return
    }
    const keys = f.kalemler.map((k) => aliasAnahtari(k)?.key).filter(Boolean) as string[]
    if (keys.length === 0) return
    const qs = new URLSearchParams({ companyId, cariId, keys: keys.join("|") })
    fetch(`/api/alis/belge-tarama/alias?${qs}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((j) => setAliasHaritasi(new Map(Object.entries(j || {}))))
      .catch(() => setAliasHaritasi(new Map()))
    // Yalnız cari değişince: kalem adı düzeltildiğinde alias yeniden sorulmaz (kullanıcı seçer).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cariId, companyId])
  const otomatikEslesme = useMemo(() => kalemleriEsle(f.kalemler, aliasHaritasi, urunSozlugu(products)), [f.kalemler, aliasHaritasi, products])
  const urunEslesme = useMemo(() => {
    const m = new Map<number, string>()
    f.kalemler.forEach((_, i) => {
      const secim = urunSecimi.get(i)
      if (secim === "") return // kullanıcı bilerek boş bıraktı
      const id = secim ?? otomatikEslesme.get(i)?.productId
      if (id) m.set(i, id)
    })
    return m
  }, [f.kalemler, urunSecimi, otomatikEslesme])

  // İrsaliye bağlama (yalnız alış): belgede atıf varsa tedarikçinin faturasız irsaliyeleri.
  useEffect(() => {
    if (yon !== "ALIS" || !cariId || fatura.irsaliyeNoListesi.length === 0) {
      setIrsaliyeler([])
      return
    }
    fetch(`/api/irsaliye?companyId=${encodeURIComponent(companyId)}&type=PURCHASE`)
      .then((r) => (r.ok ? r.json() : []))
      .then((liste: Irsaliye[]) => {
        const noSet = new Set(fatura.irsaliyeNoListesi.map((n) => n.trim().toUpperCase()))
        const aday = (Array.isArray(liste) ? liste : []).filter((w) => w.supplierId === cariId && !w.invoiceId && noSet.has(String(w.waybillNo).trim().toUpperCase()))
        setIrsaliyeler(aday)
        setBagliIrsaliye(new Set(aday.map((w) => w.id)))
      })
      .catch(() => setIrsaliyeler([]))
  }, [yon, cariId, companyId, fatura.irsaliyeNoListesi])

  const varsayilanDepo = useMemo(() => warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]?.id, [warehouses])
  const donusum = useMemo(
    () =>
      faturaToInvoiceBody(f, {
        companyId,
        yon,
        supplierId: yon === "ALIS" ? cariId : null,
        customerId: yon === "SATIS" ? cariId : null,
        urunEslesme,
        warehouseId: stogaIsle ? varsayilanDepo : undefined,
        waybillIds: [...bagliIrsaliye],
        kaynak: yol === "xml" ? "UBL XML" : yol === "karekod+model" ? "e-belge PDF (karekod)" : yol === "metin" ? "PDF" : "fotoğraf",
      }),
    [f, companyId, yon, cariId, urunEslesme, stogaIsle, varsayilanDepo, bagliIrsaliye, yol]
  )
  const patlayan = denetimler.filter((d) => d.durum === "patladi")
  const agir = donusum.uyarilar.filter((u) => u.agir)
  const mukerrerAnahtari = `${yon}|${cariId}|${f.faturaNo}|${f.ettn}|${donusum.body.date}|${donusum.beklenenToplam}`
  const gecerliMukerrer = mukerrer?.sorgu === mukerrerAnahtari ? mukerrer.kayit : null
  const kaydedilebilir = donusum.body.items.length > 0 && (!(patlayan.length || agir.length || gecerliMukerrer) || ragmen) && !kaydediliyor

  useEffect(() => {
    if (odemeSekli === "ACIK_HESAP" || accounts.length === 0) return
    setAccountId((mevcut) => mevcut || hesapSec(odemeSekli, accounts))
  }, [odemeSekli, accounts])

  const satirDegis = useCallback((i: number, alan: keyof SatirForm, deger: string) => {
    setForm((x) => ({ ...x, kalemler: x.kalemler.map((k, j) => (j === i ? { ...k, [alan]: deger } : k)) }))
  }, [])

  const kaydet = useCallback(async () => {
    setKaydediliyor(true)
    setHata(null)
    try {
      // 1) Mükerrer — ekranda görülmeden onay kutusu onu aşamaz.
      if (!(gecerliMukerrer && ragmen)) {
        const kayit = await mukerrerSor({ companyId, tur: "FATURA", yon, no: f.faturaNo, ettn: f.ettn, cariId, date: donusum.body.date, total: String(donusum.beklenenToplam) })
        if (kayit) {
          setMukerrer({ sorgu: mukerrerAnahtari, kayit })
          setRagmen(false)
          setKaydediliyor(false)
          return
        }
      }
      // 2) Faturayı kes.
      const res = await fetch("/api/e-donusum/invoices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(donusum.body) })
      const inv = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(inv?.error || "Fatura oluşturulamadı")
      if (inv?.stockWarning) toast({ title: "Stok güncellenemedi", description: String(inv.stockWarning), variant: "destructive" })
      const toplam = inv?.totalAmount != null ? Number(inv.totalAmount) : donusum.beklenenToplam
      setKayit({ id: inv.id, slug: inv.slug || inv.id, invoiceNo: inv.invoiceNo, toplam })

      // 3) İz + öğrenme. İkisi de kaydın parçası değil; hata verirse fatura duruyor, söylenir.
      await hedefYaz(scanId, index, "INVOICE", inv.id, inv.invoiceNo, inv.slug)
      if (cariId && urunEslesme.size > 0) {
        const eslesmeler = [...urunEslesme.entries()]
          .map(([i, productId]) => {
            const a = aliasAnahtari(f.kalemler[i])
            return a ? { key: a.key, label: a.label, productId } : null
          })
          .filter(Boolean)
        const ar = await fetch("/api/alis/belge-tarama/alias", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId, cariId, cariKind: yon === "SATIS" ? "CUSTOMER" : "SUPPLIER", eslesmeler }) })
        if (!ar.ok) toast({ title: "Ürün eşleşmeleri öğrenilemedi", description: "Fatura kaydedildi; bir sonraki belgede eşleşme yeniden sorulacak.", variant: "destructive" })
      }

      // 4) Tahsilat / ödeme (isteğe bağlı) — tutar SUNUCUDA KAYITLI toplam.
      let accountNote: string | null = null
      if (odemeSekli !== "ACIK_HESAP" && toplam > 0) {
        const payRes = await fetch("/api/faturalar/odemeler", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invoiceId: inv.id, companyId, amount: toplam, paymentMethod: odemeSekli, accountId: accountId || undefined, paymentDate: new Date().toISOString() }),
        })
        if (!payRes.ok) {
          const payErr = await payRes.json().catch(() => ({}))
          toast({ title: "Fatura oluştu, ödeme kaydedilemedi", description: payErr?.error || "Ödemeyi fatura ekranından tamamlayın", variant: "destructive" })
          return
        }
        accountNote = defaultedAccountNote([await payRes.json().catch(() => null)])
        if (accountNote) void mutateAccounts()
      }
      toast({ title: yon === "SATIS" ? "Satış faturası kaydedildi" : "Alış faturası kaydedildi", description: withAccountNote(`${inv.invoiceNo} · ${tl(toplam)}`, accountNote) })
    } catch (e: any) {
      setHata(e?.message || "Beklenmeyen hata")
    } finally {
      setKaydediliyor(false)
    }
  }, [gecerliMukerrer, ragmen, companyId, yon, f, cariId, donusum, mukerrerAnahtari, scanId, index, urunEslesme, odemeSekli, accountId, toast, mutateAccounts])

  if (kayit) {
    const href = faturaSayfasiAcilabilir(yon === "SATIS" ? "/satis/fatura" : "/alis/fatura") ? `/${yon === "SATIS" ? "satis" : "alis"}/fatura?company=${encodeURIComponent(companyId)}` : null
    return <KaydedildiKarti baslik={`${index + 1}. ${karsiUnvan || "Fatura"}`} aciklama={`${yon === "SATIS" ? "satış" : "alış"} faturası olarak kaydedildi — ${kayit.invoiceNo} · ${tl(kayit.toplam)}`} href={href} hrefEtiketi="Faturalara git" />
  }

  const engelVar = patlayan.length > 0 || agir.length > 0 || !!gecerliMukerrer
  return (
    <Card className={engelVar ? "border-amber-400" : undefined}>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="text-base">
            {index + 1}. Fatura · {karsiUnvan || "karşı taraf okunamadı"}
          </CardTitle>
          <YonSecici yon={yon} dayanak={sinif.yonDayanagi} onChange={yonDegistir} alisEtiketi="Alış (tedarikçi kesti)" satisEtiketi="Satış (biz kestik)" />
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Kaydedilecek tutar</div>
          <div className="text-lg font-bold tabular-nums">{tl(donusum.beklenenToplam)}</div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <DenetimSeridi denetimler={denetimler} ekRozetler={<KaynakRozeti yol={yol} />} />
        {sinif.yabanci && (
          <p className="rounded-md bg-red-50 p-2 text-xs text-red-700 dark:bg-red-500/15 dark:text-red-300">
            Belgedeki iki VKN de bu firmaya ait değil — belge <strong>başka bir firmaya</strong> kesilmiş olabilir. Doğru firmayı seçip yeniden yükleyin ya da VKN&apos;yi düzeltin.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Alan etiket="Satıcı ünvanı"><Input value={form.saticiUnvan} onChange={(e) => setForm((x) => ({ ...x, saticiUnvan: e.target.value }))} /></Alan>
          <Alan etiket="Satıcı VKN/TCKN"><Input value={form.saticiVknTckn} inputMode="numeric" onChange={(e) => setForm((x) => ({ ...x, saticiVknTckn: e.target.value }))} /></Alan>
          <Alan etiket="Alıcı ünvanı"><Input value={form.aliciUnvan} onChange={(e) => setForm((x) => ({ ...x, aliciUnvan: e.target.value }))} /></Alan>
          <Alan etiket="Alıcı VKN/TCKN"><Input value={form.aliciVknTckn} inputMode="numeric" onChange={(e) => setForm((x) => ({ ...x, aliciVknTckn: e.target.value }))} /></Alan>
          <Alan etiket="Fatura no"><Input value={form.faturaNo} onChange={(e) => setForm((x) => ({ ...x, faturaNo: e.target.value }))} /></Alan>
          <Alan etiket="Tarih"><Input type="date" value={form.tarih} onChange={(e) => setForm((x) => ({ ...x, tarih: e.target.value }))} /></Alan>
          <Alan etiket="Vade"><Input type="date" value={form.vade} onChange={(e) => setForm((x) => ({ ...x, vade: e.target.value }))} /></Alan>
          <Alan etiket="Para birimi"><Input value={form.paraBirimi} onChange={(e) => setForm((x) => ({ ...x, paraBirimi: e.target.value }))} /></Alan>
        </div>
        {(fatura.ettn || fatura.senaryo) && (
          <p className="text-xs text-muted-foreground">
            {fatura.senaryo && <span className="mr-3">Senaryo: {fatura.senaryo}{fatura.tip ? ` / ${fatura.tip}` : ""}</span>}
            {fatura.ettn && <span className="font-mono">ETTN {fatura.ettn}</span>}
            {karekod && <span className="ml-3 font-semibold text-kobipo-blue">başlık karekodla çapraz denetlendi</span>}
          </p>
        )}

        <CariSecici companyId={companyId} kind={cariKind} vkn={karsiVkn} unvan={karsiUnvan} value={cariId} onChange={setCariId} />

        {/* ---------------------------------------------------------- kalemler */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-1 pr-2 font-medium">Kalem</th>
                <th className="w-24 py-1 px-2 font-medium">Kod</th>
                <th className="w-20 py-1 px-2 font-medium">Miktar</th>
                <th className="w-16 py-1 px-2 font-medium">Birim</th>
                <th className="w-28 py-1 px-2 font-medium">Birim fiyat (hariç)</th>
                <th className="w-24 py-1 px-2 font-medium">İskonto</th>
                <th className="w-16 py-1 px-2 font-medium">KDV %</th>
                <th className="w-28 py-1 px-2 font-medium">Satır net</th>
                <th className="w-44 py-1 px-2 font-medium">Ürün kartı</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {form.kalemler.map((k, i) => {
                const oto = otomatikEslesme.get(i)
                const secili = urunEslesme.get(i) ?? ""
                return (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1 pr-2"><Input value={k.ad} onChange={(e) => satirDegis(i, "ad", e.target.value)} className="h-8" /></td>
                    <td className="py-1 px-2"><Input value={k.saticiKodu} onChange={(e) => satirDegis(i, "saticiKodu", e.target.value)} className="h-8" /></td>
                    <td className="py-1 px-2"><Input value={k.miktar} inputMode="decimal" onChange={(e) => satirDegis(i, "miktar", e.target.value)} className="h-8 tabular-nums" /></td>
                    <td className="py-1 px-2"><Input value={k.birim} onChange={(e) => satirDegis(i, "birim", e.target.value)} className="h-8" /></td>
                    <td className="py-1 px-2"><Input value={k.birimFiyat} inputMode="decimal" onChange={(e) => satirDegis(i, "birimFiyat", e.target.value)} className="h-8 tabular-nums" /></td>
                    <td className="py-1 px-2"><Input value={k.iskonto} inputMode="decimal" onChange={(e) => satirDegis(i, "iskonto", e.target.value)} className="h-8 tabular-nums" /></td>
                    <td className="py-1 px-2"><Input value={k.kdvOrani} inputMode="decimal" onChange={(e) => satirDegis(i, "kdvOrani", e.target.value)} className="h-8 tabular-nums" /></td>
                    <td className="py-1 px-2"><Input value={k.satirTutar} inputMode="decimal" onChange={(e) => satirDegis(i, "satirTutar", e.target.value)} className="h-8 tabular-nums" /></td>
                    <td className="py-1 px-2">
                      <select
                        value={secili}
                        onChange={(e) => setUrunSecimi((m) => new Map(m).set(i, e.target.value))}
                        className="h-8 w-full rounded-md border border-kobipo-border bg-background px-1 text-xs"
                        title={oto ? (oto.kaynak === "alias" ? "Öğrenilmiş eşleşme" : oto.kaynak === "kod" ? "Kod eşleşti" : "Ad eşleşti") : "Eşleşmedi — seçerseniz öğrenilir"}
                      >
                        <option value="">— eşleşme yok —</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      {oto && secili === oto.productId && <span className="text-[10px] font-semibold text-kobipo-green-dark">{oto.kaynak === "alias" ? "öğrenilmiş" : "otomatik"}</span>}
                    </td>
                    <td className="py-1">
                      <button type="button" title="Satırı sil" onClick={() => setForm((x) => ({ ...x, kalemler: x.kalemler.filter((_, j) => j !== i) }))} className="text-muted-foreground transition hover:text-red-600">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-3">
          <Button variant="outline" size="sm" onClick={() => setForm((x) => ({ ...x, kalemler: [...x.kalemler, { ad: "", saticiKodu: "", miktar: "1", birim: "ADET", birimFiyat: "", iskonto: "", kdvOrani: "20", satirTutar: "" }] }))}>
            <Plus className="mr-2 h-4 w-4" />Satır ekle
          </Button>
          <div className="flex flex-wrap items-end gap-3">
            <Alan etiket="Genel iskonto" className="w-28"><Input value={form.genelIskonto} inputMode="decimal" onChange={(e) => setForm((x) => ({ ...x, genelIskonto: e.target.value }))} className="tabular-nums" /></Alan>
            <Alan etiket="KDV'siz ek" className="w-28"><Input value={form.kdvsizEk} inputMode="decimal" onChange={(e) => setForm((x) => ({ ...x, kdvsizEk: e.target.value }))} className="tabular-nums" /></Alan>
            <Alan etiket="Ödenecek (belgede)" className="w-32"><Input value={form.odenecek} inputMode="decimal" onChange={(e) => setForm((x) => ({ ...x, odenecek: e.target.value }))} className="tabular-nums font-semibold" /></Alan>
          </div>
        </div>

        {/* ---------------------------------------------------- stok / irsaliye */}
        {yon === "ALIS" && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex items-center gap-3 rounded-md border border-kobipo-border p-3 text-sm">
              <Switch checked={stogaIsle} onCheckedChange={setStogaIsle} disabled={bagliIrsaliye.size > 0} />
              <span>
                Kalemleri stoğa işle
                <span className="block text-xs text-muted-foreground">
                  {bagliIrsaliye.size > 0
                    ? "Bağlanan irsaliye stoğu zaten girdi; fatura stoğu atlanır."
                    : `${urunEslesme.size}/${form.kalemler.length} satır ürün kartıyla eşleşti; yalnız eşleşenler stoğa girer.`}
                </span>
              </span>
            </label>
            {irsaliyeler.length > 0 && (
              <div className="rounded-md border border-kobipo-border p-3 text-sm">
                <div className="text-xs font-medium text-muted-foreground">Belgede atıf yapılan irsaliyeler</div>
                {irsaliyeler.map((w) => (
                  <label key={w.id} className="mt-1 flex items-center gap-2 text-xs">
                    <input type="checkbox" className="h-4 w-4" checked={bagliIrsaliye.has(w.id)} onChange={(e) => setBagliIrsaliye((s) => { const n = new Set(s); if (e.target.checked) n.add(w.id); else n.delete(w.id); return n })} />
                    {w.waybillNo} · {new Date(w.date).toLocaleDateString("tr-TR")}{w.stockProcessed ? " · stoğa işlenmiş" : ""}
                  </label>
                ))}
                <p className="mt-1 text-[11px] text-muted-foreground">Bağlanan irsaliyenin stoğu faturada ikinci kez girilmez.</p>
              </div>
            )}
          </div>
        )}

        {/* ------------------------------------------------------------- ödeme */}
        <div className="flex flex-wrap items-end gap-3 rounded-md border border-kobipo-border p-3">
          <Alan etiket={yon === "SATIS" ? "Tahsilat" : "Ödeme"} className="w-48">
            <select value={odemeSekli} onChange={(e) => setOdemeSekli(e.target.value as PaymentMethod | "ACIK_HESAP")} className="h-9 w-full rounded-md border border-kobipo-border bg-background px-2 text-sm">
              <option value="ACIK_HESAP">Açık hesap (şimdi yok)</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>
              ))}
            </select>
          </Alan>
          {odemeSekli !== "ACIK_HESAP" && (
            <Alan etiket="Kasa / banka" className="w-56">
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="h-9 w-full rounded-md border border-kobipo-border bg-background px-2 text-sm">
                <option value="">— varsayılan —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </Alan>
          )}
        </div>

        <UyariListesi uyarilar={donusum.uyarilar} />
        {hata && <p className="rounded-md bg-red-50 p-2 text-sm text-red-700 dark:bg-red-500/15 dark:text-red-300">{hata}</p>}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <EngelKutusu
            patlayan={patlayan.length}
            agir={agir.length}
            mukerrer={gecerliMukerrer ? <>Aynı belge kayıtlı görünüyor: <strong>{gecerliMukerrer.no ?? gecerliMukerrer.id}</strong>{gecerliMukerrer.total != null ? ` · ${tl(gecerliMukerrer.total)}` : ""} ({gecerliMukerrer.anahtar})</> : null}
            ragmen={ragmen}
            onRagmen={setRagmen}
            aciklama={<>Denetimler tutuyor. Kayıt <strong>{yon === "SATIS" ? "satış" : "alış"} faturası</strong> olarak açılır{cariId ? "" : " — cari seçilmedi, ekstreye düşmez"}.</>}
          />
          <WriteAction>
            <Button onClick={kaydet} disabled={!kaydedilebilir}>
              {kaydediliyor && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {yon === "SATIS" ? "Satış faturası olarak kaydet" : "Alış faturası olarak kaydet"}
            </Button>
          </WriteAction>
        </div>
      </CardContent>
    </Card>
  )
}
