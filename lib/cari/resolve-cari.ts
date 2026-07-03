import { prisma } from "@/lib/db/prisma"
import { looksLikeCuid } from "@/lib/slug"

type CariModel = "customer" | "supplier"

/**
 * Cari (müşteri/tedarikçi) [id] route'ları için URL segmentini gerçek kayıt
 * id'sine (cuid) çevirir:
 * - Segment cuid ise (eski URL / bookmark / fatura-rapor linkleri) olduğu gibi döner.
 * - Segment slug ise, firma-içi (companyId verilmişse) veya global slug ile kaydı
 *   bulup id'sini döner. slug company başına unique olduğundan companyId ile
 *   daraltmak doğru kaydı garanti eder.
 * - Kayıt bulunamazsa orijinal segment döner; çağıran taraftaki mevcut
 *   `findUnique({ where: { id } })` doğal olarak "bulunamadı" (404) verir.
 *
 * Böylece route'ların kalan tüm `where: { id: resolvedParams.id }` sorguları,
 * PUT/DELETE/PATCH ve tx içindekiler dahil, hiç değişmeden çalışmaya devam eder.
 * Yetkilendirme yine `ensureCompanyAccess(record.companyId)` ile yapılır.
 */
export async function resolveCariId(
  model: CariModel,
  param: string,
  companyId?: string | null
): Promise<string> {
  if (looksLikeCuid(param)) return param
  const where = companyId ? { slug: param, companyId } : { slug: param }
  const rec =
    model === "customer"
      ? await prisma.customer.findFirst({ where, select: { id: true } })
      : await prisma.supplier.findFirst({ where, select: { id: true } })
  return rec?.id ?? param
}
