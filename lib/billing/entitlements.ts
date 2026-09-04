// Abonelik → yetki (entitlement) çözümü ve uygulanışı.
//
// MODEL (2026-09-04'te değişti): abonelik FİRMA düzeyindedir. Her firma — kök, şube ve ek
// firma — kendi modüllerini kendi satın alır; hiçbir yetki bir firmadan diğerine GEÇMEZ.
// Öncesinde abonelik hesap kökünde duruyor ve `applyEntitlements` hesabın tüm üyelerine
// yazıyordu; ayrıntı ve geçiş: docs/paket-abonelik/FIRMA-BAZLI-ABONELIK.md.
//
// Uygulama mevcut modül gating'ini yeniden kullanır: satın alınan modüller
// `company.disabledModules`'a türetilmiş yazılır (disabled = TÜM − satın alınan), böylece
// menü gizleme / route guard / server context hiç değişmeden çalışır. Bkz. [[lib/modules.ts]].
//
// HESAP kavramı ölmedi, kapsamı daraldı — bugün yalnız ŞU üç işi yapar:
//   1. KOTA: şube/ek firma açma hakkı hesap kökünün abonelik satırında tutulur ve tek
//      havuzdur (`getAccountQuotas`). Kota "açma hakkı"dır, modül hakkı DEĞİLDİR.
//   2. YETKİLENDİRME: kökün ADMIN'i hesabın tüm firmalarını yönetir (satın alma dahil).
//   3. BİLDİRİM: dönem sonu e-postası hesabın ADMIN'lerine gider.
//
// Hesap üyeliği ile şube hiyerarşisi AYRI eksenlerdir (bkz. prisma → Company.accountRootId):
//   şube     → parentCompanyId dolu  (aynı tüzel kişi, VKN devralınır)
//   ek firma → accountRootId dolu    (ayrı tüzel kişi, yalnız hesap/kota ortak)
// İkisi de `accountRootId` taşır, bu yüzden hesap tek sorguda çözülür.

import { prisma } from "@/lib/db/prisma"
import {
  MODULE_KEYS,
  applySuppression,
  sanitizeDisabledModules,
  sanitizeSuppressedModules,
  withModuleDependencies,
} from "@/lib/modules"
import { getFreeModuleKeys } from "@/lib/billing/free-modules"
import { graceDaysFor } from "@/lib/billing/constants"
import { DAY_MS } from "@/lib/billing/notice"

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

/**
 * FİRMANIN kendi en güncel aboneliği — yetkinin tek kaynağı.
 *
 * Modül soran her yer bunu okur: şube ana firmanın aboneliğinden yararlanmaz, kendi
 * satırı yoksa ücretli modülü yoktur (ücretsizler `applyEntitlements` ile yine açık).
 */
export async function getCompanySubscription(companyId: string) {
  return prisma.subscription.findFirst({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    include: { plan: true },
  })
}

/**
 * Hesap KÖKÜNÜN en güncel aboneliği. Yalnız KOTA için okunur (şube/ek firma açma hakkı
 * hesap düzeyindedir ve kökün satırında durur).
 *
 * Modül yetkisi için KULLANMAYIN — o firma bazındadır, `getCompanySubscription`.
 */
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
 * Bu yetki uygulaması hesabı ARŞİVDEN ÇIKARMALI mı?
 *
 * Ücretli bir modül açılan hesap arşivde KALAMAZ: `archivedAt` dolu kaldığı sürece yazma
 * kapısı kapalıdır ([[lib/billing/archive.ts]]) ve müşteri "ödedim ama hiçbir şey
 * kaydedemiyorum" durumuna düşer — ödeme akışının en pahalı sessiz hatası bu olurdu.
 *
 * Ölçü ÜCRETSİZ modülleri SAYMAZ. `granted` kümesine ücretsizler her hâlükârda ekleniyor
 * (`applyEntitlements`), dolayısıyla "granted boş değil" demek yeterli değil: kapanan bir
 * hesapta bu fonksiyon yalnız ücretsizlerle çağrılır ve arşivi bozmamalıdır.
 *
 * `applyEntitlements`in içinden çıkarıldı çünkü kural DB'siz sınanabilmeli — bozulduğunda
 * belirtisi "ödeyen müşteri yazamıyor" gibi geç ve pahalı bir hatadır.
 */
