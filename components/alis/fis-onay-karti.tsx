"use client"

/**
 * Taranan TEK fişin onay + kayıt kartı.
 *
 * Model çıktısı burada "sonuç" değil TASLAKTIR: her alan düzenlenebilir ve
 * düzeltme yapıldıkça denetimler ile kaydedilecek tutar YENİDEN hesaplanır.
 * Denetimlerin saf olması (lib/fis-ocr/validate.ts) bunu mümkün kılıyor —
 * sunucuya sormadan, kullanıcı yazarken.
 *
 * KAYDI BU BİLEŞEN YAZMAZ: gövde `fisToInvoiceBody` ile kurulur ve Hızlı Alış'ın
 * kullandığı `/api/e-donusum/invoices` ucuna gider. Fiş kesme mantığının (numara
 * serisi, stok, cari, kota) ikinci bir kopyası açılmıyor. Toplamları da sunucu
 * kendi hesaplar; buradaki "kaydedilecek tutar" yalnız ÖNİZLEMEDİR ve aynı
 * modülden (lib/invoice/line-tax.ts) türetildiği için sunucuyla ayrışmaz.
 *
 * İKİ KAPI kaydı tutar ve ikisi de tek bir onay kutusuyla aşılabilir — engellemek
 * değil, körlemesine kaydettirmemek amaç:
 *   1. Patlayan denetim / ağır dönüşüm uyarısı.
 *   2. Mükerrer kayıt (aynı tedarikçi + gün + tutar).
 *
 * TEDARİKÇİ ZORUNLU DEĞİL. Bir süre öyleydi (gerekçe: VKN checksum'ı bir elek,
 * gerçek emniyet cari eşleşmesidir) ama bu, doğrulama GÜVENİNE dair bir argüman —
 * kaydın geçerliliğine dair değil. `Invoice.supplierId` nullable ve Hızlı Alış da
 * tedarikçisiz fiş kesiyor; fiş taramayı tek istisna yapmak tutarsızdı. Uyarı
 * duruyor, kilit kalktı: ne kaybedildiği ekranda yazılı, kararı kullanıcı veriyor.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/use-toast"
import { WriteAction } from "@/components/dashboard/write-guard"
import { QuickCariDialog, useCanCreateCari } from "@/components/e-donusum/quick-cari-dialog"
import { useRouteAccess } from "@/components/dashboard/dashboard-company-provider"
import {
  useAccounts,
  useProducts,
  useSuppliers,
  useWarehouses,
  type RefAccount,
} from "@/lib/swr/use-company-data"
import { denetle, type Denetim } from "@/lib/fis-ocr/validate"
import { fisOdemeToMethod, fisToInvoiceBody } from "@/lib/fis-ocr/to-invoice"
import type { Fis, FisKalem } from "@/lib/fis-ocr/schema"
import {
  MEAL_CARD_PROVIDERS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  round2,
  type PaymentMethod,
} from "@/lib/satis/payment"
import { parseTrNumber } from "@/lib/format"
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, Plus, Trash2 } from "lucide-react"

const tl = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n)
    ? "—"
    : new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(n)

/** Yalnız rakam — VKN/TCKN karşılaştırması biçimden bağımsız olsun. */
const rakam = (v: unknown) => String(v ?? "").replace(/\D/g, "")

// ---------------------------------------------------------------- form modeli
//
// Sayısal alanlar METİN olarak tutuluyor: kullanıcı "1.234,56" yazarken ara
// durumlar ("1.", "1.234,") sayıya çevrilemez. Number'a erken çevirmek imleci
// zıplatır ve virgülü yutar. Sayıya çevirme yalnız türetme anında yapılıyor.

type SatirForm = { ad: string; miktar: string; kdvOrani: string; tutar: string }

type FisForm = {
  saticiUnvan: string
  vknTckn: string
  tarih: string
  fisNo: string
  kalemler: SatirForm[]
  kdvToplam: string
  genelToplam: string
}

const metin = (v: unknown) => (v == null ? "" : String(v))

