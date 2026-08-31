// Sunucu tarafı fiyat hesabı. ÖNEMLİ: Toplam tutar DAİMA burada (sunucuda) hesaplanır;
// istemciden gelen tutara ASLA güvenilmez. İstemci yalnızca seçimi (paket + ekstra modül +
// şube adedi + firma adedi + periyot) gönderir, tutarı sunucu belirler.

import {
  moduleLabel,
  sanitizeDisabledModules,
  sanitizeFreeModules,
  withModuleDependencies,
} from "@/lib/modules"
import {
  BRANCH_ITEM_KEY,
  COMPANY_ITEM_KEY,
  modulePriceKey,
  type BillingCycle,
} from "@/lib/billing/constants"

/** Fiyat hesabında kullanılan paket (bundle) görünümü. */
export interface PlanPricing {
  id?: string
  name?: string
  monthlyPrice: number
  yearlyPrice: number | null
  includedModules: string[]
  includedBranches: number
  /** Pakete dahil ek firma (ayrı VKN) sayısı — şube kotasından bağımsız. */
  includedCompanies: number
}

/** À la carte fiyat haritası: PricingItem.key → { aylık, yıllık }. */
export type PricingMap = Record<string, { monthlyPrice: number; yearlyPrice: number }>

export interface ComputeOrderInput {
  /** Seçilen hazır paket (yoksa tam custom alım). */
  plan: PlanPricing | null
  /** Kullanıcının istediği TÜM modül seti (paket dahil + ekstra). Sıra/temizlik önemsiz. */
  chosenModules: string[]
  /** Kullanıcının istediği TOPLAM ek şube sayısı (ana firma hariç). */
  branchQuota: number
  /** Kullanıcının istediği TOPLAM ek firma sayısı (hesabın kök firması hariç). */
  companyQuota: number
  billingCycle: BillingCycle
  pricing: PricingMap
  /**
   * TEMEL (ücretsiz) modüller — `PricingItem.isFree`. Hesapta zaten açık oldukları için
   * siparişte ÜCRETLENDİRİLMEZ ve satır üretmezler; `resolvedModules`a yine girerler ki
   * abonelik snapshot'ı gerçeği göstersin. Verilmezse hiçbiri ücretsiz sayılmaz.
   */
  freeModules?: string[]
}

export interface OrderLine {
  key: string
  label: string
  qty: number
  unitPrice: number
  total: number
}

export interface ComputedOrder {
  amount: number
  /**
   * SATIN ALINAN modül seti (paket dahilleri ∪ ücretlendirilen ekstralar). Sipariş
   * snapshot'ı ve ardından `Subscription.purchasedModules` bu alandan yazılır.
   *
   * Ücretsiz modüller BURAYA GİRMEZ — girseydi "satın alınmış" sayılır, admin o modülü
   * sonradan ücretliye çevirdiğinde hesapta bedava açık kalırdı. Onları `applyEntitlements`
   * her uygulamada `PricingItem.isFree`ten yeniden ekliyor. Paket İÇİNDEKİ bir modül
   * ücretsiz olsa da burada kalır: bedeli paket fiyatına dahildir.
   */
  resolvedModules: string[]
  /** Ücretlendirilen ekstra (paket dışı, ücretsiz olmayan) modüller. */
  extraModules: string[]
  /** Seçimde yer alan ama ücretsiz olduğu için ücretlendirilmeyen modüller (gösterim için). */
  freeModules: string[]
  /** Normalize edilmiş TOPLAM şube kotası (>= paket dahili). */
  branchQuota: number
  /**
   * Paketin İÇİNDEN gelen şube sayısı — bedeli paket fiyatına dahildir, ayrıca
   * ücretlendirilmez. Ekran bu sayıyı ayrı basmak zorunda: "3 şube" tek bir sayı olarak
   * gösterildiğinde müşteri pakete dahil olanı ek şube sanıp aynı hakkı ikinci kez
   * satın almaya çalışıyor ya da kotayı düşürüp sahip olduğu hakkı siliyordu.
   */
  includedBranches: number
  /** Ücretlendirilen ek şube sayısı (toplam kota − paket dahili). */
  extraBranches: number
  /** Normalize edilmiş TOPLAM ek firma kotası (>= paket dahili). */
  companyQuota: number
  /** Paketin içinden gelen ek firma sayısı — `includedBranches` ile aynı gerekçe. */
  includedCompanies: number
  /** Ücretlendirilen ek firma sayısı (toplam kota − paket dahili). */
  extraCompanies: number
  lines: OrderLine[]
}

function cyclePrice(
  item: { monthlyPrice: number; yearlyPrice: number } | undefined,
  cycle: BillingCycle,
): number {
  if (!item) return 0
  const v = cycle === "YEARLY" ? item.yearlyPrice : item.monthlyPrice
  return Number.isFinite(v) && v > 0 ? v : 0
}

