import { prisma } from "@/lib/db/prisma"

/**
 * Public blog içeriği — artık DB'den (BlogPost) okunur. Yalnız PUBLISHED yazılar döner.
 * İçerik /blog-admin panelinden blog editörü (User.isBlogEditor) tarafından yönetilir.
 * Eski statik yazılar scripts/seed-blog-posts.mjs ile DB'ye taşınmıştır.
 */
export type BlogPost = {
  slug: string
  title: string
  excerpt: string
  category: string
  readTime: string
  date: string
  author: string
  coverTone: "blue" | "navy" | "green"
  coverImageUrl: string | null
  body: string // Markdown
}

const VALID_TONES = ["blue", "navy", "green"]

type BlogPostRow = {
  slug: string
  title: string
  excerpt: string
  category: string
  readTime: string | null
  author: string
  coverTone: string
  coverImageUrl: string | null
  body: string
  publishedAt: Date | null
  createdAt: Date
}

const publishedSelect = {
  slug: true,
  title: true,
  excerpt: true,
  category: true,
  readTime: true,
  author: true,
  coverTone: true,
  coverImageUrl: true,
  body: true,
  publishedAt: true,
  createdAt: true,
} as const

function formatDate(d: Date): string {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(d)
}

function toBlogPost(row: BlogPostRow): BlogPost {
  return {
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    category: row.category,
    readTime: row.readTime ?? "",
    date: formatDate(row.publishedAt ?? row.createdAt),
    author: row.author,
    coverTone: VALID_TONES.includes(row.coverTone)
      ? (row.coverTone as BlogPost["coverTone"])
      : "blue",
    coverImageUrl: row.coverImageUrl,
    body: row.body,
  }
}

export async function getPublishedPosts(): Promise<BlogPost[]> {
  const rows = await prisma.blogPost.findMany({
    where: { status: "PUBLISHED" },
    orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
    select: publishedSelect,
  })
  return rows.map(toBlogPost)
}

export async function getBlogPostBySlug(slug: string): Promise<BlogPost | null> {
  const row = await prisma.blogPost.findFirst({
    where: { slug, status: "PUBLISHED" },
    select: publishedSelect,
  })
  return row ? toBlogPost(row) : null
}

export async function getBlogCategories(): Promise<string[]> {
  const rows = await prisma.blogPost.findMany({
    where: { status: "PUBLISHED" },
    select: { category: true },
    distinct: ["category"],
    orderBy: { category: "asc" },
  })
  return rows.map((r) => r.category)
}