function fisToForm(fis: Fis): FisForm {
  return {
    saticiUnvan: metin(fis.saticiUnvan),
    vknTckn: metin(fis.vknTckn),
    tarih: metin(fis.tarih).slice(0, 10),
    fisNo: metin(fis.fisNo),
    kalemler: fis.kalemler.map((k) => ({
      ad: metin(k.ad),
      miktar: metin(k.miktar),
      kdvOrani: metin(k.kdvOrani),
      tutar: metin(k.tutar),
    })),
    kdvToplam: metin(fis.kdvToplam),
    genelToplam: metin(fis.genelToplam),
  }
}

/**
 * Formu geri Fis'e çevirir. `araToplam` ve `guven` orijinalden korunur:
 * ilki türetilebilir (toplam − KDV), ikincisi modelin kendi beyanıdır ve
 * kullanıcı düzeltmesiyle değişmez — ama düzeltilen alanın güveni artık
 * ölçüyü temsil etmediği için denetim rozetleri yeniden hesaplanır.
 *
 * BİRİM FİYAT ve "satır aritmetiği" denetimi: o denetim modelin OKUDUĞU üçlüyü
 * (miktar × birim = tutar) sınıyor ve birim fiyat formda hiç GÖRÜNMÜYOR, çünkü
 * dönüşümde kullanılmıyor (net, tutardan geri çözülüyor). Bu yüzden:
 *   • satır düzeltilmemişse ham okuma korunur → denetim gerçekten ölçebilir,
 *   • düzeltilmişse null olur → "ölçülemedi".
 * Alternatifleri denedik ve ikisi de yalan söylüyordu: eski birim fiyatı düzeltilmiş
 * satırda taşımak denetimi HAKSIZ YERE patlatır; birim fiyatı tutar/miktar'dan
 * yeniden türetmek ise HER ZAMAN geçen, yani hiçbir şey söylemeyen bir denetim yapar.
 */
function formToFis(form: FisForm, orijinal: Fis, ilkForm: FisForm): Fis {
  const kalemler: FisKalem[] = form.kalemler.map((k, i) => {
    const ilk = ilkForm.kalemler[i]
    const dokunulmamis = !!ilk && ilk.miktar === k.miktar && ilk.tutar === k.tutar
    return {
      ad: k.ad,
      miktar: parseTrNumber(k.miktar),
      birimFiyat: dokunulmamis ? orijinal.kalemler[i]?.birimFiyat ?? null : null,
      kdvOrani: parseTrNumber(k.kdvOrani),
      tutar: parseTrNumber(k.tutar),
    }
  })
  const genelToplam = parseTrNumber(form.genelToplam)
  const kdvToplam = parseTrNumber(form.kdvToplam)
  return {
    ...orijinal,
    saticiUnvan: form.saticiUnvan.trim() || null,
    vknTckn: form.vknTckn.trim() || null,
    tarih: form.tarih || null,
    fisNo: form.fisNo.trim() || null,
    kalemler,
    araToplam:
      genelToplam != null && kdvToplam != null ? round2(genelToplam - kdvToplam) : orijinal.araToplam,
    kdvToplam,
    genelToplam,
  }
}

/** Tahsilat kanalı — Hızlı Alış'takiyle aynı sıra (BANK açıkça önce aranır). */
function hesapSec(method: PaymentMethod, accounts: RefAccount[]): string {
  const bul = (t: string) => accounts.find((a) => a.type === t)?.id
  if (method === "CASH") return bul("CASH") ?? accounts[0]?.id ?? ""
  if (method === "CREDIT_CARD") {
    return bul("CREDIT_CARD") ?? bul("POS") ?? bul("BANK") ?? accounts[0]?.id ?? ""
  }
  return bul("BANK") ?? accounts.find((a) => a.type !== "CASH")?.id ?? accounts[0]?.id ?? ""
}

/**
 * Mükerrer sonucu, BULUNDUĞU SORGUYLA birlikte saklanır (`sorgu`).
 *
 * Önceden çıplak saklanıyordu ve her düzenleme noktasında elle `setMukerrer(null)`
 * demek gerekiyordu. Üç yerde deniyordu, tarih alanında UNUTULMUŞTU: kullanıcı
 * "aynı gün aynı tutarda fiş var" uyarısını alıp TARİHİ DÜZELTİYOR, uyarı ekranda
 * kalıyor ve kaydet kilitli kalmaya devam ediyordu — yani ekran, kendi istediği
 * düzeltmeyi yapan kullanıcıyı cezalandırıyordu.
 *
 * Artık geçerlilik TÜRETİLİYOR: sorgu anahtarı değiştiği anda sonuç bayatlar.
 * Yeni bir düzenlenebilir alan eklemek bu korumayı bir daha bozamaz.
 */