export function shouldUnarchive(granted: Iterable<string>, freeModules: Iterable<string>): boolean {
  const freeSet = new Set(freeModules)
  return [...granted].some((k) => !freeSet.has(k))
}

/**
 * Verilen açık modül setini TEK FİRMAYA uygular:
 * `company.disabledModules = TÜM − (granted ∪ ücretsiz − elle kapatılan)`.
 *
 * KAPSAM FİRMADIR. Eskiden bu fonksiyon hesabın tüm üyelerine (şubeler + ek firmalar)
 * yazıyordu; abonelik firma düzeyine indiğinde bu yanlış oldu — bir firmanın ödemesi
 * diğerinin modülünü açardı. Şube ve ek firmanın yetkisi kendi abonelik satırından
 * üretilir (bkz. `getCompanySubscription`).
 *
 * TEMEL (ücretsiz) modüller BURADA eklenir — çağıranların hiçbiri onları taşımak zorunda
 * değildir. Bu, `disabledModules` yazan TEK yol olduğu için ücretsizliğin de tek kapısıdır:
 * reconcile, yinelenen ödeme, satın alma callback'i, süper-admin "kilitle/sıfırla" ve
 * `setCompanyModules` — hepsi buradan geçer, yani ücretsiz modül hiçbir yeniden
 * hesaplamada kapanmaz. Küme `PricingItem.isFree`ten okunur (lib/billing/free-modules.ts).
 *
 * TEK İSTİSNA firmanın `suppressedModules` alanıdır: sistem yöneticisinin o firmada
 * bilerek kapattığı temel modüller açık kümeden (bağımlılarıyla birlikte) düşülür.
 *
 * ARŞİV: ücretli modül açıldığında firmanın `archivedAt` damgası da SİLİNİR — yeniden
 * abone olanın yazma kapısı açılmalı. Bu fonksiyon her yeniden aktifleşme yolunun
 * (satın alma callback'i, elle grant) geçtiği tek nokta olduğu için kural burada duruyor;
 * ayrı bir "arşivden çıkar" çağrısı bir gün unutulurdu.
 */
export async function applyEntitlements(companyId: string, grantedModules: string[]): Promise<void> {
  const free = await getFreeModuleKeys()
  // Bağımlılıklar burada da tamamlanır: arayüz atlanıp bu fonksiyon doğrudan
  // çağrılsa bile DB'ye tutarsız bir küme (ör. restaurant açık, stock kapalı) yazılmasın.
  const granted = new Set(
    withModuleDependencies([...sanitizeDisabledModules(grantedModules), ...free]),
  )

  const unarchive = shouldUnarchive(granted, free) ? { archivedAt: null } : {}

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { suppressedModules: true },
  })
  if (!company) return

  const open = new Set(applySuppression([...granted], company.suppressedModules ?? []))
  await prisma.company.update({
    where: { id: companyId },
    data: { disabledModules: MODULE_KEYS.filter((k) => !open.has(k)), ...unarchive },
  })
}

/**
 * Elle kapatma isteği: hangi temel modüller, hangi kapsamda kapatılacak.
 *
 * `scope: "account"` kapatmayı hesabın tüm firmalarına (kök + şubeler + ek firmalar)
 * yayar; varsayılan yalnız verilen firmadır. Yetki artık zaten firma bazında olduğu için
 * "hesabın tümü" seçeneği bir KOLAYLIKTIR: aynı kararı firma firma tekrarlamamak için.
 */
export type SuppressionInput = { modules: string[]; scope?: "company" | "account" }

/**
 * Elle verilen modül setini FİRMA için KALICI yapar: o firmanın
 * `Subscription.purchasedModules` alanına yazar ve yetkiyi uygular.
 *
 * Kapsam firmadır: şubeye modül açmak ana firmayı, ana firmaya açmak şubeyi ETKİLEMEZ.
 * Abonelik firma düzeyine indiği için doğru davranış budur — eskiden bu fonksiyon
 * hesabın kök aboneliğini yazıyordu.
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
 *
 * `suppression` verilirse ELLE KAPATILAN temel modüller de aynı işlemde yazılır. İki
 * kapatma kanalı bilinçli olarak ayrı: ÜCRETLİ modülü kapatmak `grantedModules`tan
 * çıkarmakla olur (yetki hesaptan kalkar, abonelik onu faturalamaz), ÜCRETSİZ modülü
 * kapatmak ise `suppression` ile — çünkü yetki listesinden çıkarmak yetmez,
 * `applyEntitlements` ücretsizleri her uygulamada geri açar.
 */
