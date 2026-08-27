"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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
import { modulePriceKey, type BillingCycle } from "@/lib/billing/constants"
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
  const [branchQuota, setBranchQuota] = useState(0)
  const [companyQuota, setCompanyQuota] = useState(0)
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
    setBranchQuota(Math.max(s.branchQuota, catalog.currentBranches, plan?.includedBranches ?? 0))
    setCompanyQuota(
      Math.max(s.companyQuota, catalog.currentCompanies, plan?.includedCompanies ?? 0),
    )
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
  const minBranches = selectedPlan?.includedBranches ?? 0
  const minCompanies = selectedPlan?.includedCompanies ?? 0
  // Kota, AÇIK olan şube/firma sayısının altına inemez: sipariş kotayı değiştirdiği için
  // daha düşük bir değer, zaten var olanları kotasız bırakırdı.
  const minQuota = Math.max(minBranches, catalog?.currentBranches ?? 0)
  const minCompanyQuota = Math.max(minCompanies, catalog?.currentCompanies ?? 0)

  // Paket değişince: dahil modülleri "ekstra" setinden çıkar, kotaları en az paket dahiline çek.
  function selectPlan(planId: string) {
    setSelectedPlanId(planId)
    const plan = planId === CUSTOM ? null : catalog?.plans.find((p) => p.id === planId) ?? null
    if (plan) {
      setExtras((prev) => {
        const next = new Set(prev)
        for (const m of plan.includedModules) next.delete(m)
        return next
      })
      setBranchQuota((q) => Math.max(q, plan.includedBranches))
      setCompanyQuota((q) => Math.max(q, plan.includedCompanies))
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
        branchQuota: Math.max(branchQuota, minQuota),
        companyQuota: Math.max(companyQuota, minCompanyQuota),
        billingCycle: cycle,
        pricing: pricingMap,
        // Ön izleme sunucunun hesabıyla aynı kalsın diye ücretsiz küme buraya da girer;
        // tahsil edilen tutarı yine sunucu belirler (lib/billing/order-amount.ts).
        freeModules: catalog?.freeModules ?? [],
      }),
    [
      selectedPlan,
      extras,
      branchQuota,
      minQuota,
      companyQuota,
      minCompanyQuota,
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

  const cyclePrice = (key: string) => {
    const item = pricingMap[key]
    if (!item) return 0
    return cycle === "YEARLY" ? item.yearlyPrice : item.monthlyPrice
  }
  const planCyclePrice = (p: CatalogPlan) => {
    const v = cycle === "YEARLY" ? (p.yearlyPrice != null ? Number(p.yearlyPrice) : null) : Number(p.monthlyPrice)
    return v != null && Number.isFinite(v) ? v : 0
  }

  const canPay =
    !!catalog?.paytrEnabled &&
    computed.amount > 0 &&
    (computed.resolvedModules.length > 0 ||
      computed.branchQuota > 0 ||
      computed.companyQuota > 0)

  // İNDİRİM KODU — seçim değişince (plan/modül/kota/periyot) uygulanan kod DÜŞER:
  // tutar değiştiği için eski ön izleme yanlış olurdu. Kullanıcı yeniden uygular.
  const [discount, setDiscount] = useState<AppliedDiscount | null>(null)
  const discountSelectionKey = `${selectedPlan?.id ?? ""}|${Array.from(extras)
    .sort()
    .join(",")}|${branchQuota}|${companyQuota}|${cycle}`
  const lastSelectionKey = useRef(discountSelectionKey)
  useEffect(() => {
    if (lastSelectionKey.current !== discountSelectionKey) {
      lastSelectionKey.current = discountSelectionKey
      setDiscount(null)
    }
  }, [discountSelectionKey])

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
          branchQuota: Math.max(branchQuota, minQuota),
          companyQuota: Math.max(companyQuota, minCompanyQuota),
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
      router.push(`/ayarlar/abonelik/odeme/${data.id}?company=${encodeURIComponent(companySlug)}`)
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

      {/* Kotalar — şube ve firma AYRI havuzlardır, biri diğerinin yerine geçmez. */}
      <Card>
        <CardContent className="divide-y py-0">
          <div className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">Ek şube kotası</p>
              <p className="text-xs text-muted-foreground">
                Aynı firmanın <strong>ikinci adresi</strong> (aynı VKN). Açabileceğiniz TOPLAM
                şube sayısı — mevcut kotanızın üstüne eklenmez, bu değer geçerli olur. Şu an{" "}
                {catalog.currentBranches} şubeniz var
                {sub ? `, kotanız ${sub.branchQuota}` : ""}.
                {minBranches > 0 && ` Paket ${minBranches} şube içeriyor.`}
                {computed.extraBranches > 0 && ` ${computed.extraBranches} ek şube ücretlendirilir.`}
              </p>
            </div>
            <QuantityStepper
              value={Math.max(branchQuota, minQuota)}
              onChange={(v) => setBranchQuota(Math.max(minQuota, Math.floor(v)))}
              min={minQuota}
              step={1}
            />
          </div>

          <div className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium">Ek firma kotası</p>
              <p className="text-xs text-muted-foreground">
                <strong>Ayrı VKN&apos;li</strong> ikinci bir firma — kendi ünvanı, adresi ve
                e-Dönüşüm hesabı olur; modülleriniz ve aboneliğiniz ortak kalır, tek ödeme
                yaparsınız. Şu an {catalog.currentCompanies} ek firmanız var
                {sub ? `, kotanız ${sub.companyQuota}` : ""}.
                {minCompanies > 0 && ` Paket ${minCompanies} ek firma içeriyor.`}
                {computed.extraCompanies > 0 &&
                  ` ${computed.extraCompanies} ek firma ücretlendirilir.`}
              </p>
            </div>
            <QuantityStepper
              value={Math.max(companyQuota, minCompanyQuota)}
              onChange={(v) => setCompanyQuota(Math.max(minCompanyQuota, Math.floor(v)))}
              min={minCompanyQuota}
              step={1}
            />
          </div>
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
                branchQuota: Math.max(branchQuota, minQuota),
                companyQuota: Math.max(companyQuota, minCompanyQuota),
                billingCycle: cycle,
              }}
              applied={discount}
              onApplied={setDiscount}
              disabled={submitting}
            />
          )}

          <label className="flex items-center gap-2 pt-1 text-sm">
            <Switch checked={autoRenew} onCheckedChange={setAutoRenew} />
            <span>Dönem sonunda otomatik yenile</span>
          </label>

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
