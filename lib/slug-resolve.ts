import { prisma } from "@/lib/db/prisma"
import { looksLikeCuid } from "@/lib/slug"

/**
 * SEF (okunabilir URL) [id] route'ları için ortak çözümleyici — cari'deki
 * `resolveCariId`'nin genelleştirilmiş hâli (bkz. lib/cari/resolve-cari.ts).
 * URL segmentini gerçek kayıt id'sine (cuid) çevirir:
 * - Segment cuid ise (eski URL / bookmark / çapraz linkler) olduğu gibi döner.
 * - Segment slug ise, firma-içi (companyId verilmişse) slug ile kaydı bulup
 *   id'sini döner. slug company başına unique olduğundan companyId ile daraltmak
 *   doğru kaydı garanti eder — aksi hâlde iki firma aynı slug'a sahipse global
 *   findFirst yanlış firmaya düşebilir. Bu yüzden çağıran taraf mümkünse
 *   companyId geçmelidir.
 * - Kayıt bulunamazsa orijinal segment döner; çağıran taraftaki
 *   `findUnique({ where: { id } })` doğal olarak "bulunamadı" (404) verir.
 *
 * Böylece route'ların kalan tüm `where: { id }` sorguları (PUT/DELETE/PATCH ve
 * tx içindekiler dahil) hiç değişmeden çalışır; yetki yine
 * `ensureCompanyAccess(record.companyId)` ile yapılır.
 */
type SlugModel = "product" | "quote" | "employee" | "financialAccount" | "invoice"

type SlugDelegate = {
  findFirst: (args: {
    where: { slug: string; companyId?: string }
    select: { id: true }
  }) => Promise<{ id: string } | null>
}

export async function resolveSlugId(
  model: SlugModel,
  param: string,
  companyId?: string | null
): Promise<string> {
  if (looksLikeCuid(param)) return param
  const where = companyId ? { slug: param, companyId } : { slug: param }
  const delegate = prisma[model] as unknown as SlugDelegate
  const rec = await delegate.findFirst({ where, select: { id: true } })
  return rec?.id ?? param
}