type Mukerrer = {
  id: string
  invoiceNo: string
  slug: string
  totalAmount: number
  sorgu: string
}

type Kayit = { id: string; slug: string; invoiceNo: string; toplam: number }

export function FisOnayKarti({
  sonuc,
  sira,
  companyId,
}: {
  sonuc: { fis: Fis; denetimler: Denetim[] }
  sira: number
  companyId: string
}) {
  const { toast } = useToast()
  const { suppliers, mutate: tedarikcileriTazele } = useSuppliers(companyId)
  const { accounts } = useAccounts(companyId)
  const { warehouses } = useWarehouses(companyId)
  const { products } = useProducts(companyId)

  // Modelin ilk okuması: satırın düzeltilip düzeltilmediğini ölçmenin dayanağı.
  const ilkForm = useMemo(() => fisToForm(sonuc.fis), [sonuc.fis])
  const [form, setForm] = useState<FisForm>(ilkForm)
  const [supplierId, setSupplierId] = useState("")
  const [cariAcik, setCariAcik] = useState(false)
  const [stogaIsle, setStogaIsle] = useState(false)
  const [odemeSekli, setOdemeSekli] = useState<PaymentMethod | "ACIK_HESAP">(
    () => fisOdemeToMethod(sonuc.fis.odeme?.sekil) ?? "ACIK_HESAP"
  )
  const [saglayici, setSaglayici] = useState<string>(MEAL_CARD_PROVIDERS[0])
  const [accountId, setAccountId] = useState("")
  const [ragmen, setRagmen] = useState(false)
  const [mukerrer, setMukerrer] = useState<Mukerrer | null>(null)
  const [kaydediliyor, setKaydediliyor] = useState(false)
  const [kayit, setKayit] = useState<Kayit | null>(null)
  const [hata, setHata] = useState<string | null>(null)

  const fis = useMemo(() => formToFis(form, sonuc.fis, ilkForm), [form, sonuc.fis, ilkForm])
  // Denetimler HER DÜZELTMEDE yeniden koşar. Sunucunun ilk taramada döndürdüğü
  // liste yalnız ilk hâli anlatıyor; kullanıcı VKN'yi düzelttiğinde rozet de
  // düzelmezse ekran yalan söyler ve kapı haksız yere kapalı kalır.
  const denetimler = useMemo(() => denetle(fis), [fis])

  // VKN ile tedarikçi eşleştirme. Fiş taramanın GERÇEK emniyeti budur:
  // checksum bir elek (yanlış bir VKN ~1/10 ihtimalle geçer), cari eşleşmesi ise
  // numaranın gerçekten var olan bir tedarikçiye ait olduğunu söyler.
  // Cari kartı açma yetkisi /cari/tedarikci'den gelir, bu ekrandan değil.
  const cariAcilabilir = useCanCreateCari().supplier
  // Fiş sayfası (/fisler/[id]) SAHİBİ Satış/Alış Fişleri ekranlarıdır (ROUTE_OWNERS).
  // Yalnız fiş taramaya izinli bir çalışan orayı açamaz — haritayı genişletmek
  // ona TÜM fişleri (satış dahil) görme hakkı verirdi. Onun yerine linki
  // yetkiye bağlıyoruz: açamayacak kişiye 403'e giden bir düğme göstermiyoruz.
  const fisSayfasiAcilabilir = useRouteAccess()("/fisler")
  const vkn = rakam(form.vknTckn)
  const eslesenTedarikci = useMemo(
    () => (vkn ? suppliers.find((s) => rakam(s.taxNumber) === vkn) : undefined),
    [suppliers, vkn]
  )
  useEffect(() => {
    if (eslesenTedarikci && !supplierId) setSupplierId(eslesenTedarikci.id)
  }, [eslesenTedarikci, supplierId])

  const urunEslesme = useMemo(() => {
    if (!stogaIsle) return undefined
    const m = new Map<string, string>()
    for (const p of products) {
      const ad = (p.name || "").trim().toLocaleLowerCase("tr")
      if (ad && !m.has(ad)) m.set(ad, p.id)
    }
    return m
  }, [products, stogaIsle])

  const varsayilanDepo = useMemo(
    () => warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]?.id,
    [warehouses]
  )

  const donusum = useMemo(
    () =>
      fisToInvoiceBody(fis, {
        companyId,
        supplierId,
        warehouseId: stogaIsle ? varsayilanDepo : undefined,
        urunEslesme,
      }),
    [fis, companyId, supplierId, stogaIsle, varsayilanDepo, urunEslesme]
  )

  const eslesenSatir = donusum.body.items.filter((i) => i.productId).length
  // Fiş "NAKİT 200 / KREDİ 450" diye bölünmüş olabilir; şema tek ödeme satırı
  // taşıyor. Tespit edemediğimiz şeyi sessizce tek kanala yazmak kasa bakiyesini
  // bozar — kullanıcıya söylüyoruz.
  const okunanOdeme = sonuc.fis.odeme?.tutar ?? null
  const parcaliOlabilir =
    okunanOdeme != null &&
    donusum.beklenenToplam > 0 &&
    okunanOdeme < donusum.beklenenToplam - 0.01
  const patlayan = denetimler.filter((d) => d.durum === "patladi")
  const agirUyari = donusum.uyarilar.filter((u) => u.agir)
  // Mükerrer sorgusunun kimliği: uca giden üç parametrenin aynısı. Bunlardan biri
  // değiştiyse eldeki sonuç artık bu fişi anlatmıyor.
  const mukerrerAnahtari = `${supplierId}|${donusum.body.date}|${donusum.beklenenToplam}`
  const gecerliMukerrer = mukerrer?.sorgu === mukerrerAnahtari ? mukerrer : null

  const engelVar = patlayan.length > 0 || agirUyari.length > 0 || gecerliMukerrer != null
  const kaydedilebilir =
    donusum.body.items.length > 0 && (!engelVar || ragmen) && !kaydediliyor

  // Ödeme yöntemi değişince kanalı yeniden seç — kullanıcı elle değiştirebilir.
  useEffect(() => {
    if (odemeSekli === "ACIK_HESAP" || accounts.length === 0) return
    setAccountId((mevcut) => mevcut || hesapSec(odemeSekli, accounts))
  }, [odemeSekli, accounts])

  const satirDegis = useCallback((i: number, alan: keyof SatirForm, deger: string) => {
    setForm((f) => ({
      ...f,
      kalemler: f.kalemler.map((k, j) => (j === i ? { ...k, [alan]: deger } : k)),
    }))
  }, [])

  const kaydet = useCallback(async () => {
    setKaydediliyor(true)
    setHata(null)
    try {
      // 1) Mükerrer denetimi.
      //
      // Onay kutusu ÜÇ engeli birden aşıyor (denetim, ağır uyarı, mükerrer).
      // "ragmen doğruysa atla" deseydik, patlayan bir denetim için işaretlenen
      // kutu mükerrer korumasını da sessizce kapatırdı. Bu yüzden koşul kutunun
      // kendisi değil, MÜKERRERİN GÖRÜLMÜŞ olmasıdır: kullanıcı ancak ekranda
      // duran mükerrer uyarısını onayladıysa geçer.
      if (!(gecerliMukerrer && ragmen)) {
        const qs = new URLSearchParams({
          companyId,
          date: donusum.body.date,
          total: String(donusum.beklenenToplam),
        })
        // Tedarikçi yoksa parametre HİÇ gitmez: uç o zaman tedarikçisiz fişler
        // arasında arar. Boş dize göndermek "id'si boş olan tedarikçi" demekti.
        if (supplierId) qs.set("supplierId", supplierId)
        const r = await fetch(`/api/alis/fis-tarama?${qs}`)
        const j = await r.json().catch(() => ({}))
        if (r.ok && j?.mukerrer) {
          setMukerrer({ ...j.mukerrer, sorgu: mukerrerAnahtari })
          // Onayı GERİ AL: kutu başka bir engel için işaretlenmiş olabilir;
          // mükerrer bilgisi ekrana yeni geldi, bilerek onaylanması gerekiyor.
          setRagmen(false)
          setKaydediliyor(false)
          return
        }
      }

      // 2) Fişi kes. Tutarları sunucu kendi hesaplıyor; gövde yalnız satırları taşır.
      const res = await fetch("/api/e-donusum/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...donusum.body, sendInvoice: false }),
      })
      const inv = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(inv?.error || "Alış fişi oluşturulamadı")

      // Stok yazılamadıysa fiş yine de kesildi — sunucu uyarı döndürür, yutmuyoruz.
      if (inv?.stockWarning) {
        toast({
          title: "Stok güncellenemedi",
          description: String(inv.stockWarning),
          variant: "destructive",
        })
      }

      setKayit({
        id: inv.id,
        slug: inv.slug || inv.id,
        invoiceNo: inv.invoiceNo,
        // SUNUCUNUN yazdığı toplam: önizleme ile arada kuruş farkı kalsaydı
        // ekran kaydedilmemiş bir rakamı doğrulanmış gibi gösterirdi.
        toplam: inv?.totalAmount != null ? Number(inv.totalAmount) : donusum.beklenenToplam,
      })

      // 3) Tahsilat. Tutar FATURANIN SUNUCUDA KAYITLI toplamı: önizlemenin
      // yuvarlanmamış değeri kayıtlı toplamı aşarsa ödeme reddedilir.
      if (odemeSekli !== "ACIK_HESAP") {
        const tutar = inv?.totalAmount != null ? Number(inv.totalAmount) : donusum.beklenenToplam
        if (tutar > 0) {
          const payRes = await fetch("/api/faturalar/odemeler", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              invoiceId: inv.id,
              companyId,
              amount: tutar,
              paymentMethod: odemeSekli,
              accountId: accountId || undefined,
              notes: odemeSekli === "MEAL_CARD" ? `Yemek kartı: ${saglayici}` : undefined,
              paymentDate: new Date().toISOString(),
            }),
          })
          if (!payRes.ok) {
            const payErr = await payRes.json().catch(() => ({}))
            // Fişi geri almıyoruz: kesildi, cari borç doğdu. Kullanıcıyı uyarıp
            // ödemeyi Fişler ekranından tamamlatmak doğrusu.
            toast({
              title: "Fiş oluştu, ödeme kaydedilemedi",
              description: payErr?.error || "Ödemeyi Fişler ekranından tamamlayın",
              variant: "destructive",
            })
            return
          }
        }
      }

      toast({
        title: "Alış fişi kaydedildi",
        description: `${inv.invoiceNo} · ${tl(Number(inv.totalAmount))}`,
      })
    } catch (e: any) {
      setHata(e?.message || "Beklenmeyen hata")
    } finally {
      setKaydediliyor(false)
    }
  }, [
    gecerliMukerrer,
    mukerrerAnahtari,
    ragmen,
    companyId,
    supplierId,
    donusum,
    odemeSekli,
    accountId,
    saglayici,
    toast,
  ])

  // ------------------------------------------------------------ kaydedilmiş
  if (kayit) {
    return (
      <Card className="border-kobipo-green">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-5 w-5 text-kobipo-green-dark" />
            <span>
              <strong>{sira}. {form.saticiUnvan || "Satıcı"}</strong> alış fişi olarak kaydedildi —{" "}
              {kayit.invoiceNo} · {tl(kayit.toplam)}
            </span>
          </div>
          {/* FİŞ sayfası, fatura önizlemesi DEĞİL: kestiğimiz belge isReceipt
              (FS- serisi) ve kendi ekranı var — orada "Faturaya Dönüştür",
              "Fiş Yazdır", "Tahsilat" düğmeleri duruyor. /faturalar/.../onizleme
              aynı kaydı resmî FATURA kılığında açıyordu (bkz. fisler-listing). */}
          {fisSayfasiAcilabilir && (
            <Button asChild variant="outline" size="sm">
              <Link href={`/fisler/${kayit.slug}?company=${encodeURIComponent(companyId)}`}>
                <ExternalLink className="mr-2 h-4 w-4" />
                Fişi aç
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className={engelVar ? "border-amber-400" : undefined}>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <CardTitle className="text-base">
          {sira}. {form.saticiUnvan || "Satıcı okunamadı"}
        </CardTitle>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">Kaydedilecek tutar</div>
          <div className="text-lg font-bold tabular-nums">{tl(donusum.beklenenToplam)}</div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {denetimler.map((d) => (
            <DenetimRozeti key={d.anahtar} d={d} />
          ))}
        </div>

        {/* -------------------------------------------------- satıcı bilgileri */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Alan etiket="Ünvan">
            <Input
              value={form.saticiUnvan}
              onChange={(e) => setForm((f) => ({ ...f, saticiUnvan: e.target.value }))}
            />
          </Alan>
          <Alan etiket="VKN / TCKN">
            <Input
              value={form.vknTckn}
              inputMode="numeric"
              onChange={(e) => setForm((f) => ({ ...f, vknTckn: e.target.value }))}
            />
          </Alan>
          <Alan etiket="Tarih">
            <Input
              type="date"
              value={form.tarih}
              onChange={(e) => setForm((f) => ({ ...f, tarih: e.target.value }))}
            />
          </Alan>
          <Alan etiket="Fiş No">
            <Input
              value={form.fisNo}
              onChange={(e) => setForm((f) => ({ ...f, fisNo: e.target.value }))}
            />
          </Alan>
        </div>

        {/* ------------------------------------------------------- tedarikçi */}
        <div className="rounded-md border border-kobipo-border p-3">
          <div className="flex flex-wrap items-end gap-3">
            <Alan etiket="Tedarikçi (isteğe bağlı)" className="min-w-[240px] flex-1">
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="h-9 w-full rounded-md border border-kobipo-border bg-background px-2 text-sm"
              >
                <option value="">— seçilmedi —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.taxNumber ? ` · ${s.taxNumber}` : ""}
                  </option>
                ))}
              </select>
            </Alan>
            {!eslesenTedarikci && vkn && cariAcilabilir && (
              <Button variant="outline" size="sm" onClick={() => setCariAcik(true)}>
                Bu VKN ile tedarikçi oluştur
              </Button>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {eslesenTedarikci ? (
              <>
                VKN <span className="font-mono">{vkn}</span> kayıtlı tedarikçiyle eşleşti.
              </>
            ) : supplierId ? (
              <>
                Seçtiğiniz tedarikçinin VKN&apos;si fişteki numaradan farklı. Kayıt yine de
                bu cariye işlenir.
              </>
            ) : (
              <>
                <strong className="text-foreground">
                  Tedarikçisiz kaydedilirse fiş hiçbir cari ekstresinde görünmez
                </strong>{" "}
                ve fişteki VKN doğrulanmamış kalır — VKN kontrol basamağı yanlış
                numaraların yalnızca bir kısmını yakalar, gerçek doğrulama cari
                eşleşmesidir. Fiş, tutarı ve stoğuyla kaydedilmeye devam eder.
                {!cariAcilabilir &&
                  " Yeni tedarikçi açma yetkiniz yok; listeden mevcut bir tedarikçi seçebilirsiniz."}
              </>
            )}
          </p>
        </div>

        {/* ---------------------------------------------------------- kalemler */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-1 pr-2 font-medium">Kalem</th>
                <th className="w-24 py-1 px-2 font-medium">Miktar</th>
                <th className="w-20 py-1 px-2 font-medium">KDV %</th>
                <th className="w-32 py-1 px-2 font-medium">Tutar (KDV dahil)</th>
                <th className="w-32 py-1 px-2 text-right font-medium">Birim (hariç)</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {form.kalemler.map((k, i) => {
                const kalem = donusum.body.items[i]
                return (
                  <tr key={i} className="border-b last:border-0">
                    <td className="py-1 pr-2">
                      <Input
                        value={k.ad}
                        onChange={(e) => satirDegis(i, "ad", e.target.value)}
                        className="h-8"
                      />
                    </td>
                    <td className="py-1 px-2">
                      <Input
                        value={k.miktar}
                        inputMode="decimal"
                        placeholder="1"
                        onChange={(e) => satirDegis(i, "miktar", e.target.value)}
                        className="h-8 tabular-nums"
                      />
                    </td>
                    <td className="py-1 px-2">
                      <Input
                        value={k.kdvOrani}
                        inputMode="decimal"
                        onChange={(e) => satirDegis(i, "kdvOrani", e.target.value)}
                        className="h-8 tabular-nums"
                      />
                    </td>
                    <td className="py-1 px-2">
                      <Input
                        value={k.tutar}
                        inputMode="decimal"
                        onChange={(e) => satirDegis(i, "tutar", e.target.value)}
                        className="h-8 tabular-nums"
                      />
                    </td>
                    <td className="py-1 px-2 text-right tabular-nums text-muted-foreground">
                      {kalem ? tl(kalem.unitPrice) : "—"}
                      {kalem?.productId && (
                        <span className="ml-1 text-[10px] font-semibold text-kobipo-green-dark">
                          ürün
                        </span>
                      )}
                    </td>
                    <td className="py-1">
                      <button
                        type="button"
                        title="Satırı sil"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            kalemler: f.kalemler.filter((_, j) => j !== i),
                          }))
                        }
                        className="text-muted-foreground transition hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setForm((f) => ({
                ...f,
                kalemler: [...f.kalemler, { ad: "", miktar: "1", kdvOrani: "20", tutar: "" }],
              }))
            }
          >
            <Plus className="mr-2 h-4 w-4" />
            Satır ekle
          </Button>
          <div className="flex flex-wrap items-end gap-3">
            <Alan etiket="KDV toplamı" className="w-32">
              <Input
                value={form.kdvToplam}
                inputMode="decimal"
                onChange={(e) => setForm((f) => ({ ...f, kdvToplam: e.target.value }))}
                className="h-8 tabular-nums"
              />
            </Alan>
            <Alan etiket="Fişin genel toplamı" className="w-40">
              <Input
                value={form.genelToplam}
                inputMode="decimal"
                onChange={(e) => setForm((f) => ({ ...f, genelToplam: e.target.value }))}
                className="h-8 tabular-nums"
              />
            </Alan>
          </div>
        </div>

        {/* ------------------------------------------------------- stok seçimi */}
        <label className="flex items-start gap-3 rounded-md border border-kobipo-border p-3">
          <Switch checked={stogaIsle} onCheckedChange={setStogaIsle} className="mt-0.5" />
          <span className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              Kalemleri ürünlerle eşleştir ve stoğa işle
            </span>
            <br />
            Varsayılan KAPALI. Fişte birim yazmaz ve çoğu satırda miktar da basılmaz —
            eşleşen bir ürüne &quot;1 ADET&quot; girmek stok bakiyesini sessizce bozar.
            Yalnız kalem adları ürün kartlarınızla birebir aynıysa açın.
            {stogaIsle && (
              <>
                {" "}
                <strong className="text-foreground">
                  {eslesenSatir}/{donusum.body.items.length} satır eşleşti.
                </strong>
              </>
            )}
          </span>
        </label>

        {/* ----------------------------------------------------------- ödeme */}
        <div className="flex flex-wrap items-end gap-3 rounded-md border border-kobipo-border p-3">
          <Alan etiket="Ödeme" className="min-w-[160px]">
            <select
              value={odemeSekli}
              onChange={(e) => {
                const v = e.target.value as PaymentMethod | "ACIK_HESAP"
                setOdemeSekli(v)
                setAccountId(v === "ACIK_HESAP" ? "" : hesapSec(v, accounts))
              }}
              className="h-9 w-full rounded-md border border-kobipo-border bg-background px-2 text-sm"
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
              <option value="ACIK_HESAP">Açık hesap (tahsilat yok)</option>
            </select>
          </Alan>
          {odemeSekli === "MEAL_CARD" && (
            <Alan etiket="Sağlayıcı" className="min-w-[150px]">
              <select
                value={saglayici}
                onChange={(e) => setSaglayici(e.target.value)}
                className="h-9 w-full rounded-md border border-kobipo-border bg-background px-2 text-sm"
              >
                {MEAL_CARD_PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Alan>
          )}
          {odemeSekli !== "ACIK_HESAP" && (
            <Alan etiket="Kasa / Banka" className="min-w-[180px] flex-1">
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                className="h-9 w-full rounded-md border border-kobipo-border bg-background px-2 text-sm"
              >
                <option value="">— varsayılan —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </Alan>
          )}
          <p className="text-xs text-muted-foreground">
            {sonuc.fis.odeme?.sekil
              ? "Ödeme şekli fişten okundu; yanlışsa değiştirin."
              : "Fişte ödeme satırı okunamadı — şekli siz seçin."}
          </p>
          {parcaliOlabilir && (
            <p className="flex w-full items-start gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Fişte okunan ödeme tutarı ({tl(sonuc.fis.odeme?.tutar)}) genel toplamdan
              düşük — hesap parçalı ödenmiş olabilir. Tahsilatın TAMAMI seçtiğiniz tek
              kanala yazılacak; bölünmüş ödeme için fişi kaydedip tahsilatı Fişler
              ekranından düzeltin.
            </p>
          )}
        </div>

        {/* --------------------------------------------------------- uyarılar */}
        {donusum.uyarilar.map((u, i) => (
          <p
            key={i}
            className={`flex items-start gap-2 rounded-md p-2 text-xs ${
              u.agir
                ? "bg-amber-50 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200"
                : "bg-kobipo-offwhite text-muted-foreground"
            }`}
          >
            {u.agir && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
            {u.mesaj}
          </p>
        ))}

        {gecerliMukerrer && (
          <p className="flex flex-wrap items-center gap-2 rounded-md bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {supplierId
              ? "Aynı tedarikçiye aynı gün aynı tutarda bir alış fişi zaten var"
              : "Aynı gün aynı tutarda tedarikçisiz bir alış fişi zaten var"}{" "}
            ({gecerliMukerrer.invoiceNo}). Bu fiş daha önce taranmış olabilir.
            {fisSayfasiAcilabilir && (
              <Link
                href={`/fisler/${gecerliMukerrer.slug || gecerliMukerrer.id}?company=${encodeURIComponent(companyId)}`}
                className="font-semibold underline"
              >
                Mevcut fişi aç
              </Link>
            )}
          </p>
        )}

        {hata && (
          <p className="rounded-md bg-red-50 p-2 text-sm text-red-700 dark:bg-red-500/15 dark:text-red-300">
            {hata}
          </p>
        )}

        {/* ----------------------------------------------------------- kaydet */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          {engelVar ? (
            <label className="flex items-center gap-2 text-xs text-amber-900 dark:text-amber-200">
              <input
                type="checkbox"
                checked={ragmen}
                onChange={(e) => setRagmen(e.target.checked)}
                className="h-4 w-4"
              />
              {patlayan.length > 0
                ? `${patlayan.length} denetim tutmuyor`
                : gecerliMukerrer
                  ? "Mükerrer olabilir"
                  : "Uyarı var"}
              , yine de kaydet
            </label>
          ) : (
            <span className="text-xs text-muted-foreground">
              Denetimler tutuyor. Kayıt <strong>alış fişi</strong> olarak açılır
              {supplierId ? "" : " — tedarikçisiz, cari ekstresine düşmez"}.
            </span>
          )}
          <WriteAction>
            <Button onClick={kaydet} disabled={!kaydedilebilir}>
              {kaydediliyor && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Alış fişi olarak kaydet
            </Button>
          </WriteAction>
        </div>
      </CardContent>

      {/* Cari kartı ORTAK diyalogla açılıyor: yazdığı şey tedarikçi kartıdır ve
          yetkisi /cari/tedarikci'ye aittir (bkz. useCanCreateCari). Buraya elden
          bir POST yazmak, sunucunun reddedeceği bir düğme göstermek olurdu. */}
      <QuickCariDialog
        open={cariAcik}
        onOpenChange={setCariAcik}
        companyId={companyId}
        defaultKind="supplier"
        initialName={form.saticiUnvan}
        initialTaxNumber={vkn}
        // Fişte vergi dairesi ve adres okunmuyor; zorunlu tutmak kaydı imkânsız
        // kılardı. VKN zaten fişten dolu geliyor, eksikler cari kartından tamamlanır.
        requireTaxFields={false}
        onCreated={(created) => {
          setSupplierId(created.id)
          tedarikcileriTazele()
        }}
      />
    </Card>
  )
}

function Alan({
  etiket,
  className,
  children,
}: {
  etiket: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      <label className="text-xs font-medium text-muted-foreground">{etiket}</label>
      {children}
    </div>
  )
}

function DenetimRozeti({ d }: { d: Denetim }) {
  const stil =
    d.durum === "gecti"
      ? "bg-kobipo-green-light text-kobipo-green-dark"
      : d.durum === "patladi"
        ? "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300"
        : "bg-kobipo-offwhite text-kobipo-gray"
  const isaret = d.durum === "gecti" ? "✓" : d.durum === "patladi" ? "✗" : "—"
  return (
    <span
      title={d.aciklama}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${stil}`}
    >
      {isaret} {d.etiket}
    </span>
  )
}
