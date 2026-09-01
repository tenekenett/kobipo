/**
 * Dataset'lerin ortak yardımcıları: antet için firma bilgisi ve okunur filtre
 * özeti.
 */

import { prisma } from "@/lib/db/prisma"
import type { ClassificationLabels } from "@/lib/company/classification-labels"
import { loadCompanyClassificationLabels } from "@/lib/company/classification-labels.server"
import type { ExportCompany } from "../types"
import { formatCellText } from "../values"

export async function loadExportCompany(companyId: string): Promise<ExportCompany> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { name: true, taxNumber: true, taxOffice: true, address: true, city: true, phone: true },
  })
  return company ?? { name: "-" }
}

/**
 * Filtre özeti — kullanıcı altı ay sonra dosyayı açtığında hangi kesitten
 * üretildiğini görebilmeli. Boş/anlamsız filtreler satır işgal etmesin diye
 * ayıklanır.
 */
/**
 * Sınıflandırma EKSENLERİNİN adı. Dosyadaki sütun başlığı ekranla aynı kelimeyi
 * yazsın diye dataset'ler bunu okur (firma ad vermediyse "Sınıflandırma 1/2").
 */
export async function loadClassificationLabels(companyId: string): Promise<ClassificationLabels> {
  return loadCompanyClassificationLabels(companyId)
}

export function describeFilters(entries: Array<[string, unknown]>): string[] {
  return entries
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([label, value]) => `${label}: ${value}`)
}

export function describeDateRange(start?: string | Date | null, end?: string | Date | null): string | null {
  const from = start ? formatCellText(start, "date") : ""
  const to = end ? formatCellText(end, "date") : ""
  if (!from && !to) return null
  if (from && to) return `${from} – ${to}`
  return from || to
}
