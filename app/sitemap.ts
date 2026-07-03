import type { MetadataRoute } from "next"
import { getPublishedPosts, getBlogCategories, postPath, categoryPath } from "@/lib/content/blog"
import { absoluteUrl } from "@/lib/seo/site-config"

// Yayınlar/kategoriler değişebilir → periyodik tazele.
export const revalidate = 3600

const STATIC_PATHS: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "/", priority: 1.0, changeFrequency: "weekly" },
  { path: "/kurumsal/blog", priority: 0.9, changeFrequency: "daily" },
  { path: "/blog", priority: 0.6, changeFrequency: "weekly" },
  { path: "/kurumsal/hakkimizda", priority: 0.6, changeFrequency: "monthly" },
  { path: "/kurumsal/iletisim", priority: 0.6, changeFrequency: "monthly" },
  { path: "/kurumsal/destek", priority: 0.6, changeFrequency: "monthly" },
  { path: "/kurumsal/kariyer", priority: 0.5, changeFrequency: "monthly" },
  { path: "/kurumsal/gizlilik", priority: 0.3, changeFrequency: "yearly" },
  { path: "/kurumsal/kvkk", priority: 0.3, changeFrequency: "yearly" },
  { path: "/kurumsal/cerezler", priority: 0.3, changeFrequency: "yearly" },
  { path: "/kurumsal/kullanim-kosullari", priority: 0.3, changeFrequency: "yearly" },
]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()

  const staticEntries: MetadataRoute.Sitemap = STATIC_PATHS.map((e) => ({
    url: absoluteUrl(e.path),
    lastModified: now,
    changeFrequency: e.changeFrequency,
    priority: e.priority,
  }))

  let postEntries: MetadataRoute.Sitemap = []
  let categoryEntries: MetadataRoute.Sitemap = []

  try {
    const posts = await getPublishedPosts()
    postEntries = posts.map((p) => ({
      url: absoluteUrl(postPath(p.slug)),
      lastModified: new Date(p.isoDate),
      changeFrequency: "monthly",
      priority: 0.7,
    }))

    const categories = await getBlogCategories()
    categoryEntries = categories.map((c) => ({
      url: absoluteUrl(categoryPath(c)),
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.5,
    }))
  } catch {
    // DB erişilemezse (ör. build anı) en azından statik rotalar döner.
  }

  return [...staticEntries, ...postEntries, ...categoryEntries]
}
