import type { Metadata } from "next"
import { BlogLanding } from "@/components/site/blog-landing"
import { blogPosts } from "@/lib/content/blog"

export const metadata: Metadata = {
  title: "Kobipo — İşletmenin tüm rakamları tek panelde",
  description:
    "e-Fatura, cari, stok, kasa-banka ve raporlama bir arada. Bulut tabanlı, GİB uyumlu KOBİ muhasebe ve işletme yönetim platformu. Ücretsiz başla.",
  openGraph: {
    title: "Kobipo — İşletmenin tüm rakamları tek panelde",
    description:
      "e-Fatura, cari, stok, kasa-banka ve raporlama bir arada. Bulut tabanlı, GİB uyumlu KOBİ platformu.",
    type: "website",
    images: [{ url: "/blog/fatura-saniyeler.jpg", width: 1080, height: 1350, alt: "Saniyeler içinde fatura kesin — Kobipo" }],
  },
}

export default function BlogLandingPage() {
  const posts = blogPosts.slice(0, 3).map((p) => ({
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt,
    category: p.category,
    readTime: p.readTime,
    date: p.date,
    author: p.author,
    coverTone: p.coverTone,
  }))

  return <BlogLanding posts={posts} />
}
