/**
 * Merkezi site/SEO yapılandırması — marka metinleri, canonical domain ve varsayılan
 * OG görseli tek kaynaktan yönetilir. metadata, sitemap, robots, manifest ve JSON-LD
 * builder'ları buradan beslenir.
 */
export const siteConfig = {
  name: "Kobipo",
  tagline: "Az laf, doğru rakam.",
  title: "Kobipo — Az laf, doğru rakam.",
  titleTemplate: "%s | Kobipo",
  description:
    "KOBİ'lerin dijital muhasebe ve işletme yönetim platformu. Cari hesaplar, stok takibi, e-fatura ve finansal raporlar tek platformda.",
  // Canonical/OG için mutlak URL. Env yoksa üretim domainine düşer.
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.kobipo.com").replace(/\/+$/, ""),
  locale: "tr_TR",
  language: "tr-TR",
  keywords: [
    "ön muhasebe",
    "ön muhasebe programı",
    "KOBİ muhasebe",
    "e-fatura",
    "e-arşiv",
    "cari hesap",
    "stok takibi",
    "işletme yönetim yazılımı",
    "finansal raporlama",
    "bulut muhasebe",
  ],
  // NOT: İdeal OG oranı 1200×630'dur; şimdilik mevcut markalı görsel fallback olarak kullanılıyor.
  ogImage: {
    url: "/blog/fatura-banner.jpg",
    width: 1080,
    height: 1350,
    alt: "Kobipo — KOBİ finans ve işletme yönetimi",
  },
  logo: "/assets/logos/kobipo-logo-yatay-koyu.png",
  organization: {
    legalName: "Kobipo",
    email: "destek@kobipo.com",
    sameAs: [] as string[],
  },
} as const

/** Göreli bir yolu siteConfig.url ile birleştirip mutlak URL üretir. */
export function absoluteUrl(path = "/"): string {
  if (/^https?:\/\//i.test(path)) return path
  return `${siteConfig.url}${path.startsWith("/") ? "" : "/"}${path}`
}