function planPrice(plan: PlanPricing, cycle: BillingCycle): number {
  const v = cycle === "YEARLY" ? plan.yearlyPrice ?? 0 : plan.monthlyPrice
  return Number.isFinite(v as number) && (v as number) > 0 ? (v as number) : 0
}

/**
 * Müşteri seçiminden nihai sipariş tutarını ve snapshot alanlarını hesaplar.
 * - Paket dahilindeki modüller/şubeler tekrar ücretlendirilmez.
 * - Bilinmeyen modül anahtarları elenir (güvenlik).
 */
export function computeOrder(input: ComputeOrderInput): ComputedOrder {
  const { plan, billingCycle, pricing } = input

  // Whitelist + modül bağımlılıkları (ör. "restaurant" seçildiyse "stock" da eklenir).
  // Bağımlılık BURADA tamamlanmalı: aksi halde applyEntitlements onu yine de açar
  // ama sipariş satırlarına girmediği için ÜCRETSİZ verilmiş olurdu.
  const chosen = withModuleDependencies(sanitizeDisabledModules(input.chosenModules))
  const included = plan ? sanitizeDisabledModules(plan.includedModules) : []
  const includedSet = new Set(included)
  // Ücretsiz modüller: hesapta zaten açıklar, hiçbir koşulda ücretlendirilmezler.
  // Bağımlılığı ücretli olan anahtar `sanitizeFreeModules` tarafından elenir — aksi
  // halde ücretsiz bir modül, gerektirdiği ücretli modülü bedavaya açardı.
  const free = sanitizeFreeModules(input.freeModules ?? [])
  const freeSet = new Set(free)

  // Ücretli ekstralar = seçilenlerden pakete dahil ve ücretsiz OLMAYANLAR
  const extraModules = chosen.filter((m) => !includedSet.has(m) && !freeSet.has(m))
  // Satın alınan küme = paket dahilleri ∪ ücretli ekstralar. Ücretsizler dışarıda
  // (yukarıdaki `resolvedModules` açıklaması). Ücretli bir modülün ücretsiz BAĞIMLILIĞI
  // da dışarıda kalır ama kaybolmaz: `resolveGrantedModules` bağımlılıkları yeniden açar.
  const resolvedModules = Array.from(new Set([...included, ...extraModules]))

  const includedBranches = plan ? Math.max(0, Math.floor(plan.includedBranches || 0)) : 0
  const requestedQuota = Math.max(0, Math.floor(input.branchQuota || 0))
  // Kota en az paket dahili kadar olmalı (paket 2 şube içeriyorsa kota < 2 olamaz)
  const branchQuota = Math.max(requestedQuota, includedBranches)
  const extraBranches = Math.max(0, branchQuota - includedBranches)

  // Ek firma: şubeyle AYNI kalıp, AYRI havuz. Biri diğerinin yerine geçmez.
  const includedCompanies = plan ? Math.max(0, Math.floor(plan.includedCompanies || 0)) : 0
  const requestedCompanies = Math.max(0, Math.floor(input.companyQuota || 0))
  const companyQuota = Math.max(requestedCompanies, includedCompanies)
  const extraCompanies = Math.max(0, companyQuota - includedCompanies)

  const lines: OrderLine[] = []

  if (plan) {
    lines.push({
      key: plan.id ? `plan:${plan.id}` : "plan",
      label: plan.name || "Paket",
      qty: 1,
      unitPrice: planPrice(plan, billingCycle),
      total: planPrice(plan, billingCycle),
    })
  }

  for (const m of extraModules) {
    const unit = cyclePrice(pricing[modulePriceKey(m)], billingCycle)
    // Etiket satırla birlikte SAKLANIYOR (`PackageOrder.priceLines`) ve destek ekranında
    // aynen basılıyor; ham anahtar ("stock") değil insan adı ("Stok") yazılır.
    lines.push({
      key: modulePriceKey(m),
      label: `Modül: ${moduleLabel(m)}`,
      qty: 1,
      unitPrice: unit,
      total: unit,
    })
  }

  if (extraBranches > 0) {
    const unit = cyclePrice(pricing[BRANCH_ITEM_KEY], billingCycle)
    lines.push({
      key: BRANCH_ITEM_KEY,
      label: "Ek Şube",
      qty: extraBranches,
      unitPrice: unit,
      total: unit * extraBranches,
    })
  }

  if (extraCompanies > 0) {
    const unit = cyclePrice(pricing[COMPANY_ITEM_KEY], billingCycle)
    lines.push({
      key: COMPANY_ITEM_KEY,
      label: "Ek Firma",
      qty: extraCompanies,
      unitPrice: unit,
      total: unit * extraCompanies,
    })
  }

  const amount = Number(lines.reduce((sum, l) => sum + l.total, 0).toFixed(2))

  return {
    amount,
    resolvedModules,
    extraModules,
    freeModules: free,
    branchQuota,
    includedBranches,
    extraBranches,
    companyQuota,
    includedCompanies,
    extraCompanies,
    lines,
  }
}
