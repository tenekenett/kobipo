// Abonelik → yetki (entitlement) çözümü ve uygulanışı.
//
// Model: abonelik HESAP düzeyindedir (kök firma). Seçilen modüller kök firma VE hesabın
// tüm üyeleri (şubeler + satın alınmış ek firmalar) için geçerlidir. Uygulama mevcut modül
// gating'ini yeniden kullanır: satın alınan modüller `company.disabledModules`'a türetilmiş
// yazılır (disabled = TÜM − satın alınan), böylece menü gizleme / route guard / server
// context hiç değişmeden çalışır. Bkz. [[lib/modules.ts]].
//
// Hesap üyeliği ile şube hiyerarşisi AYRI eksenlerdir (bkz. prisma → Company.accountRootId):
//   şube     → parentCompanyId dolu  (aynı tüzel kişi, VKN devralınır)
//   ek firma → accountRootId dolu    (ayrı tüzel kişi, yalnız abonelik ortak)
// İkisi de `accountRootId` taşır, bu yüzden hesap tek sorguda çözülür.

import { prisma } from "@/lib/db/prisma"
import { MODULE_KEYS, sanitizeDisabledModules, withModuleDependencies } from "@/lib/modules"
import { getFreeModuleKeys } from "@/lib/billing/free-modules"
import { graceDaysFor, type BillingCycle } from "@/lib/billing/constants"
import { DAY_MS } from "@/lib/billing/notice"
import { addMonths, addYears } from "@/lib/billing/period"

/**
 * Bir firmanın hesap kökünü döndürür: `accountRootId` doluysa o, değilse firmanın
 * kendisi köktür. Tek hop — ek firmanın şubesi de doğrudan kökü işaret ettiği için
 * zincir yürünmez (kayıt oluşturulurken kök yazılır, bkz. app/api/companies/route.ts).
 */
export async function resolveAccountRootId(companyId: string): Promise<string> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, accountRootId: true },
  })
  if (!company) return companyId
  return company.accountRootId ?? company.id
}

/**
 * Hesaba ait TÜM firma id'leri: kök + üyeleri (şubeler ve ek firmalar).
 * Yetki uygulama ve hesap kapsamlı temizlik bunu okur.
 */
export async function getAccountCompanyIds(rootCompanyId: string): Promise<string[]> {
  const members = await prisma.company.findMany({
    where: { accountRootId: rootCompanyId },
    select: { id: true },
  })
  return [rootCompanyId, ...members.map((m) => m.id)]
}

/** Hesabın (kök firma) en güncel aboneliğini döndürür. */
export async function getAccountSubscription(companyId: string) {
  const rootId = await resolveAccountRootId(companyId)
  return prisma.subscription.findFirst({
    where: { companyId: rootId },
    orderBy: { createdAt: "desc" },
    include: { plan: true },
  })
}

/**
 * Hesaptaki mevcut şube sayısı — kök firmanın şubeleri VE ek firmaların şubeleri dahil.
 * Şube kotası hesap geneli tek havuzdur; "hangi tüzel kişiye bağlı" ayrımı yapmaz.
 */
export async function countAccountBranches(rootCompanyId: string): Promise<number> {
  return prisma.company.count({
    where: { accountRootId: rootCompanyId, parentCompanyId: { not: null } },
  })
}

/** Hesaptaki ek firma (kök hariç, ayrı VKN'li tüzel kişi) sayısı — şubeler sayılmaz. */
export async function countAccountCompanies(rootCompanyId: string): Promise<number> {
  return prisma.company.count({
    where: { accountRootId: rootCompanyId, parentCompanyId: null },
  })
}

type SubStatusView = {
  status: string
  purchasedModules: string[]
  trialEndsAt: Date | null
  periodEnd: Date | null
  /** Hoşgörü süresi periyoda göre değişir (aylık 7, yıllık 15). Yoksa uzun süre varsayılır. */
  billingCycle?: string | null
}

