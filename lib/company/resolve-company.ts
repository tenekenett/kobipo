import { prisma } from "@/lib/db/prisma"
import { looksLikeCuid } from "@/lib/slug"

/**
 * Firma (tenant) URL param'ını gerçek Company id'sine (cuid) çevirir — SEF için.
 * Dashboard URL'lerinde artık `?company=<slug>` taşındığından, bu değeri API'lere
 * `companyId` olarak gelen slug'ı cuid'e çevirmek üzere kullanılır.
 *
 * - null/boş ise aynen döner → çağıran taraftaki "companyId zorunlu" (400) korunur.
 * - cuid ise aynen döner → eski URL'ler, dahili/webhook çağrıları, ikinci kez çözüm.
 * - slug ise Company.slug (GLOBAL benzersiz) ile id'ye çevrilir; bulunamazsa param
 *   aynen döner ve `ensureCompanyAccess` doğal olarak "erişim reddi" verir (güvenli
 *   hata modu — yanlış firmaya veri sızmaz).
 *
 * Company.slug global benzersiz olduğundan companyId scope'u gerekmez.
 */
export async function resolveCompanyId(
  param: string | null | undefined
): Promise<string | null> {
  if (!param) return param ?? null
  if (looksLikeCuid(param)) return param
  const rec = await prisma.company.findFirst({
    where: { slug: param },
    select: { id: true },
  })
  return rec?.id ?? param
}