export async function setCompanyModules(
  companyId: string,
  grantedModules: string[],
  suppression?: SuppressionInput,
): Promise<{ companyId: string; granted: string[]; durable: boolean; suppressed: string[] }> {
  const granted = withModuleDependencies(sanitizeDisabledModules(grantedModules))

  // ÜCRETSİZ modüller `purchasedModules`a YAZILMAZ: orası satın alınanın kaydıdır ve
  // ücretsizlik oradan değil `PricingItem.isFree`ten akar. Yazılsaydı, admin modülü
  // ücretliye çevirdiğinde hesap onu "satın almış" görünür, bedava kullanmaya devam
  // ederdi. `applyEntitlements` ücretsizleri zaten kendisi ekliyor.
  const freeKeys = await getFreeModuleKeys()
  const free = new Set(freeKeys)
  const purchased = granted.filter((k) => !free.has(k))

  // FİRMANIN kendi abonelik satırı. Yoksa yazılacak yer de yok: yetki şimdilik
  // `disabledModules`ta açık görünür ama ilk yeniden hesaplamada kapanır — `durable`
  // bunu söylüyor ve arayüz kullanıcıyı uyarıyor.
  const sub = await prisma.subscription.findFirst({
    where: { companyId },
    orderBy: { createdAt: "desc" },
  })
  if (sub) {
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { purchasedModules: purchased },
    })
  }

  // ELLE KAPATMA yetkiden ÖNCE yazılır: `applyEntitlements` alanı okuyup açık kümeden
  // düşüyor. `suppression` verilmediyse mevcut kapatmalara DOKUNULMAZ — reconcile,
  // yinelenen ödeme ve "kilitle/sıfırla" bu fonksiyonu kapatma bilgisi taşımadan
  // çağırıyor; çıkarım yapılsaydı (ör. "açık olmayan her ücretsiz kapatılmıştır")
  // kilitleme işlemi hesabın tüm temel modüllerini sessizce kapatırdı.
  const suppressed = suppression
    ? sanitizeSuppressedModules(suppression.modules, freeKeys)
    : []
  if (suppression) {
    const data = { suppressedModules: suppressed }
    if (suppression.scope === "account") {
      const rootCompanyId = await resolveAccountRootId(companyId)
      const ids = await getAccountCompanyIds(rootCompanyId)
      await prisma.company.updateMany({ where: { id: { in: ids } }, data })
      // Kapatma hesabın tümüne yayıldıysa yetki de her firmada yeniden uygulanmalı;
      // her firmanın açık kümesi KENDİ aboneliğinden üretilir.
      for (const id of ids.filter((x) => x !== companyId)) {
        const memberSub = await prisma.subscription.findFirst({
          where: { companyId: id },
          orderBy: { createdAt: "desc" },
        })
        await applyEntitlements(id, resolveGrantedModules(memberSub))
      }
    } else {
      await prisma.company.update({ where: { id: companyId }, data })
    }
  }

  await applyEntitlements(companyId, granted)

  // `durable` yalnız ÜCRETLİ modüller için anlamlı: ücretsiz olanlar zaten aboneliğe
  // bağlı değil, hiçbir yeniden hesaplamada kapanmıyor.
  const needsSubscription = purchased.length > 0
  return {
    companyId,
    granted,
    durable: !needsSubscription || (!!sub && (isPaidActive(sub) || isInGracePeriod(sub))),
    suppressed,
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
 * Gövdesi [[lib/billing/period.ts]]'e taşındı — abonelik EKRANI da "ödersem dönemim ne
 * zamana uzar" cümlesini basarken aynı cevabı vermek zorunda ve bu dosya prisma çektiği
 * için istemciye alınamıyor. Buradan yeniden dışa veriliyor ki mevcut çağıranlar
 * (satın alma callback'i, yinelenen çekim) değişmesin.
 */
export { periodEndFor } from "@/lib/billing/period"
