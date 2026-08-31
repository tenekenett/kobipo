"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { QuantityStepper } from "@/components/ui/quantity-stepper"
import {
  MANAGEABLE_MODULES,
  modulesRequiring,
  sanitizeFreeModules,
  withModuleDependencies,
} from "@/lib/modules"
import { computeOrder, type PricingMap, type PlanPricing } from "@/lib/billing/pricing"
import {
  BRANCH_ITEM_KEY,
  COMPANY_ITEM_KEY,
  modulePriceKey,
  type BillingCycle,
} from "@/lib/billing/constants"
import { periodEndFor } from "@/lib/billing/period"
import { Check, Loader2, AlertTriangle, Sparkles, Receipt } from "lucide-react"
import {
  DiscountCodeField,
  type AppliedDiscount,
} from "@/components/billing/discount-code-field"
import { MySubscription } from "@/components/billing/my-subscription"
import {
  BillingInfoForm,
  EMPTY_BILLING,
  missingBillingFields,
  useBillingInfo,
} from "@/components/invoicing/billing-info-form"

type CatalogPlan = {
  id: string
  code: string
  name: string
  description: string | null
  monthlyPrice: string | number
  yearlyPrice: string | number | null
  includedModules: string[]
  includedBranches: number
  includedCompanies: number
  highlighted: boolean
}

type CatalogPricingItem = {
  key: string
  label: string
  monthlyPrice: string | number
  yearlyPrice: string | number
  isActive: boolean
  isFree: boolean
}

type CatalogSubscription = {
  status: string
  planId: string | null
  planName: string | null
  billingCycle: string | null
  purchasedModules: string[]
  branchQuota: number
  companyQuota: number
  periodEnd: string | null
  autoRenew: boolean
  cancelAtPeriodEnd: boolean
  isTrialActive: boolean
  isPaidActive: boolean
} | null

type Catalog = {
  paytrEnabled: boolean
  currency: string
  plans: CatalogPlan[]
  pricing: CatalogPricingItem[]
  /**
   * TEMEL modüller — sistem yöneticisi ücretsiz işaretlemiş. Hesapta zaten AÇIK gelirler;
   * seçimden çıkarılamazlar ve tutara girmezler. Küme sunucudan gelir, istemcide türetilmez.
   */
  freeModules: string[]
  subscription: CatalogSubscription
  currentBranches: number
  currentCompanies: number
}

const CUSTOM = "__custom__" // "paketsiz" seçimi

const dateFmt = new Intl.DateTimeFormat("tr-TR", {
  day: "2-digit",
  month: "long",
  year: "numeric",
})

const tl = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "TRY",
  maximumFractionDigits: 2,
})

function toPlanPricing(p: CatalogPlan): PlanPricing {
  return {
    id: p.id,
    name: p.name,
    monthlyPrice: Number(p.monthlyPrice) || 0,
    yearlyPrice: p.yearlyPrice != null ? Number(p.yearlyPrice) || 0 : null,
    includedModules: p.includedModules,
    includedBranches: p.includedBranches,
    includedCompanies: p.includedCompanies,
  }
}