/** Deneme aktif mi? (status TRIAL ve bitiş tarihi gelecekte / boş) */
export function isTrialActive(sub: SubStatusView | null | undefined, now = new Date()): boolean {
  if (!sub || sub.status !== "TRIAL") return false
  return !sub.trialEndsAt || sub.trialEndsAt.getTime() > now.getTime()
}

/** Ücretli abonelik aktif mi? (status ACTIVE ve dönem bitmemiş) */
export function isPaidActive(sub: SubStatusView | null | undefined, now = new Date()): boolean {
  if (!sub || sub.status !== "ACTIVE") return false
  return !sub.periodEnd || sub.periodEnd.getTime() > now.getTime()
}

/**
 * Ödeme alınamadı ama hoşgörü süresi dolmadı → erişim SÜRÜYOR.
 *
 * `PAST_DUE`'yu ayrı bir "yarı açık" durum olarak görmek şart: aksi halde yetkiler her
 * yeniden hesaplandığında (reconcile, recurring, admin) hoşgörü süresindeki müşteri
 * anında kilitlenirdi. Süre periyoda göredir — bkz. [[lib/billing/constants.ts]] →
 * `graceDaysFor`. Bu fonksiyona verilen kaydın `billingCycle` TAŞIMASI şart: eksik
 * geçilirse yıllık müşteri sessizce 8 gün erken kilitlenir.
 */
export function isInGracePeriod(sub: SubStatusView | null | undefined, now = new Date()): boolean {
  if (!sub || sub.status !== "PAST_DUE" || !sub.periodEnd) return false
  return sub.periodEnd.getTime() + graceDaysFor(sub.billingCycle) * DAY_MS > now.getTime()
}

/**
 * Aboneliğe göre efektif AÇIK modül anahtarları:
 * - Ücretli aktifse VEYA hoşgörü süresindeyse → satın alınan modüller (bağımlılıklarıyla,
 *   ör. restaurant → stock).
 * - Aksi halde (deneme/yok/expired/cancelled/hoşgörüsü dolmuş) → hiçbiri.
 *
 * Modül YALNIZCA satın almayla açılır — deneme modül vermez. Deneme kavramı
 * ölmedi, kapsamı daraldı: `isTrialActive` hâlâ şube kotası için okunur
 * (bkz. app/api/companies/route.ts), ama modül yetkisi üretmez.
 */
export function resolveGrantedModules(sub: SubStatusView | null | undefined, now = new Date()): string[] {
  if (isPaidActive(sub, now) || isInGracePeriod(sub, now)) {
    return withModuleDependencies(sanitizeDisabledModules(sub!.purchasedModules))
  }
  return []
}

/**
 * Verilen açık modül setini hesabın kök firmasına VE tüm üyelerine (şubeler + ek
 * firmalar) uygular. `company.disabledModules = TÜM − (granted ∪ ücretsiz)` yazar.
 * Tek transaction.
 *
 * Ek firma da bu kümededir: ayrı tüzel kişi olsa da aboneliği kökten akar, yoksa
 * müşteri ödediği modülleri ikinci firmasında göremezdi.
 *
 * TEMEL (ücretsiz) modüller BURADA eklenir — çağıranların hiçbiri onları taşımak zorunda
 * değildir. Bu, `disabledModules` yazan TEK yol olduğu için ücretsizliğin de tek kapısıdır:
 * reconcile, yinelenen ödeme, satın alma callback'i, süper-admin "kilitle/sıfırla" ve
 * `setAccountModules` — hepsi buradan geçer, yani ücretsiz modül hiçbir yeniden
 * hesaplamada kapanmaz. Küme `PricingItem.isFree`ten okunur (lib/billing/free-modules.ts).
 *
 * ARŞİV: ücretli modül açıldığında hesabın `archivedAt` damgası da SİLİNİR — yeniden
 * abone olan müşterinin yazma kapısı açılmalı. Bu fonksiyon her yeniden aktifleşme
 * yolunun (satın alma callback'i, elle grant) geçtiği tek nokta olduğu için kural
 * burada duruyor; ayrı bir "arşivden çıkar" çağrısı bir gün unutulurdu.
 */
