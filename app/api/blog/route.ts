import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { requireBlogEditor } from "@/lib/auth/require-blog-editor"
import { slugify } from "@/lib/blog/slug"

export const dynamic = "force-dynamic"

const COVER_TONES = ["blue", "navy", "green"]

/** Admin: tüm yazıları listeler (taslaklar dahil). */
export async function GET() {
  const auth = await requireBlogEditor()
  if ("error" in auth) return auth.error

  const posts = await prisma.blogPost.findMany({
    orderBy: [{ createdAt: "desc" }],
  })
  return NextResponse.json(posts)
}

/** Admin: yeni yazı oluşturur. */
export async function POST(request: Request) {
  const auth = await requireBlogEditor()
  if ("error" in auth) return auth.error

  const body = await request.json().catch(() => ({}))
  const title = String(body.title || "").trim()
  if (!title) {
    return NextResponse.json({ error: "Başlık zorunlu" }, { status: 400 })
  }

  const desiredSlug = slugify(body.slug || title)
  if (!desiredSlug) {
    return NextResponse.json({ error: "Geçerli bir slug üretilemedi" }, { status: 400 })
  }
  // Slug çakışırsa sonuna -2, -3... ekle.
  let slug = desiredSlug
  for (let i = 2; ; i++) {
    const exists = await prisma.blogPost.findUnique({ where: { slug } })
    if (!exists) break
    slug = `${desiredSlug}-${i}`
  }

  const status = body.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT"
  const coverTone = COVER_TONES.includes(body.coverTone) ? body.coverTone : "blue"

  const post = await prisma.blogPost.create({
    data: {
      slug,
      title,
      excerpt: String(body.excerpt || "").trim(),
      category: String(body.category || "Genel").trim(),
      body: String(body.body || ""),
      coverTone,
      coverImageUrl: body.coverImageUrl ? String(body.coverImageUrl) : null,
      readTime: body.readTime ? String(body.readTime).trim() : null,
      author: String(body.author || "Kobipo Ekibi").trim(),
      status,
      publishedAt: status === "PUBLISHED" ? new Date() : null,
      createdBy: auth.user.id,
    },
  })
  return NextResponse.json(post, { status: 201 })
}
