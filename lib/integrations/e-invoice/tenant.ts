import { prisma } from "@/lib/db/prisma"

/** VKN/TCKN'yi sadeleştirir; 10 (kurumsal) veya 11 (gerçek kişi) hane değilse boş döner. */
export function cleanVkn(value?: string | null): string {
  const s = (value || "").replace(/\D/g, "")
  return s.length === 10 || s.length === 11 ? s : ""
}

type CompanyVknFields = {
  taxNumber?: string | null
  eDonusumTenantVkn?: string | null
  parentCompany?: { taxNumber?: string | null } | null
}

/**
 * Firmanın Mysoft mükellef VKN'si. AYRI BİR DOĞRULAMA ADIMI YOKTUR:
 * doğrudan firmanın kendi VKN'sinden çekilir (şubede ana firmadan devralınır).
 * Geriye dönük uyumluluk için elle kaydedilmiş eDonusumTenantVkn varsa o da kabul edilir.
 *
 * Yüklü bir company objesinden senkron çözüm. Provider yine de JWT'den keşfi
 * yedek olarak yapar; bu, deterministik (firma VKN'si) değeri sağlar.
 */
export function effectiveTenantVkn(company: CompanyVknFields | null | undefined): string {
  if (!company) return ""
  // Geriye dönük uyumluluk: elle kaydedilmiş (eski "doğrulanmış") değer varsa onu
  // bozma. Yoksa firmanın kendi VKN'sinden (şubede ana firmadan) otomatik çek.
  return (
    cleanVkn(company.eDonusumTenantVkn) ||
    cleanVkn(company.taxNumber) ||
    cleanVkn(company.parentCompany?.taxNumber)
  )
}

/** companyId'den firmanın mükellef VKN'sini çözer (DB'den okur). */
export async function resolveCompanyTenantVkn(companyId: string): Promise<string> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      taxNumber: true,
      eDonusumTenantVkn: true,
      parentCompany: { select: { taxNumber: true } },
    },
  })
  return effectiveTenantVkn(company)
}