export async function applyEntitlements(rootCompanyId: string, grantedModules: string[]): Promise<void> {
  const free = await getFreeModuleKeys()
  // Bağımlılıklar burada da tamamlanır: arayüz atlanıp bu fonksiyon doğrudan
  // çağrılsa bile DB'ye tutarsız bir küme (ör. restaurant açık, stock kapalı) yazılmasın.
  const granted = new Set(
    withModuleDependencies([...sanitizeDisabledModules(grantedModules), ...free]),
  )
  const disabled = MODULE_KEYS.filter((k) => !granted.has(k))

  // ARŞİVDEN ÇIKIŞ. Ücretli bir modül açılan hesap arşivde KALAMAZ: `archivedAt` dolu
  // kaldığı sürece yazma kapısı kapalıdır ([[lib/billing/archive.ts]]) ve müşteri
  // "ödedim ama hiçbir şey kaydedemiyorum" durumuna düşer — ödeme akışının en pahalı
  // sessiz hatası bu olurdu.
  //
  // Ölçü ÜCRETSİZ modülleri saymaz: `granted` kümesine `free` her hâlükârda ekleniyor,
  // dolayısıyla "granted boş değil" demek yeterli değil. Kapanan bir hesapta da bu
  // fonksiyon ücretsizlerle çağrılır ve arşivi bozmamalıdır.
  const freeSet = new Set(free)
  const hasPaidModule = [...granted].some((k) => !freeSet.has(k))
  const unarchive = hasPaidModule ? { archivedAt: null } : {}

  await prisma.$transaction([
    prisma.company.update({
      where: { id: rootCompanyId },
      data: { disabledModules: disabled, ...unarchive },
    }),
    prisma.company.updateMany({
      where: { accountRootId: rootCompanyId },
      data: { disabledModules: disabled, ...unarchive },
    }),
  ])
}

/**
 * Elle verilen modül setini hesap için KALICI yapar: `Subscription.purchasedModules`'a
 * yazar ve hesabın tümüne uygular.
 *
 * Neden aboneliğe de yazılır: yetki her yeniden hesaplandığında kaynak
 * `purchasedModules`tır (`resolveGrantedModules`) — reconcile, yinelenen ödeme
 * (`lib/billing/jobs.ts`), "kilitle/sıfırla" ve her yeni sipariş bu alandan üretir.
 * Yalnız `company.disabledModules` değiştirilirse verilen yetki İLK yeniden hesaplamada
 * sessizce silinir; canlıda tam olarak bu yaşandı (2026-08-15, bkz.
 * docs/paket-abonelik/ILERLEME.md).
 *
 * `durable=false` dönerse yazacak abonelik yok ya da abonelik ücretli-aktif değil:
 * yetki şimdilik açık ama ilk yeniden hesaplamada kapanır — çağıran bunu KULLANICIYA
 * söylemeli (deneme durumu tanım gereği modül üretmez).
 */
export async function setAccountModules(
  companyId: string,
  grantedModules: string[],
): Promise<{ rootCompanyId: string; granted: string[]; durable: boolean }> {
  const rootCompanyId = await resolveAccountRootId(companyId)
  const granted = withModuleDependencies(sanitizeDisabledModules(grantedModules))

  // ÜCRETSİZ modüller `purchasedModules`a YAZILMAZ: orası satın alınanın kaydıdır ve
  // ücretsizlik oradan değil `PricingItem.isFree`ten akar. Yazılsaydı, admin modülü
  // ücretliye çevirdiğinde hesap onu "satın almış" görünür, bedava kullanmaya devam
  // ederdi. `applyEntitlements` ücretsizleri zaten kendisi ekliyor.
  const free = new Set(await getFreeModuleKeys())
  const purchased = granted.filter((k) => !free.has(k))

  const sub = await prisma.subscription.findFirst({
    where: { companyId: rootCompanyId },
    orderBy: { createdAt: "desc" },
  })
  if (sub) {
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { purchasedModules: purchased },
    })
  }
  await applyEntitlements(rootCompanyId, granted)

  // `durable` yalnız ÜCRETLİ modüller için anlamlı: ücretsiz olanlar zaten aboneliğe
  // bağlı değil, hiçbir yeniden hesaplamada kapanmıyor.
  const needsSubscription = purchased.length > 0
  return {
    rootCompanyId,
    granted,
    durable: !needsSubscription || (!!sub && (isPaidActive(sub) || isInGracePeriod(sub))),
  }
}

