import { NextResponse } from "next/server"
import { requireBlogEditor } from "@/lib/auth/require-blog-editor"
import {
  BLOG_MEDIA_BUCKET,
  ensureBucket,
  uploadObject,
  getPublicUrl,
  sanitizeFileName,
} from "@/lib/storage/supabase-storage"

export const dynamic = "force-dynamic"

const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5 MB
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]

/** Blog kapak/içerik görseli yükler → public URL döner. */
export async function POST(request: Request) {
  const auth = await requireBlogEditor()
  if ("error" in auth) return auth.error

  const fd = await request.formData().catch(() => null)
  const file = fd?.get("file")
  if (!file || typeof file === "string" || file.size === 0) {
    return NextResponse.json({ error: "Dosya gerekli" }, { status: 400 })
  }
  if (file.size > MAX_IMAGE_SIZE) {
    return NextResponse.json({ error: "Görsel 5 MB sınırını aşıyor" }, { status: 400 })
  }
  if (file.type && !ALLOWED_MIME.includes(file.type)) {
    return NextResponse.json({ error: `Desteklenmeyen görsel türü: ${file.type}` }, { status: 400 })
  }

  const safeName = sanitizeFileName(file.name || "gorsel")
  const path = `${Date.now()}-${safeName}`
  const buffer = Buffer.from(await file.arrayBuffer())

  try {
    await ensureBucket(BLOG_MEDIA_BUCKET, true) // public
    await uploadObject(BLOG_MEDIA_BUCKET, path, buffer, file.type || "application/octet-stream")
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Yükleme başarısız"
    return NextResponse.json({ error: message }, { status: 500 })
  }

  return NextResponse.json({ url: getPublicUrl(BLOG_MEDIA_BUCKET, path) }, { status: 201 })
}
