// Ücretsiz modül kümesi DEĞİŞTİĞİNDE mevcut hesapları hizalayan iş.
//
// Neden ayrı dosya: bu iş hem ücretsiz kümeyi (free-modules.ts) hem abonelik yetkisini
// (entitlements.ts) okur. `entitlements.ts` de free-modules.ts'i okuduğu için ikisini tek
// dosyada tutmak döngüsel import yaratırdı. Yön tek: entitlements → free-modules, ve bu
// dosya ikisinin de üstünde durur.

import { prisma } from "@/lib/db/prisma"
import {
  MODULE_KEYS,
  applySuppression,
  sanitizeFreeModules,
  withModuleDependencies,
} from "@/lib/modules"
import { resolveGrantedModules } from "@/lib/billing/entitlements"

/** Hizalamada okunan firma alanları. */
export type SyncCompanyView = {
  id: string
  disabledModules: string[]
  /** Sistem yöneticisinin bu firmada elle kapattığı temel modüller. */
  suppressedModules?: string[]
}

export type FreeModuleDelta = {
  /** Ücretsiz OLAN modüller — her firmada açılır. */
  opened: string[]
  /** Ücretsizliği KALKAN modüller — YÖNETİLEN firmalarda kapanır (aşağıdaki kurala bak). */
  closed: string[]
  /** Değişiklikten ÖNCEKİ ücretsiz küme — "yönetilen satır" ölçüsü buna göre kurulur. */
  previousFree: string[]
}

/** Ücretsiz kümenin iki hâli arasındaki simetrik fark. */
export function freeModuleDelta(previousFree: string[], nextFree: string[]): FreeModuleDelta {
  const prev = sanitizeFreeModules(previousFree)
  const prevSet = new Set(prev)
  const next = new Set(sanitizeFreeModules(nextFree))
  return {
    opened: MODULE_KEYS.filter((k) => next.has(k) && !prevSet.has(k)),
    closed: MODULE_KEYS.filter((k) => prevSet.has(k) && !next.has(k)),
    previousFree: prev,
  }
}

/**
 * `applyEntitlements`in yazacağı `disabledModules` — yani satırın YÖNETİLEN hâli.
 * `disabled = TÜM − (verilen ∪ ücretsiz)`, bağımlılıklar tamamlanmış, elle kapatılanlar
 * (ve onlara bağımlı olanlar) düşülmüş.
 */
function managedDisabledShape(
  granted: Set<string>,
  free: string[],
  suppressed: string[] = [],
): Set<string> {
  const open = new Set(applySuppression(withModuleDependencies([...granted, ...free]), suppressed))
  return new Set(MODULE_KEYS.filter((k) => !open.has(k)))
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false
  for (const v of a) if (!b.has(v)) return false
  return true
}

/**
 * Hizalamanın KARAR kısmı — saf. DB'ye yazılacak satırları üretir; değişmeyen firma
 * listeye girmez.
 *
 * Yalnızca değişen anahtarlara dokunur — bütün `disabledModules` listelerini yeniden
 * üretmez. Bu bilinçli: tam yeniden hesaplama, süper-admin'in elle açtığı demo hesapları
 * ve deneme hesaplarını sessizce kilitlerdi (yetki `purchasedModules` + ücretli-aktiflik
 * şartından üretilir, bkz. `resolveGrantedModules`).
 *
 * AÇMA herkese işler — "temel modül" tanımı bu.
 *
 * KAPATMA yalnız YÖNETİLEN satırlara işler: firmanın bugünkü `disabledModules`'ı, önceki
 * ücretsiz kümeyle `applyEntitlements`in yazacağı listeyle birebir aynıysa o satırı bu
 * sistem yazmıştır ve geri alınabilir. Değilse dokunulmaz.
 *
 * Bu kural olmadan felaket oluyordu: modül kilidi 2026-08'de kurulurken mevcut hesaplara
 * bilinçli olarak DOKUNULMAMIŞTI (bkz. docs/paket-abonelik/MODUL-KILIDI.md → "Karar"), yani
 * canlıdaki 32 firmanın 22'si `disabledModules = []` ile duruyor — her şey açık, hiçbiri
 * satın alınmamış. "Satın almamışsan kapat" kuralı, bir modül bir kez ücretsiz yapılıp geri
 * alındığında bu firmalarda o modülü KAPATIRDI; ölçüldü, 25 firma etkileniyordu. Oysa onlar
 * o modülü ücretsizlikten değil, en baştan beri açık taşıyor.
 *
 * @param grantedByCompany firma → KENDİ aboneliğinin bugün verdiği modüller. Abonelik
 *        firma düzeyinde olduğu için anahtar hesap kökü değil firmanın kendisidir;
 *        kökten okunsaydı ödemeyen bir şube ana firmanın hakkıyla korunurdu.
 */