/** Bir hesap kotasının (şube ya da firma) durumu — hem arayüz hem denetim bunu okur. */
export type QuotaStatus = {
  /** Hesap kökü id'si — kota bu düzeyde tutulur. */
  rootCompanyId: string
  /** İzin verilen adet (kök firma hariç). Aktif abonelik yoksa 0. */
  quota: number
  /** Hesapta hâlihazırda AÇIK olan adet. */
  used: number
  /** Daha açılabilecek adet (negatife düşmez). */
  remaining: number
  /** Yenisi eklenebilir mi? */
  canAdd: boolean
  /** Aktif (ücretli veya deneme) abonelik var mı? Yoksa kota tanım gereği 0'dır. */
  hasActiveSubscription: boolean
}

/** Hesabın her iki kotası tek sorgu turunda — kota kartları ve denetimler bunu okur. */
export type AccountQuotas = {
  rootCompanyId: string
  branch: QuotaStatus
  company: QuotaStatus
}

/**
 * Hesabın şube VE firma kotalarını birlikte çözer.
 *
 * TEK KURAL olması şart: bu fonksiyon hem "kaç tane daha açabilirim" göstergesini
 * (`/api/companies/quota`) hem de açma denetimini (`app/api/companies/route.ts` POST)
 * besler. Ayrı ayrı hesaplanırsa ekran "1 hakkınız var" derken API 402 döndürebilir.
 *
 * Aktif abonelik yoksa kotalar 0'dır — fail closed. Deneme de kota üretir (modül
 * üretmez, bkz. `resolveGrantedModules`).
 *
 * İki kota AYRI havuzdur: şube açmak firma hakkını, firma açmak şube hakkını yemez.
 */
export async function getAccountQuotas(companyId: string): Promise<AccountQuotas> {
  const rootCompanyId = await resolveAccountRootId(companyId)
  const [sub, usedBranches, usedCompanies] = await Promise.all([
    prisma.subscription.findFirst({
      where: { companyId: rootCompanyId },
      orderBy: { createdAt: "desc" },
    }),
    countAccountBranches(rootCompanyId),
    countAccountCompanies(rootCompanyId),
  ])

  const hasActiveSubscription = !!sub && (isPaidActive(sub) || isTrialActive(sub))
  const status = (quota: number, used: number): QuotaStatus => ({
    rootCompanyId,
    quota,
    used,
    remaining: Math.max(0, quota - used),
    canAdd: used < quota,
    hasActiveSubscription,
  })

  return {
    rootCompanyId,
    branch: status(hasActiveSubscription ? sub!.branchQuota : 0, usedBranches),
    company: status(hasActiveSubscription ? sub!.companyQuota : 0, usedCompanies),
  }
}

/**
 * Periyoda göre dönem bitiş tarihi (başlangıçtan +1 ay / +1 yıl).
 *
 * Ay/yıl ekleme kuralı [[lib/billing/period.ts]]'te TEK yerde: taşma yerine ayın son
 * gününe kırpılır (31 Ocak + 1 ay = 28 Şubat, 3 Mart değil). Elle süre verme de aynı
 * fonksiyonu kullanır — aksi halde "bir ay" iki farklı tarihe düşerdi.
 */
export function periodEndFor(cycle: BillingCycle, start = new Date()): Date {
  return cycle === "YEARLY" ? addYears(start, 1) : addMonths(start, 1)
}
