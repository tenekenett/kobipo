import { headers } from "next/headers"
import { prisma } from "@/lib/db/prisma"
import { AccountArchivedError } from "@/lib/billing/archive"
import { getCurrentUser } from "@/lib/auth/session"
import { getUserContext, type UserCompanyContext } from "@/lib/auth/user-context"
import {
  MODULE_GATE_METHOD_HEADER,
  MODULE_GATE_PATH_HEADER,
  ModuleLockedError,
  isApiPathAllowed,
  isArchiveExportPath,
  requiredModulesForApiPath,
} from "@/lib/module-access"
import {
  PageForbiddenError,
  isApiPathAllowedForUser,
  isPageGateApplicable,
  isReadOnlyMembership,
  requiredPagesForApiPath,
  type PagePermissions,
} from "@/lib/page-access"
import { cache } from "react"

export async function getCurrentCompany(companyId: string) {
  const user = await getCurrentUser()
  if (!user) {
    throw new Error("Unauthorized")
  }

  const userCompany = await prisma.userCompany.findFirst({
    where: {
      userId: user.id,
      companyId: companyId,
    },
    include: {
      company: {
        select: {
          id: true,
          name: true,
          taxNumber: true,
          taxOffice: true,
          address: true,
          city: true,
          country: true,
          phone: true,
          email: true,
          website: true,
          isEDonusumEnabled: true,
          invoiceSeriesPrefix: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  })

  if (!userCompany) {
    throw new Error("Company not found or access denied")
  }

  return userCompany.company
}

export async function getUserCompanies() {
  const user = await getCurrentUser()
  if (!user) {
    return []
  }

  const userCompanies = await prisma.userCompany.findMany({
    where: {
      userId: user.id,
    },
    include: {
      company: {
        select: {
          id: true,
          name: true,
          taxNumber: true,
          taxOffice: true,
          address: true,
          city: true,
          country: true,
          phone: true,
          email: true,
          website: true,
          isEDonusumEnabled: true,
          invoiceSeriesPrefix: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  })

  return userCompanies.map((uc) => uc.company)
}

/**
 * Sunucu tarafı MODÜL kapısı. Modül yalnızca satın almayla açıldığı için (bkz.
 * lib/billing/entitlements.ts) kapalı bir modülün ucu elle çağrıldığında da reddedilmeli
 * — menü gizleme ve ModuleGuard istemci tarafındadır, ücretli özelliği korumaz.
 *
 * Yalnız `/api/*` için çalışır: yolu kökteki proxy.ts header'a yazar, kural haritası
 * lib/module-access.ts'tedir. Sayfa render'ında header yoktur → kapı uygulanmaz, orada
 * ModuleGuard "Bu modül kapalı" ekranını gösterir.
 *
 * Süper-admin muaftır (destek/yönetim erişimi).
 */
async function assertModuleAccess(
  company: UserCompanyContext,
  isSuperAdmin: boolean
): Promise<void> {
  if (isSuperAdmin) return

  const request = await currentApiRequest()
  if (!request) return
  const { pathname, method } = request

  if (isApiPathAllowed(pathname, method, company.disabledModules)) return

  // ARŞİV İSTİSNASI: salt-okunur arşivdeki hesap kendi verisini İNDİREBİLMELİ. Modülleri
  // kapalı olduğu için normal kural onu keserdi ve "verilerinizi indirin" ekranı 403
  // döndüren bir düğmeden ibaret kalırdı (bkz. lib/module-access.ts → isArchiveExportPath).
  if (company.isArchived && isArchiveExportPath(pathname, method)) return

  // Mesajı "Access denied" ile başlar (route catch'leri 403'e onunla mapler); gövdeye
  // `code: "MODULE_LOCKED"` taşımak `lib/api/errors.ts → accessDeniedResponse`'un işi.
  throw new ModuleLockedError(requiredModulesForApiPath(pathname, method))
}

/**
 * Sunucu tarafı SAYFA kapısı — kısıtlı çalışan izinleri (bkz. lib/page-access.ts).
 *
 * Modül kapısının hemen ardından çalışır ve sırası önemlidir: "modül satın alınmamış"
 * ile "senin yetkin yok" farklı ekranlar açar (satın alma daveti vs. yöneticine
 * başvur). Süper-admin etkilenmez.
 *
 * KAPSAM `isPageGateApplicable`ten gelir — burada ayrıca "kısıtlı mı?" diye SORMAYIN:
 * `ENFORCE_ROLE_MATRIX_FOR_UNRESTRICTED` açıldığında kapı kısıtsız üyelikleri de
 * kapsar, oysa buradaki erken dönüş onları sessizce muaf tutardı ve bayrak yalnız
 * yarım çalışırdı.
 */
async function assertPageAccess(
  company: UserCompanyContext,
  isSuperAdmin: boolean
): Promise<void> {
  if (isSuperAdmin) return
  if (!isPageGateApplicable(pagePermissionsOf(company))) return

  const request = await currentApiRequest()
  if (!request) return
  const { pathname, method } = request

  if (isApiPathAllowedForUser(pathname, method, pagePermissionsOf(company))) return

  throw new PageForbiddenError(requiredPagesForApiPath(pathname, method))
}

/** Üyelik bağlamından sayfa-izni görünümü. */
export function pagePermissionsOf(company: UserCompanyContext): PagePermissions {
  return {
    role: company.role,
    allowedPaths: company.allowedPaths ?? [],
    writablePaths: company.writablePaths ?? [],
    // Özel rol tavanı değiştirir: hazır matris yerine yönetim-dışı tüm sayfalar.
    custom: Boolean(company.customRoleId),
  }
}

/**
 * İşlenmekte olan `/api/*` isteğinin yolu ve metodu — kökteki proxy.ts header'a yazar.
 * İstek kapsamı dışında (build, script, cron) çağrıldığında null döner ve kapılar
 * uygulanmaz.
 */
async function currentApiRequest(): Promise<{ pathname: string; method: string } | null> {
  try {
    const requestHeaders = await headers()
    const pathname = requestHeaders.get(MODULE_GATE_PATH_HEADER)
    if (!pathname) return null
    return { pathname, method: requestHeaders.get(MODULE_GATE_METHOD_HEADER) ?? "GET" }
  } catch {
    return null
  }
}

/**
 * Modül kapısını, isteğin KENDİ yolu yerine açıkça verilen bir yol için uygular.
 *
 * Kapı normalde `x-kobipo-path`'i okur; ama bazı uçlar hangi veriyi verecekleri bilgisini
 * yolda değil query'de taşır — ör. `/api/export?module=products`, `/api/export/products`
 * ile aynı veriyi döndürür ama o yolun kuralına takılmaz. Böyle bir uç karşılık gelen
 * "gerçek" yolu buraya sorar; kural tablosu (lib/module-access.ts) tek kaynak kalır.
 */
export async function assertModulePath(
  company: UserCompanyContext,
  pathname: string,
  method = "GET"
): Promise<void> {
  const context = await getUserContext()
  if (context?.isSuperAdmin) return
  if (isApiPathAllowed(pathname, method, company.disabledModules)) return
  throw new ModuleLockedError(requiredModulesForApiPath(pathname, method))
}

/**
 * `assertModulePath`in sayfa-izni karşılığı. Aynı gerekçe: hedefini query'de taşıyan
 * uç (`/api/export?module=products`) kendi yolundan değil, karşılık gelen "gerçek"
 * yoldan denetlenmeli — aksi halde kısıtlı çalışan, izinsiz sayfanın verisini
 * export üzerinden çekebilirdi.
 */
export async function assertPagePath(
  company: UserCompanyContext,
  pathname: string,
  method = "GET"
): Promise<void> {
  const context = await getUserContext()
  if (context?.isSuperAdmin) return
  const permissions = pagePermissionsOf(company)
  if (!isPageGateApplicable(permissions)) return
  if (isApiPathAllowedForUser(pathname, method, permissions)) return
  throw new PageForbiddenError(requiredPagesForApiPath(pathname, method))
}

export const ensureCompanyAccess = cache(async function ensureCompanyAccess(
  companyId: string
): Promise<UserCompanyContext> {
  const context = await getUserContext()
  if (!context) {
    throw new Error("Unauthorized")
  }

  const match = context.companies.find((entry) => entry.companyId === companyId)
  if (match) {
    // Pasif firmaya normal kullanıcı (üye) erişemez; yalnızca super admin yönetim
    // amacıyla erişebilir. "Access denied" ifadesi API route catch'lerinde 403'e maplenir.
    if (!match.isActive && !context.isSuperAdmin) {
      throw new Error("Access denied: company is inactive")
    }
    await assertModuleAccess(match, context.isSuperAdmin)
    await assertPageAccess(match, context.isSuperAdmin)
    return match
  }

  if (!context.isSuperAdmin) {
    throw new Error("Access denied to this company")
  }

  // Super admin fallback: companies aren't pre-loaded, hit DB once for membership/role.
  const userCompany = await prisma.userCompany.findFirst({
    where: { userId: context.userId, companyId },
    include: {
      company: {
        select: {
          slug: true,
          name: true,
          branchName: true,
          isActive: true,
          isEDonusumEnabled: true,
          disabledModules: true,
          archivedAt: true,
        },
      },
    },
  })

  if (!userCompany) {
    throw new Error("Access denied to this company")
  }

  // Buraya yalnız süper-admin düşer (yukarıdaki fallback); sayfa kapısı ona
  // uygulanmadığı için izin alanları okunmadan kısıtsız geçilir.
  return {
    companyId: userCompany.companyId,
    companySlug: userCompany.company.slug,
    companyName: userCompany.company.name,
    companyBranchName: userCompany.company.branchName ?? null,
    role: userCompany.role,
    isActive: userCompany.company.isActive,
    isEDonusumEnabled: userCompany.company.isEDonusumEnabled,
    disabledModules: userCompany.company.disabledModules ?? [],
    isArchived: userCompany.company.archivedAt != null,
    allowedPaths: [],
    writablePaths: [],
    customRoleId: null,
    customRoleName: null,
    createdAt: userCompany.createdAt,
  }
})

/**
 * Yazma (mutasyon) uçları için erişim + rol kontrolü. Salt-okuma rolü VIEWER reddedilir —
 * nav-config'te VIEWER yalnızca raporları görür, hiçbir yazma ekranında yer almaz; bu yüzden
 * veri-yazan uçlar VIEWER'a kapalıdır. "Access denied" ifadesi mevcut route catch'lerinde
 * 403'e maplenir; catch'i olmayan uçlarda istek yine (fail-closed) reddedilir.
 *
 * Sayfa bazlı yazma kısıtı (kısıtlı çalışanın "görsün ama değiştirmesin" izni) burada
 * DEĞİL, `ensureCompanyAccess` içindeki sayfa kapısında uygulanır: orası isteğin
 * metodunu da gördüğü için tek noktada hem okuma hem yazma kararını verir.
 *
 * Rol bazlı çapraz-modül yazma kısıtı (ör. SALES ↛ stok) 2026-08-20'den beri
 * uygulanıyor — ama burada değil, sayfa kapısında: `ENFORCE_ROLE_MATRIX_FOR_UNRESTRICTED`
 * açık olduğu için `ensureCompanyAccess` her isteği rol matrisiyle karşılaştırır.
 * Buradaki kontrol ondan bağımsızdır ve salt-okunur üyeliği kapsar.
 *
 * ARŞİV: saklama süresi dolmuş hesap salt-okunurdur ([[lib/billing/archive.ts]]).
 * Kontrol burada — `ensureCompanyAccess`te DEĞİL: arşivde okuma açık kalmalı, müşteri
 * geçmişini görebilmeli. `ensureCompanyExport` de bilerek dokunulmadı; verisini
 * indirebilmek arşivin varlık sebebidir.
 */
export async function ensureCompanyWrite(
  companyId: string,
): Promise<UserCompanyContext> {
  const context = await ensureCompanyAccess(companyId)
  // Rolden ÖNCE sorulur: arşivde yetkinin kimde olduğu fark etmez, hesap yazmaya
  // kapalıdır. Sonra sorulsaydı ADMIN "yetkin var" cevabıyla geçerdi.
  if (context.isArchived) {
    throw new AccountArchivedError()
  }
  // Enum VIEWER ve "hiçbir sayfada düzenleme yok" diye tanımlanmış özel rol aynı şeydir:
  // salt-okunur üyelik. Eskiden yalnız enum'a bakılıyordu, oysa özel rolün enum'u
  // CUSTOM'dur — Gözlemci kalıbından üretilmiş bir rol bu kapıdan hiç takılmadan
  // geçiyordu. Karar `lib/page-access.ts` ile ORTAK; arayüzdeki `useCanEdit` de aynı
  // yordamdan besleniyor, ikisi ayrışamaz.
  if (isReadOnlyMembership(pagePermissionsOf(context))) {
    throw new Error("Access denied: read-only role")
  }
  return context
}

/**
 * Veriyi dışarı çıkaran uçlar için kapı: Excel/PDF/CSV dışa aktarma, belge PDF'i,
 * yazdırma dökümü, dosya indirme.
 *
 * Bunlar HTTP'de birer GET'tir, yani `ensureCompanyAccess`ten sorunsuz geçerler —
 * ama "görüntüleme yetkisi" ekranda okumakla sınırlıdır: salt-okunur bir üyeliğin
 * tüm cari listesini Excel'e ya da bordroyu PDF'e dökebilmesi, o sınırın anlamını
 * boşaltır. Düğmeleri gizlemek yetmez (bkz. `useCanExport`); adres elle de çağrılabilir.
 *
 * `ensureCompanyWrite` ile AYNI yordamdan (`isReadOnlyMembership`) besleniyor ama ayrı
 * bir kapı: yazma değil, çıktı kararıdır — rapor sayfaları hiç kimsenin yazamadığı
 * ekranlardır, oradan dışa aktarmayı yazma kapısına bağlamak yöneticiyi de keserdi.
 */
export async function ensureCompanyExport(
  companyId: string,
): Promise<UserCompanyContext> {
  const context = await ensureCompanyAccess(companyId)
  if (isReadOnlyMembership(pagePermissionsOf(context))) {
    throw new Error("Access denied: read-only role cannot export")
  }
  return context
}

