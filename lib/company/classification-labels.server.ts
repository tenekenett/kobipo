import { prisma } from "@/lib/db/prisma"
import {
  DEFAULT_CLASSIFICATION_LABELS,
  resolveClassificationLabels,
  type ClassificationLabels,
} from "./classification-labels"

/**
 * Eksen adlarını veritabanından okur. SUNUCU tarafı: saf yardımcı
 * (`classification-labels.ts`) istemci bileşenlerine de gittiği için Prisma
 * oraya konmadı.
 *
 * Kolon (`companies.classification1Label`) migrasyonla geliyor. Migrasyon canlıya
 * uygulanmadan bu sorgu HATA verir ve rapor dışa aktarmalarının tamamı çöker;
 * o yüzden okuma hatası varsayılana düşer — ama SESSİZ değil: sebep loglanır.
 * Migrasyon: supabase/migrations/20260901000001_classification_axis_labels.sql
 */
export async function loadCompanyClassificationLabels(
  companyId: string
): Promise<ClassificationLabels> {
  try {
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { classification1Label: true, classification2Label: true },
    })
    return resolveClassificationLabels(company)
  } catch (error) {
    console.warn(
      "[classification-labels] eksen adları okunamadı, varsayılana düşüldü " +
        "(20260901000001_classification_axis_labels.sql uygulandı mı?):",
      error
    )
    return DEFAULT_CLASSIFICATION_LABELS
  }
}
