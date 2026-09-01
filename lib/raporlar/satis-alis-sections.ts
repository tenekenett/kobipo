/**
 * Satış / alış raporunun BÖLÜMLERİ.
 *
 * Kural: Excel'deki her sayfanın ekranda başlığı link olan bir kartı, kartın da
 * kendi alt sayfası vardır. Bu liste üç yerde okunuyor — özet ekranın kartları
 * (`components/raporlar/satis-alis-report.tsx`), alt sayfa gövdesi
 * (`components/raporlar/satis-alis-section.tsx`) ve dışa aktarma
 * (`lib/export/datasets/reports-satis-alis.ts`). Kopyalanırsa Excel'e eklenen bir
 * sayfa ekranda görünmez ya da kartın linki 404'e gider.
 */

import type { SalesPurchaseKind } from "./satis-alis"

export type SalesPurchaseSectionKey =
  | "aylik"
  | "cariler"
  | "siniflandirma"
  | "faturalar"
  | "kalemler"

export type SalesPurchaseSection = {
  key: SalesPurchaseSectionKey
  /** Alt sayfa yolunun son segmenti. Cari bölümünde satış/alışta FARKLIDIR. */
  slug: string
  /** Kart başlığı ve dışa aktarmadaki bölüm başlığı. */
  title: string
  description: string
  /** Excel sayfa adı — kart ile dosya sekmesi aynı şeyi anlatsın. */
  sheetName: string
  /** Fatura KALEMLERİ gerekiyor mu (uçta `includeLines`). */
  needsLines: boolean
}

/** `/raporlar/satis` | `/raporlar/alis` — alt sayfalar bunun altında yaşar. */
export function reportBasePath(kind: SalesPurchaseKind): string {
  return kind === "SALES" ? "/raporlar/satis" : "/raporlar/alis"
}

export function salesPurchaseSections(kind: SalesPurchaseKind): SalesPurchaseSection[] {
  const isSales = kind === "SALES"
  return [
    {
      key: "aylik",
      slug: "aylik",
      title: "Aylık Dağılım",
      description: "Fatura tarihine göre ay ay toplam ve fatura adedi",
      sheetName: "Aylık",
      needsLines: false,
    },
    {
      key: "cariler",
      slug: isSales ? "musteriler" : "tedarikciler",
      title: isSales ? "En Çok Satış Yapılan Müşteriler" : "En Çok Alış Yapılan Tedarikçiler",
      description: "Sınıflandırmalarıyla birlikte, tutara göre sıralı",
      sheetName: isSales ? "Müşteriler" : "Tedarikçiler",
      needsLines: false,
    },
    {
      key: "siniflandirma",
      slug: "siniflandirma",
      title: "Sınıflandırma Özeti",
      description: "Cari tanımlarına göre kırılım — hangi gruba ne kadar",
      sheetName: "Sınıflandırma",
      needsLines: false,
    },
    {
      key: "faturalar",
      slug: "faturalar",
      title: "Faturalar",
      description: "Dönemdeki tüm faturalar; iadeler eksi tutarla",
      sheetName: "Faturalar",
      needsLines: false,
    },
    {
      key: "kalemler",
      slug: "kalemler",
      title: "Detaylı Faturalar",
      description: "Her satır bir fatura kalemi — stok/hizmet kırılımı",
      sheetName: "Detaylı Faturalar",
      needsLines: true,
    },
  ]
}

export function findSalesPurchaseSection(
  kind: SalesPurchaseKind,
  slug: string | null | undefined
): SalesPurchaseSection | null {
  if (!slug) return null
  return salesPurchaseSections(kind).find((section) => section.slug === slug) ?? null
}

/** Bölümün alt sayfa yolu. `?company=` çağıran tarafta eklenir (bkz. withCompanyHref). */
export function sectionPath(kind: SalesPurchaseKind, section: SalesPurchaseSection): string {
  return `${reportBasePath(kind)}/${section.slug}`
}
