import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { requireBlogEditor } from "@/lib/auth/require-blog-editor"
import { slugify } from "@/lib/blog/slug"

export const dynamic = "force-dynamic"

const COVER_TONES = ["blue", "navy", "green"]

type Params = { params: Promise<{ id: string }> }

/** Admin: tek yazıyı getirir (düzenleme formu için). */
export async function GET(_request: Request, { params }: Params) {
  const auth = await requireBlogEditor()
  if ("error" in auth) return auth.error
  const { id } = await params

  const post = await prisma.blogPost.findUnique({ where: { id } })
  if (!post) return NextResponse.json({ error: "Yazı bulunamadı" }, { status: 404 })
  return NextResponse.json(post)
}

/** Admin: yazıyı günceller. status PUBLISHED'a geçerken publishedAt set edilir. */
export async function PATCH(request: Request, { params }: Params) {
  const auth = await requireBlogEditor()
  if ("error" in auth) return auth.error
  const { id } = await params

  const existing = await prisma.blogPost.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "Yazı bulunamadı" }, { status: 404 })

  const body = await request.json().catch(() => ({}))
  const data: Record<string, unknown> = {}

  if (body.title !== undefined) {
    const title = String(body.title).trim()
    if (!title) return NextResponse.json({ error: "Başlık boş olamaz" }, { status: 400 })
    data.title = title
  }

  // Slug elle değiştirilirse benzersizliği koru.
  if (body.slug !== undefined) {
    const desired = slugify(body.slug)
    if (!desired) return NextResponse.json({ error: "Geçerli bir slug üretilemedi" }, { status: 400 })
    let slug = desired
    for (let i = 2; ; i++) {
      const clash = await prisma.blogPost.findFirst({ where: { slug, NOT: { id } } })
      if (!clash) break
      slug = `${desired}-${i}`
    }
    data.slug = slug
  }

  if (body.excerpt !== undefined) data.excerpt = String(body.excerpt)
  if (body.category !== undefined) data.category = String(body.category).trim() || "Genel"
  if (body.body !== undefined) data.body = String(body.body)
  if (body.coverTone !== undefined)
    data.coverTone = COVER_TONES.includes(body.coverTone) ? body.coverTone : "blue"
  if (body.coverImageUrl !== undefined)
    data.coverImageUrl = body.coverImageUrl ? String(body.coverImageUrl) : null
  if (body.readTime !== undefined) data.readTime = body.readTime ? String(body.readTime).trim() : null
  if (body.author !== undefined) data.author = String(body.author).trim() || "Kobipo Ekibi"

  if (body.status !== undefined) {
    const status = body.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT"
    data.status = status
    // İlk kez yayınlanıyorsa publishedAt ata; taslağa çekilince koru (tekrar yayında aynı tarih).
    if (status === "PUBLISHED" && !existing.publishedAt) data.publishedAt = new Date()
  }

  const post = await prisma.blogPost.update({ where: { id }, data })
  return NextResponse.json(post)
}

/** Admin: yazıyı siler. */
export async function DELETE(_request: Request, { params }: Params) {
  const auth = await requireBlogEditor()
  if ("error" in auth) return auth.error
  const { id } = await params

  await prisma.blogPost.delete({ where: { id } }).catch(() => null)
  return NextResponse.json({ ok: true })
}