export function planFreeModuleSync(
  companies: SyncCompanyView[],
  grantedByCompany: Map<string, Set<string>>,
  delta: FreeModuleDelta,
): Array<{ id: string; disabledModules: string[]; suppressedModules?: string[] }> {
  const updates: Array<{ id: string; disabledModules: string[]; suppressedModules?: string[] }> = []
  if (delta.opened.length === 0 && delta.closed.length === 0) return updates

  for (const company of companies) {
    const granted = grantedByCompany.get(company.id) ?? new Set<string>()
    const disabled = new Set(company.disabledModules ?? [])
    const suppressed = new Set(company.suppressedModules ?? [])
    // Satırı bu sistem mi yazmış? Ölçü DEĞİŞİKLİKTEN ÖNCEKİ hâle bakılarak alınır.
    const managed = sameSet(
      disabled,
      managedDisabledShape(granted, delta.previousFree, [...suppressed]),
    )
    let changed = false
    let suppressionChanged = false

    for (const key of delta.opened) {
      // Sistem yöneticisi bu firmada bilerek kapatmış: ücretsiz olması onu açmaz.
      // Kapatmanın tüm anlamı budur, aksi halde ilk fiyat düzenlemesinde geri açılırdı.
      if (suppressed.has(key)) continue
      if (disabled.delete(key)) changed = true
    }
    for (const key of delta.closed) {
      // Modül artık ÜCRETLİ: "temel modülü kapat" kaydı anlamını yitirir, düşülür.
      // Kalsaydı, hesap o modülü sonradan satın aldığında kapatma yetkiyi sessizce
      // yer ve müşteri kullanamadığı bir modüle ödeme yapmış olurdu.
      if (suppressed.delete(key)) suppressionChanged = true
      // Parası ödenmiş: ücretsizlik kalksa da kapatılmaz.
      if (granted.has(key)) continue
      // Yönetilmeyen satır (ör. modül kilidi öncesinden tamamen açık gelen eski hesap):
      // o modülü ücretsizlikten almadı, geri alınacak bir şey yok.
      if (!managed) continue
      if (!disabled.has(key)) {
        disabled.add(key)
        changed = true
      }
    }
    if (changed || suppressionChanged) {
      updates.push({
        id: company.id,
        disabledModules: MODULE_KEYS.filter((k) => disabled.has(k)),
        ...(suppressionChanged
          ? { suppressedModules: MODULE_KEYS.filter((k) => suppressed.has(k)) }
          : {}),
      })
    }
  }
  return updates
}

/**
 * Ücretsiz küme değiştiğinde mevcut hesapları hizalar (okuma → karar → yazma).
 *
 * - Ücretsiz OLAN modül  → her firmada `disabledModules`tan çıkarılır (açılır); ELLE
 *                          KAPATILMIŞ firmalar hariç.
 * - Ücretsizliği KALKAN  → hesabın aboneliği o modülü hâlâ veriyorsa dokunulmaz;
 *                          vermiyorsa `disabledModules`a geri eklenir (kapanır). Modül
 *                          ücretliye döndüğü için elle kapatma kaydı da düşer.
 *
 * Yeni firmalar bu yoldan geçmez; onlar zaten `createCompany` içinde doğru doğar.
 */
export async function syncFreeModuleGrants(
  previousFree: string[],
  nextFree: string[],
): Promise<{ opened: string[]; closed: string[]; updatedCompanies: number }> {
  const delta = freeModuleDelta(previousFree, nextFree)
  if (delta.opened.length === 0 && delta.closed.length === 0) {
    return { ...delta, updatedCompanies: 0 }
  }

  const [companies, subscriptions] = await Promise.all([
    prisma.company.findMany({
      select: {
        id: true,
        disabledModules: true,
        suppressedModules: true,
      },
    }),
    prisma.subscription.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        companyId: true,
        status: true,
        purchasedModules: true,
        trialEndsAt: true,
        periodEnd: true,
      },
    }),
  ])

  // Firma → KENDİ aboneliğinin bugün verdiği modüller. Sorgu tarihe göre sıralı; ilk
  // görülen satır en günceli olduğu için sonrakiler atlanır (`getCompanySubscription`
  // ile aynı seçim).
  const grantedByCompany = new Map<string, Set<string>>()
  for (const sub of subscriptions) {
    if (grantedByCompany.has(sub.companyId)) continue
    grantedByCompany.set(sub.companyId, new Set(resolveGrantedModules(sub)))
  }

  const updates = planFreeModuleSync(companies, grantedByCompany, delta)

  // Parçalı transaction: tek seferde binlerce update'i tek işleme sokmak bağlantıyı uzun
  // süre kilitler. Hesap sayısı bugün küçük, yarın büyüyebilir.
  const CHUNK = 100
  for (let i = 0; i < updates.length; i += CHUNK) {
    await prisma.$transaction(
      updates.slice(i, i + CHUNK).map((u) =>
        prisma.company.update({
          where: { id: u.id },
          data: {
            disabledModules: u.disabledModules,
            ...(u.suppressedModules ? { suppressedModules: u.suppressedModules } : {}),
          },
        }),
      ),
    )
  }

  return { ...delta, updatedCompanies: updates.length }
}