export default function AbonelikPage() {
  const router = useRouter()
  const companySlug = useSearchParams().get("company") || ""

  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [cycle, setCycle] = useState<BillingCycle>("MONTHLY")
  const [selectedPlanId, setSelectedPlanId] = useState<string>(CUSTOM)
  const [extras, setExtras] = useState<Set<string>>(new Set())
  // KOTA DURUMU "EK ADET"TİR, TOPLAM DEĞİL.
  //
  // Ekran eskiden toplam kotayı tutuyordu ve müşteri "3 şube dahil" yazan bir paketle
  // birlikte yine "3" gören bir sayaç görüyordu: ek almak için 4 mü yazacağını
  // bilemiyor, "zaten bende var" deyip 0'a çekince ödediği kotayı siliyordu. Ek adet
  // tutulduğunda sayaç yalnız ÜCRETLENDİRİLEN kısmı gösterir; toplam ondan türer
  // (`computed.branchQuota`) ve paket değişse de kullanıcının seçtiği ek adet kaymaz.
  const [extraBranches, setExtraBranches] = useState(0)
  const [extraCompanies, setExtraCompanies] = useState(0)
  const [autoRenew, setAutoRenew] = useState(true)

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // FATURA BİLGİSİ — ödeme sonrası satış faturası otomatik kesilir. Alıcı, aboneliğin
  // sahibi olan HESAP KÖKÜ firmasıdır; bu yüzden scope="account".
  const {
    value: billing,
    setValue: setBilling,
    loading: billingLoading,
    complete: billingComplete,
  } = useBillingInfo(companySlug, "account")
  const [billingOpen, setBillingOpen] = useState(false)
  const [invalidFields, setInvalidFields] = useState<string[]>([])

  // Kart eksikse formu kendiliğinden aç: kullanıcı ödemeye kadar gidip 412 yemesin.
  useEffect(() => {
    if (!billingLoading && !billingComplete) {
      setBillingOpen(true)
      setInvalidFields(missingBillingFields(billing))
    }
  }, [billingLoading, billingComplete, billing])

  const loadCatalog = useCallback(async () => {
    if (!companySlug) {
      setLoading(false)
      setLoadError("Firma seçili değil.")
      return
    }
    // ÖNCEKİ HATAYI TEMİZLE. `useSearchParams()` ilk client render'ında boş dönebilir
    // (Suspense sınırı olmayan App Router sayfalarında olağan); o turda yukarıdaki dal
    // "Firma seçili değil." yazıyor. Temizlenmezse param bir sonraki render'da gelip
    // katalog başarıyla yüklense bile ekran o ilk hataya YAPIŞIP kalıyordu — sayfa
    // firma seçili olduğu hâlde "Firma seçili değil" gösteriyordu.
    setLoadError(null)
    try {
      const res = await fetch(`/api/billing/catalog?companyId=${encodeURIComponent(companySlug)}`, {
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Katalog yüklenemedi")
      setCatalog(data as Catalog)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Katalog yüklenemedi")
    } finally {
      setLoading(false)
    }
  }, [companySlug])

  useEffect(() => {
    loadCatalog()
  }, [loadCatalog])

  // Ekran, MEVCUT aboneliğin üstüne yazar — boş sayfadan başlamaz.
  //
  // Neden şart: sipariş, aboneliğin YENİ HÂLİNİN tam anlık görüntüsüdür (callback
  // `purchasedModules`/`branchQuota`'yı bu snapshot'la değiştirir). Seçim sıfırdan
  // başlarsa "bir şube daha alayım" diyen müşteri farkında olmadan modüllerini
  // sıfırlayan ve kotasını düşüren bir sipariş oluşturur. Bir kez tohumlanır
  // (`seededRef`); kullanıcının sonraki seçimleri katalog yenilense de korunur.
  const seededRef = useRef(false)
  useEffect(() => {
    if (!catalog || seededRef.current) return
    seededRef.current = true
    const s = catalog.subscription
    if (!s) return

    if (s.billingCycle === "MONTHLY" || s.billingCycle === "YEARLY") setCycle(s.billingCycle)
    const plan = s.planId ? catalog.plans.find((p) => p.id === s.planId) ?? null : null
    if (plan) setSelectedPlanId(plan.id)

    const included = new Set(plan?.includedModules ?? [])
    setExtras(new Set(s.purchasedModules.filter((m) => !included.has(m))))
    // Mevcut kotanın pakete DAHİL olmayan kısmı = bugün ücretini ödediğiniz ek adet.
    // Böylece form açıldığında hiçbir şey değiştirmeden ödeme yapan müşteri aynı
    // kotayla kalır; sayaç ise "paketin üstüne kaç tane aldım" sorusunu yanıtlar.
    setExtraBranches(Math.max(0, s.branchQuota - (plan?.includedBranches ?? 0)))
    setExtraCompanies(Math.max(0, s.companyQuota - (plan?.includedCompanies ?? 0)))
    setAutoRenew(s.autoRenew)
  }, [catalog])

  const pricingMap = useMemo<PricingMap>(() => {
    const map: PricingMap = {}
    for (const it of catalog?.pricing ?? []) {
      if (!it.isActive) continue
      map[it.key] = { monthlyPrice: Number(it.monthlyPrice) || 0, yearlyPrice: Number(it.yearlyPrice) || 0 }
    }
    return map
  }, [catalog])

  const selectedPlan = useMemo(
    () => (selectedPlanId === CUSTOM ? null : catalog?.plans.find((p) => p.id === selectedPlanId) ?? null),
    [catalog, selectedPlanId],
  )

  const includedModuleSet = useMemo(
    () => new Set(selectedPlan?.includedModules ?? []),
    [selectedPlan],
  )
  // Ücretsiz modüller: hesapta zaten açıklar. Seçim mantığında "pakete dahil" ile aynı
  // muameleyi görürler — kaldırılamaz, ekstra listesine yazılmaz, ücretlendirilmez.
  const freeModuleSet = useMemo(
    () => new Set(sanitizeFreeModules(catalog?.freeModules ?? [])),
    [catalog],
  )
  /** Kullanıcının ödemeden sahip olduğu modüller: pakete dahil olanlar + ücretsizler. */
  const grantedModuleSet = useMemo(
    () => new Set([...includedModuleSet, ...freeModuleSet]),
    [includedModuleSet, freeModuleSet],
  )
  const includedBranches = selectedPlan?.includedBranches ?? 0
  const includedCompanies = selectedPlan?.includedCompanies ?? 0
  // AÇIK olan şube/firma kotasız kalamaz: sipariş kotayı baştan yazdığı için toplam,
  // hâlihazırda açık olanın altına inemez. Paket onları karşılamıyorsa aradaki fark
  // ZORUNLU ek adettir — sayacın alt sınırı budur.
  const minExtraBranches = Math.max(0, (catalog?.currentBranches ?? 0) - includedBranches)
  const minExtraCompanies = Math.max(0, (catalog?.currentCompanies ?? 0) - includedCompanies)
  const branchExtras = Math.max(extraBranches, minExtraBranches)
  const companyExtras = Math.max(extraCompanies, minExtraCompanies)

  /**
   * Paket değişince: dahil modülleri "ekstra" setinden çıkar, kotalarda ise TOPLAMI KORU.
   *
   * Korunan şey toplamdır, ek adet değil — müşterinin cümlesi "5 şubem olsun", "paketin
   * üstüne 5 tane daha" değil. 3 şube içeren bir pakete geçildiğinde ek adet 5'ten 2'ye
   * düşer (kota aynı kalır, fiyat düşer); 1 şubelik pakete geçildiğinde 4'e çıkar (kota
   * yine aynı kalır, fark ücretlendirilir ve kırılımda görünür).
   *
   * Eskiden TOPLAM tutuluyor ve yalnız büyütülüyordu: 5 şube içeren paketten 1 şubelik
   * pakete geçen müşterinin sepetine sessizce "4 ek şube" giriyordu, üstelik hiçbir yerde
   * yazmadan. Artık aynı sonucun sebebi kota kartında kalem kalem duruyor.
   */
  function selectPlan(planId: string) {
    const plan = planId === CUSTOM ? null : catalog?.plans.find((p) => p.id === planId) ?? null
    const totalBranches = includedBranches + branchExtras
    const totalCompanies = includedCompanies + companyExtras
    setExtraBranches(Math.max(0, totalBranches - (plan?.includedBranches ?? 0)))
    setExtraCompanies(Math.max(0, totalCompanies - (plan?.includedCompanies ?? 0)))
    setSelectedPlanId(planId)
    if (plan) {
      setExtras((prev) => {
        const next = new Set(prev)
        for (const m of plan.includedModules) next.delete(m)
        return next
      })
    }
  }

  function toggleExtra(key: string) {
    // Ücretsiz modül açılıp kapanmaz: bedeli yok, hesapta zaten açık.
    if (freeModuleSet.has(key)) return
    setExtras((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        // Bu modülü zorunlu kılan başka bir modül seçiliyse kaldırılamaz
        // (buton zaten devre dışı; burası ikinci savunma).
        const selected = [...next, ...grantedModuleSet]
        if (modulesRequiring(key, selected).length > 0) return prev
        next.delete(key)
      } else {
        // Bağımlılıkları otomatik ekle (ör. Restoran & Kafe → Stok).
        // Pakete dahil ya da ücretsiz olanları extra'ya yazmaya gerek yok.
        for (const dep of withModuleDependencies([key])) {
          if (!grantedModuleSet.has(dep)) next.add(dep)
        }
      }
      return next
    })
  }

  const computed = useMemo(
    () =>
      computeOrder({
        plan: selectedPlan ? toPlanPricing(selectedPlan) : null,
        chosenModules: Array.from(extras),
        branchQuota: includedBranches + branchExtras,
        companyQuota: includedCompanies + companyExtras,
        billingCycle: cycle,
        pricing: pricingMap,
        // Ön izleme sunucunun hesabıyla aynı kalsın diye ücretsiz küme buraya da girer;
        // tahsil edilen tutarı yine sunucu belirler (lib/billing/order-amount.ts).
        freeModules: catalog?.freeModules ?? [],
      }),
    [
      selectedPlan,
      extras,
      includedBranches,
      branchExtras,
      includedCompanies,
      companyExtras,
      cycle,
      pricingMap,
      catalog,
    ],
  )

  // Aboneliğin ŞU AN sahip olduğu ama yeni seçimde bulunmayan modüller. Sipariş
  // aboneliğin yeni hâlini yazdığı için bunlar ödeme sonrası KAPANIR — sessiz kalmaz, uyarırız.
  const droppedModules = useMemo(() => {
    const current = catalog?.subscription?.purchasedModules ?? []
    // Ücretsiz olanlar KAPANMAZ: `applyEntitlements` onları her uygulamada geri açıyor.
    // Eskiden satın alınmış bir modül sonradan temel yapıldığında `purchasedModules`ta
    // bir süre daha görünür — bu listeye alınırsa ekran olmayan bir kesintiyi duyurur.
    return current.filter(
      (m) => !computed.resolvedModules.includes(m) && !freeModuleSet.has(m),
    )
  }, [catalog, computed.resolvedModules, freeModuleSet])

  /**
   * Bu sipariş SUNUCUDA hangi yolu tetikler?
   *
   * `lib/billing/paytr-payment.ts` → `planSubscriptionWrite` ile AYNI koşul: modülsüz ama
   * kotalı bir sipariş "kota takviyesi"dir — dönemi uzatmaz, modüllere dokunmaz ve kotayı
   * DÜŞÜREMEZ. Modül/paket içeren sipariş ise aboneliği baştan yazar ve dönemi uzatır.
   * Ekranın bunu bilmesi şart: müşteri neye para verdiğini iki cümleyle görmeli, yoksa
   * "1 şube için neden paketin tamamını ödüyorum" sorusu cevapsız kalıyor.
   */
  const isQuotaTopUp =
    computed.resolvedModules.length === 0 &&
    (computed.branchQuota > 0 || computed.companyQuota > 0)

  /** Ödemesi yapılmış, henüz bitmemiş bir dönem var mı? (yeni periyot onun üstüne biner) */
  const hasFuturePeriod = useMemo(() => {
    const end = catalog?.subscription?.periodEnd
    return !!end && new Date(end).getTime() > Date.now()
  }, [catalog])

  /** Ödeme sonrası dönem sonu — kural sunucuyla ortak ([[lib/billing/period.ts]]). */
  const newPeriodEnd = useMemo(() => {
    if (isQuotaTopUp) return null
    const end = catalog?.subscription?.periodEnd
    // Dönem HENÜZ BİTMEDİYSE yeni periyot onun üstüne eklenir (erken yenileyen gün kaybetmez).
    return periodEndFor(cycle, hasFuturePeriod && end ? new Date(end) : new Date())
  }, [catalog, cycle, hasFuturePeriod, isQuotaTopUp])

  /**
   * Bu sipariş kotayı DÜŞÜRÜYOR mu? Modül içeren sipariş aboneliğin yeni hâlini yazar,
   * yani kota da bu değere çekilir. `droppedModules` ile aynı gerekçe: sessiz kalırsa
   * müşteri "yeniden ödemeyeyim" diye sayacı indirir ve ödediği hakkı siler (canlıda
   * oldu, bkz. lib/billing/paytr-payment.ts → quota-top-up notu).
   */
  const quotaDrops = useMemo(() => {
    const s = catalog?.subscription
    if (!s || isQuotaTopUp) return [] as string[]
    const out: string[] = []
    if (computed.branchQuota < s.branchQuota) {
      out.push(`şube kotanız ${s.branchQuota} → ${computed.branchQuota}`)
    }
    if (computed.companyQuota < s.companyQuota) {
      out.push(`ek firma kotanız ${s.companyQuota} → ${computed.companyQuota}`)
    }
    return out
  }, [catalog, computed.branchQuota, computed.companyQuota, isQuotaTopUp])

  const cyclePrice = (key: string) => {
    const item = pricingMap[key]
    if (!item) return 0
    return cycle === "YEARLY" ? item.yearlyPrice : item.monthlyPrice
  }
  const planCyclePrice = (p: CatalogPlan) => {
    const v = cycle === "YEARLY" ? (p.yearlyPrice != null ? Number(p.yearlyPrice) : null) : Number(p.monthlyPrice)
    return v != null && Number.isFinite(v) ? v : 0
  }

  /**
   * Modülsüz ("yalnız kota") siparişin durumu — kapı sunucudakiyle AYNI ölçüde
   * ([[lib/billing/quota-order.ts]]). Ayrışırsa kullanıcı ödeme ekranına gidip 400 yer.
   *
   * Takviye dönemi UZATMAZ: kota da artmıyorsa ödemenin karşılığı hiç olmaz. Aktif
   * olmayan abonelikte ise kota yükselse bile kullanılamaz (`getAccountQuotas`
   * fail-closed) — ikisi de düğmeyi kapatır, sebebi yazılır.
   */
  const topUp = useMemo(() => {
    if (!isQuotaTopUp) return null
    const s = catalog?.subscription ?? null
    const unit = (key: string) => {
      const item = pricingMap[key]
      if (!item) return 0
      return cycle === "YEARLY" ? item.yearlyPrice : item.monthlyPrice
    }
    const branchAdded = Math.max(0, computed.branchQuota - (s?.branchQuota ?? 0))
    const companyAdded = Math.max(0, computed.companyQuota - (s?.companyQuota ?? 0))
    const blocked: "inactive" | "no-increase" | null = !s
      ? null
      : !s.isPaidActive && !s.isTrialActive
        ? "inactive"
        : branchAdded === 0 && companyAdded === 0
          ? "no-increase"
          : null
    return {
      branchAdded,
      companyAdded,
      blocked,
      // Yenileme tutarına EKLENECEK kısım — sunucudaki `topUpRenewalAmount` ile aynı hesap.
      addedPrice:
        branchAdded * unit(BRANCH_ITEM_KEY) + companyAdded * unit(COMPANY_ITEM_KEY),
      currentBranchQuota: s?.branchQuota ?? 0,
      currentCompanyQuota: s?.companyQuota ?? 0,
    }
  }, [isQuotaTopUp, catalog, computed.branchQuota, computed.companyQuota, pricingMap, cycle])

  const canPay =
    !topUp?.blocked &&
    !!catalog?.paytrEnabled &&
    computed.amount > 0 &&
    (computed.resolvedModules.length > 0 ||
      computed.branchQuota > 0 ||
      computed.companyQuota > 0)

  // İNDİRİM KODU — seçim değişince (plan/modül/kota/periyot) kod DÜŞMEZ, kutu onu yeni
  // tutara göre YENİDEN DOĞRULAR ([[components/billing/discount-code-field.tsx]]).
  // Eskiden burada `setDiscount(null)` vardı: kullanıcı kuponu uyguladıktan sonra bir
  // modülü işaretlediğinde indirim sessizce kayboluyor ve fark etmeyen kullanıcı liste
  // fiyatından ödüyordu.
  const [discount, setDiscount] = useState<AppliedDiscount | null>(null)
  // Kutuda uygulanmamış metin: ödemeye geçişi engeller, yoksa kod siparişe hiç gitmez.
  const [discountDirty, setDiscountDirty] = useState(false)
  const discountSelectionKey = `${selectedPlan?.id ?? ""}|${Array.from(extras)
    .sort()
    .join(",")}|${computed.branchQuota}|${computed.companyQuota}|${cycle}`

  async function handlePay() {
    if (!companySlug || submitting) return

    // Ödeme sonrası satış faturası otomatik kesilir; bilgi eksikse ödemeye hiç
    // gitmeden formu aç ve eksikleri işaretle (sunucu da 412 ile aynı kapıyı tutar).
    const missing = missingBillingFields(billing)
    if (missing.length > 0) {
      setInvalidFields(missing)
      setBillingOpen(true)
      setSubmitError(
        "Fatura bilgileriniz eksik. Satışınız için fatura düzenlenebilmesi adına işaretli alanları doldurun.",
      )
      return
    }

    // Kutuya kod yazılmış ama "Uygula"ya basılmamış: kod siparişe GİTMEZ ve liste
    // fiyatından tahsil edilir. Sessizce geçmek yerine kullanıcıyı durdur.
    if (discountDirty) {
      setSubmitError(
        "İndirim kodunu uygulamadınız. Kutudaki koda 'Uygula' deyin ya da kutuyu boşaltın.",
      )
      return
    }

    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch("/api/billing/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: companySlug,
          planId: selectedPlan?.id ?? null,
          chosenModules: Array.from(extras),
          // Sunucu sözleşmesi TOPLAM kotadır (paket dahili + ek); tutarı yine kendisi
          // hesaplar ([[lib/billing/order-amount.ts]]).
          branchQuota: computed.branchQuota,
          companyQuota: computed.companyQuota,
          billingCycle: cycle,
          autoRenew,
          billing,
          // Yalnız KOD gider; indirimi sunucu yeniden hesaplar.
          discountCode: discount?.code ?? undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 412) {
        setInvalidFields(Array.isArray(data?.fields) ? data.fields : [])
        setBillingOpen(true)
      }
      // Kod arada geçersizleştiyse kutuyu temizle — kullanıcı indirim beklerken
      // liste fiyatından ödemeye gitmesin.
      if (res.status === 422 && data?.field === "discountCode") setDiscount(null)
      if (!res.ok) throw new Error(data?.error || "Sipariş oluşturulamadı")
      // Tam indirimli sipariş sunucuda zaten karşılandı (PayTR'a hiç gidilmedi);
      // ödeme ekranı token istemesin diye işaretle.
      router.push(
        `/ayarlar/abonelik/odeme/${data.id}?company=${encodeURIComponent(companySlug)}` +
          (data?.free ? "&ucretsiz=1" : ""),
      )
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Sipariş oluşturulamadı")
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Paketler yükleniyor…
      </div>
    )
  }

  if (loadError || !catalog) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <AlertTriangle className="h-10 w-10 text-destructive" />
          <p className="font-semibold">{loadError || "Katalog yüklenemedi"}</p>
        </CardContent>
      </Card>
    )
  }

  const sub = catalog.subscription

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-1 sm:p-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Abonelik</h1>
        <p className="text-sm text-muted-foreground">
          Paket seçin veya modülleri tek tek satın alın. Seçtiğiniz modüller ana firma, tüm
          şubeleriniz ve hesabınıza bağlı ek firmalar için açılır.
        </p>
      </div>

      {/* ABONELİĞİM — durum, dönem, kart, kota, ödeme geçmişi.
          Satın alma formuyla aynı sayfada durur: "ne zaman bitiyor" ile "nasıl uzatırım"
          arka arkaya gelen iki sorudur. Kendi ucundan beslenir; bir işlem sonrası
          `loadCatalog` ile satın alma formunun taban değerleri de tazelenir. */}
      <MySubscription companyParam={companySlug} onChanged={loadCatalog} />

      {/* Aylık / Yıllık */}
      <div className="flex items-center justify-center">
        <div className="inline-flex rounded-lg border bg-muted/40 p-1">
          {(["MONTHLY", "YEARLY"] as BillingCycle[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCycle(c)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                cycle === c ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {c === "MONTHLY" ? "Aylık" : "Yıllık"}
            </button>
          ))}
        </div>
      </div>

      {/* Paket kartları */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {catalog.plans.map((p) => {
          const active = selectedPlanId === p.id
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => selectPlan(p.id)}
              className={`relative flex flex-col rounded-xl border p-4 text-left transition-colors ${
                active ? "border-primary ring-2 ring-primary/30" : "hover:border-primary/50"
              }`}
            >
              {p.highlighted && (
                <span className="absolute -top-2 right-3 inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
                  <Sparkles className="h-3 w-3" /> Önerilen
                </span>
              )}
              <div className="flex items-center justify-between">
                <p className="font-semibold">{p.name}</p>
                {active && <Check className="h-4 w-4 text-primary" />}
              </div>
              {p.description && <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>}
              <p className="mt-3 text-lg font-bold">
                {tl.format(planCyclePrice(p))}
                <span className="text-xs font-normal text-muted-foreground">
                  {cycle === "MONTHLY" ? " / ay" : " / yıl"}
                </span>
              </p>
              <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                {p.includedModules.length > 0 && (
                  <li>
                    {p.includedModules
                      .map((k) => MANAGEABLE_MODULES.find((m) => m.key === k)?.label || k)
                      .join(", ")}
                  </li>
                )}
                <li>{p.includedBranches > 0 ? `${p.includedBranches} şube dahil` : "Ek şube dahil değil"}</li>
                <li>
                  {p.includedCompanies > 0
                    ? `${p.includedCompanies} ek firma dahil`
                    : "Ek firma dahil değil"}
                </li>
              </ul>
            </button>
          )
        })}

        {/* Özel (paketsiz) */}
        <button
          type="button"
          onClick={() => selectPlan(CUSTOM)}
          className={`flex flex-col rounded-xl border border-dashed p-4 text-left transition-colors ${
            selectedPlanId === CUSTOM ? "border-primary ring-2 ring-primary/30" : "hover:border-primary/50"
          }`}
        >
          <div className="flex items-center justify-between">
            <p className="font-semibold">Özel (paketsiz)</p>
            {selectedPlanId === CUSTOM && <Check className="h-4 w-4 text-primary" />}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Paket almadan yalnızca ihtiyacınız olan modülleri, şube ve firma adedini seçin.
          </p>
        </button>
      </div>

      {/* Modüller */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Modüller</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2">
          {MANAGEABLE_MODULES.map((m) => {
            const included = includedModuleSet.has(m.key)
            const isFree = freeModuleSet.has(m.key)
            const checked = included || isFree || extras.has(m.key)
            const price = cyclePrice(modulePriceKey(m.key))
            // Seçili başka bir modül bunu zorunlu kılıyorsa kaldırılamaz
            // (ör. Restoran & Kafe seçiliyken Stok).
            const requiredBy = checked
              ? modulesRequiring(m.key, [...extras, ...grantedModuleSet])
              : []
            const locked = requiredBy.length > 0
            return (
              <button
                key={m.key}
                type="button"
                disabled={included || isFree || locked}
                onClick={() => toggleExtra(m.key)}
                className={`flex items-start justify-between gap-3 rounded-lg border p-3 text-left transition-colors ${
                  checked ? "border-primary/60 bg-primary/5" : "hover:border-primary/40"
                } ${included || isFree || locked ? "cursor-default opacity-90" : ""}`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
                      }`}
                    >
                      {checked && <Check className="h-3 w-3" />}
                    </span>
                    <span className="font-medium">{m.label}</span>
                  </div>
                  <p className="mt-1 pl-6 text-xs text-muted-foreground">{m.description}</p>
                  {locked && (
                    <p className="mt-1 pl-6 text-xs text-muted-foreground">
                      {requiredBy
                        .map((k) => MANAGEABLE_MODULES.find((x) => x.key === k)?.label || k)
                        .join(", ")}{" "}
                      için gerekli
                    </p>
                  )}
                </div>
                <span
                  className={`shrink-0 text-xs font-medium ${
                    isFree ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
                  }`}
                >
                  {isFree
                    ? "Ücretsiz"
                    : included
                      ? "Pakete dahil"
                      : price > 0
                        ? `+${tl.format(price)}`
                        : "—"}
                </span>
              </button>
            )
          })}
        </CardContent>
      </Card>

      {/* KOTALAR — şube ve firma AYRI havuzlardır, biri diğerinin yerine geçmez.
          Sayaç EK adedi sorar, toplamı değil: "3 şube dahil" yazan bir pakette toplam
          sorulunca müşteri hangi kısmın ücretli olduğunu göremiyordu. Kırılım
          (dahil / ek / toplam) her satırın altında açıkça basılır. */}
      <Card>
        <CardContent className="divide-y py-0">
          <QuotaRow
            title="Şube kotası"
            description={
              <>
                Aynı firmanın <strong>ikinci adresi</strong> (aynı VKN). Ünvan, vergi dairesi
                ve e-Dönüşüm hesabı ana firmadan devralınır.
              </>
            }
            unitLabel="şube"
            included={computed.includedBranches}
            extra={computed.extraBranches}
            total={computed.branchQuota}
            unitPrice={cyclePrice(BRANCH_ITEM_KEY)}
            open={catalog.currentBranches}
            currentQuota={sub ? sub.branchQuota : null}
            minExtra={minExtraBranches}
            onChange={setExtraBranches}
          />

          <QuotaRow
            title="Ek firma kotası"
            description={
              <>
                <strong>Ayrı VKN&apos;li</strong> ikinci bir firma — kendi ünvanı, adresi ve
                e-Dönüşüm hesabı olur; modülleriniz ve aboneliğiniz ortak kalır, tek ödeme
                yaparsınız.
              </>
            }
            unitLabel="ek firma"
            included={computed.includedCompanies}
            extra={computed.extraCompanies}
            total={computed.companyQuota}
            unitPrice={cyclePrice(COMPANY_ITEM_KEY)}
            open={catalog.currentCompanies}
            currentQuota={sub ? sub.companyQuota : null}
            minExtra={minExtraCompanies}
            onChange={setExtraCompanies}
          />
        </CardContent>
      </Card>

      {/* Özet + öde */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sipariş özeti</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {computed.lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">Henüz bir seçim yapmadınız.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {computed.lines.map((l) => (
                <li key={l.key} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">
                    {l.label}
                    {l.qty > 1 ? ` × ${l.qty}` : ""}
                  </span>
                  <span className="font-medium">{tl.format(l.total)}</span>
                </li>
              ))}
            </ul>
          )}

          {discount?.kind === "single" && (
            <div className="flex items-center justify-between gap-2 text-sm text-emerald-600 dark:text-emerald-400">
              <span>İndirim ({discount.code})</span>
              <span>−{tl.format(discount.discountAmount)}</span>
            </div>
          )}

          <div className="flex items-center justify-between border-t pt-3 text-base font-semibold">
            <span>Toplam{cycle === "MONTHLY" ? " (aylık)" : " (yıllık)"}</span>
            <span>
              {discount?.kind === "single" ? (
                <>
                  <span className="mr-2 text-sm font-normal text-muted-foreground line-through">
                    {tl.format(computed.amount)}
                  </span>
                  {tl.format(discount.payable)}
                </>
              ) : (
                tl.format(computed.amount)
              )}
            </span>
          </div>

          {/* İndirim kodu — tutarı sunucu hesaplar, kutu yalnız ön izleme yapar. */}
          {companySlug && canPay && (
            <DiscountCodeField
              companyId={companySlug}
              scope="PACKAGE"
              payload={{
                planId: selectedPlan?.id ?? null,
                chosenModules: Array.from(extras),
                branchQuota: computed.branchQuota,
                companyQuota: computed.companyQuota,
                billingCycle: cycle,
              }}
              selectionKey={discountSelectionKey}
              applied={discount}
              onApplied={setDiscount}
              onDirtyChange={setDiscountDirty}
              disabled={submitting}
            />
          )}

          <label className="flex items-center gap-2 pt-1 text-sm">
            <Switch checked={autoRenew} onCheckedChange={setAutoRenew} />
            <span>Dönem sonunda otomatik yenile</span>
          </label>

          {/* NE SATIN ALDIĞIN, NE ALMADIĞIN. Paket seçiliyken tek bir ek şube almak da
              aboneliğin tamamını yeniden yazar ve dönemi bir periyot uzatır; bu cümle
              olmadan müşteri "1 şube için neden paketin tamamını ödüyorum" sorusuna
              cevap bulamıyordu. */}
          {computed.amount > 0 && (
            <p className="rounded-md bg-muted/60 p-2.5 text-xs text-muted-foreground">
              {newPeriodEnd ? (
                <>
                  Bu ödeme aboneliğinizin tamamını kapsar: seçtiğiniz paket, modüller ve kota
                  bir dönem daha geçerli olur. Döneminiz{" "}
                  {hasFuturePeriod ? "kalan sürenin üstüne eklenerek " : ""}
                  <strong>{dateFmt.format(newPeriodEnd)}</strong> tarihine kadar sürer.
                </>
              ) : (
                <>
                  Bu sipariş yalnız <strong>kota takviyesidir</strong>: modülleriniz ve dönem
                  bitiş tarihiniz değişmez, yalnız kotanız yükselir.
                  {/* Eklenen kota YENİLEME tutarına da girer — söylenmezse müşteri bir
                      sonraki dönemde beklemediği bir artışla karşılaşır. */}
                  {topUp && topUp.addedPrice > 0 && (
                    <>
                      {" "}
                      Dönem yenilendiğinde tahsil edilecek tutar{" "}
                      <strong>{tl.format(topUp.addedPrice)}</strong> artar.
                    </>
                  )}
                </>
              )}
            </p>
          )}

          {topUp?.blocked && (
            <p className="flex items-start gap-2 rounded-md bg-amber-50 p-2.5 text-xs text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
              <AlertTriangle className="mt-px h-4 w-4 shrink-0" />
              <span>
                {topUp.blocked === "inactive" ? (
                  <>
                    Aboneliğiniz aktif olmadığı için yalnız kota satın alınamaz — aldığınız
                    kotayı kullanamazdınız. Önce bir <strong>paket ya da modül</strong> seçerek
                    aboneliğinizi başlatın.
                  </>
                ) : (
                  <>
                    Kotanız zaten bu seviyede (şube {topUp.currentBranchQuota}, ek firma{" "}
                    {topUp.currentCompanyQuota}). Yalnız kota siparişi{" "}
                    <strong>dönemi uzatmaz</strong>, yani bu ödemenin karşılığı olmaz. Kota
                    eklemek için yukarıdan ek adedi yükseltin; aboneliğinizi yenilemek için
                    paket ya da modül seçin.
                  </>
                )}
              </span>
            </p>
          )}

          {quotaDrops.length > 0 && (
            <p className="flex items-start gap-2 rounded-md bg-amber-50 p-2.5 text-xs text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
              <AlertTriangle className="mt-px h-4 w-4 shrink-0" />
              <span>
                Bu sipariş aboneliğinizin yeni hâli olacak; <strong>{quotaDrops.join(", ")}</strong>{" "}
                olarak düşer. Kotanızı korumak için yukarıdaki ek adetleri geri yükseltin.
              </span>
            </p>
          )}

          {droppedModules.length > 0 && (
            <p className="flex items-start gap-2 rounded-md bg-amber-50 p-2.5 text-xs text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
              <AlertTriangle className="mt-px h-4 w-4 shrink-0" />
              <span>
                Bu sipariş aboneliğinizin yeni hâli olacak; şu an açık olan{" "}
                <strong>
                  {droppedModules
                    .map((k) => MANAGEABLE_MODULES.find((m) => m.key === k)?.label || k)
                    .join(", ")}
                </strong>{" "}
                kapanır. Kalsın istiyorsanız yukarıdan tekrar seçin.
              </span>
            </p>
          )}
          {!catalog.paytrEnabled && (
            <p className="flex items-center gap-2 rounded-md bg-amber-50 p-2.5 text-xs text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Online ödeme şu an yapılandırılmamış. Lütfen daha sonra tekrar deneyin veya destekle iletişime geçin.
            </p>
          )}
          {/* Fatura bilgileri: ödeme sonrası satış faturası otomatik kesilir. Alıcı,
              aboneliğin sahibi olan hesap kökü firmasıdır (scope="account"). */}
          <div className="space-y-2 rounded-lg border p-3">
            <button
              type="button"
              onClick={() => setBillingOpen((v) => !v)}
              className="flex w-full items-center justify-between gap-2 text-left"
            >
              <span className="flex items-center gap-2 text-sm font-semibold">
                <Receipt className="h-4 w-4" />
                Fatura Bilgileri
              </span>
              <span className="text-xs text-muted-foreground">
                {invalidFields.length > 0 ? "Eksik — doldurun" : billingOpen ? "Gizle" : "Düzenle"}
              </span>
            </button>
            {billingOpen ? (
              <BillingInfoForm
                value={billing}
                onChange={(v) => {
                  setBilling(v)
                  if (invalidFields.length > 0) setInvalidFields(missingBillingFields(v))
                }}
                invalidFields={invalidFields}
                loading={billingLoading}
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                {billing.name} · {billing.taxNumber}
              </p>
            )}
          </div>

          {submitError && (
            <p className="flex items-center gap-2 rounded-md bg-destructive/10 p-2.5 text-xs text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {submitError}
            </p>
          )}

          <Button className="w-full" size="lg" disabled={!canPay || submitting} onClick={handlePay}>
            {submitting ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                Yönlendiriliyor…
              </>
            ) : (
              // Düğme TAHSİL EDİLECEK tutarı yazar: indirim uygulandığında liste
              // tutarını göstermek, ekranda görünen ile ödenecek tutarı ayrıştırırdı.
              `Öde · ${tl.format(discount?.kind === "single" ? discount.payable : computed.amount)}`
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

/**
 * Tek bir kota satırı: sayaç EK (ücretli) adedi sorar, altındaki kırılım toplamı anlatır.
 *
 * Neden kırılım şart: paket 3 şube içerdiğinde ekran tek bir "3" gösteriyordu ve bu sayı
 * hem "pakette var" hem "ek aldım" okunabiliyordu. Müşteri ya aynı hakkı ikinci kez
 * satın almaya çalışıyor ya da "bende zaten var" deyip sayacı sıfırlıyor, siparişi
 * onaylayınca ödediği kotayı kaybediyordu. Üç sayı ayrı basıldığında iki okuma da
 * mümkün değil.
 */
function QuotaRow({
  title,
  description,
  unitLabel,
  included,
  extra,
  total,
  unitPrice,
  open,
  currentQuota,
  minExtra,
  onChange,
}: {
  title: string
  description: ReactNode
  /** "şube" / "ek firma" — cümlelerde geçen birim adı. */
  unitLabel: string
  included: number
  extra: number
  total: number
  unitPrice: number
  /** Hesapta HÂLİHAZIRDA açık olan adet. */
  open: number
  /** Aboneliğin şu anki kotası (abonelik yoksa null). */
  currentQuota: number | null
  /** Açık olanları karşılamak için ZORUNLU en az ek adet. */
  minExtra: number
  onChange: (value: number) => void
}) {
  return (
    <div className="flex flex-col gap-4 py-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-2">
        <p className="font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>

        {/* KIRILIM — hangi adedin ücretli olduğu tek bakışta görünsün. */}
        <dl className="max-w-xs space-y-1 text-xs">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">Pakete dahil</dt>
            <dd className="tabular-nums">
              {included > 0 ? `${included} ${unitLabel}` : "—"}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">Ek (ücretli)</dt>
            <dd className="tabular-nums">
              {extra > 0 ? `${extra} × ${tl.format(unitPrice)}` : "—"}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 border-t pt-1 font-medium">
            <dt>Toplam kota</dt>
            <dd className="tabular-nums">
              {total} {unitLabel}
            </dd>
          </div>
        </dl>

        <p className="text-xs text-muted-foreground">
          Şu an {open} {unitLabel} açık
          {currentQuota != null ? `, kotanız ${currentQuota}` : ""}.
          {/* Alt sınırın SEBEBİ yazılmazsa "eksi" düğmesi cevapsız biçimde ölü görünür. */}
          {minExtra > 0 &&
            (included > 0
              ? ` Açık olanlar kotasız kalamaz: paket ${included} tanesini karşılıyor, kalan ${minExtra} tanesi ek olarak alınmalı.`
              : ` Açık olanlar kotasız kalamaz: paket ${unitLabel} içermediği için ${minExtra} tanesi ek olarak alınmalı.`)}
        </p>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <QuantityStepper
          value={extra}
          onChange={(v) => onChange(Math.max(minExtra, Math.floor(v) || 0))}
          min={minExtra}
          step={1}
        />
        <span className="text-[11px] text-muted-foreground">ek {unitLabel}</span>
      </div>
    </div>
  )
}
