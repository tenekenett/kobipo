/**
 * Cari SINIFLANDIRMA EKSENLERİNİN adı.
 *
 * İki kavram karışmasın:
 *   • `CompanyDefinition` → eksenin ÖĞELERİ ("Bayi", "Perakende", "Marmara").
 *   • buradaki etiketler   → eksenin KENDİSİ ("Müşteri Tipi", "Bölge").
 *
 * Eksenin adı yoktu; her ekranda ve Excel'de "Sınıflandırma 1 / 2" yazıyordu ve
 * firmanın hangi eksene ne koyduğunu hatırlaması gerekiyordu. Firma adını
 * yazınca tüm rapor başlıkları onunla değişir; boş bırakılırsa eski etiketlere
 * düşülür (tek kaynak burasıdır).
 */

export type ClassificationLabels = { class1: string; class2: string }

export const DEFAULT_CLASSIFICATION_LABELS: ClassificationLabels = {
  class1: "Sınıflandırma 1",
  class2: "Sınıflandırma 2",
}

/** Etiket adı için üst sınır — `companies.classification1Label` VARCHAR(60). */
export const CLASSIFICATION_LABEL_MAX = 60

export function resolveClassificationLabels(company?: {
  classification1Label?: string | null
  classification2Label?: string | null
} | null): ClassificationLabels {
  return {
    class1: company?.classification1Label?.trim() || DEFAULT_CLASSIFICATION_LABELS.class1,
    class2: company?.classification2Label?.trim() || DEFAULT_CLASSIFICATION_LABELS.class2,
  }
}

/** Kaydedilecek değer: boş/uzun girişleri normalize eder. `null` → varsayılana dön. */
export function normalizeClassificationLabel(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim().slice(0, CLASSIFICATION_LABEL_MAX)
  return trimmed.length > 0 ? trimmed : null
}
