/**
 * Supabase Storage erişimi — resmi JS SDK kurmadan REST API üzerinden.
 * Sunucu tarafında SUPABASE_SERVICE_ROLE_KEY ile çalışır (asla istemciye sızdırma).
 * Bucket'lar private; indirme kısa ömürlü imzalı URL ile yapılır.
 */

function env() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  // Eski legacy JWT (SERVICE_ROLE) ya da yeni format secret anahtar (sb_secret_...).
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
  if (!url || !key) {
    throw new Error(
      "Dosya depolama yapılandırılmamış: sunucu tarafı Supabase secret anahtarı eksik. " +
        "Supabase panelinden service_role (veya sb_secret_...) anahtarını alıp .env.local'e " +
        "SUPABASE_SERVICE_ROLE_KEY olarak ekleyin.",
    )
  }
  return { base: `${url.replace(/\/$/, "")}/storage/v1`, key }
}

function authHeaders(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}`, apikey: key }
}

/** Bucket'ı (yoksa) oluşturur. Zaten varsa sessizce geçer. */
export async function ensureBucket(bucket: string, isPublic = false): Promise<void> {
  const { base, key } = env()
  const res = await fetch(`${base}/bucket`, {
    method: "POST",
    headers: { ...authHeaders(key), "Content-Type": "application/json" },
    body: JSON.stringify({ id: bucket, name: bucket, public: isPublic }),
  })
  if (res.ok) return
  // 400/409 "already exists" → sorun değil
  if (res.status === 400 || res.status === 409) return
  const text = await res.text().catch(() => "")
  // Bazı sürümler "Duplicate" mesajı döner
  if (text.toLowerCase().includes("exist") || text.toLowerCase().includes("duplicate")) return
  throw new Error(`Bucket oluşturulamadı (${res.status}): ${text}`)
}

/** Dosyayı yükler (upsert). path: bucket içindeki tam yol. */
export async function uploadObject(
  bucket: string,
  path: string,
  body: Buffer | Uint8Array,
  contentType: string,
): Promise<void> {
  const { base, key } = env()
  await ensureBucket(bucket)
  const res = await fetch(`${base}/object/${bucket}/${path}`, {
    method: "POST",
    headers: {
      ...authHeaders(key),
      "Content-Type": contentType || "application/octet-stream",
      "x-upsert": "true",
      "cache-control": "3600",
    },
    body: body as any,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`Dosya yüklenemedi (${res.status}): ${text}`)
  }
}

/** İndirme için kısa ömürlü imzalı URL üretir (varsayılan 1 saat). */
export async function createSignedUrl(
  bucket: string,
  path: string,
  expiresIn = 3600,
): Promise<string> {
  const { base, key } = env()
  const res = await fetch(`${base}/object/sign/${bucket}/${path}`, {
    method: "POST",
    headers: { ...authHeaders(key), "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`İmzalı URL üretilemedi (${res.status}): ${text}`)
  }
  const data = (await res.json()) as { signedURL?: string }
  if (!data.signedURL) throw new Error("İmzalı URL boş döndü")
  return `${base}${data.signedURL.startsWith("/") ? "" : "/"}${data.signedURL}`
}

/** Nesneyi siler (best-effort; hata fırlatmaz). */
export async function deleteObject(bucket: string, path: string): Promise<void> {
  try {
    const { base, key } = env()
    await fetch(`${base}/object/${bucket}/${path}`, {
      method: "DELETE",
      headers: authHeaders(key),
    })
  } catch {
    /* yoksay */
  }
}

/** Dosya adını yol/özel karakterlerden arındırır, uzantıyı korur. */
export function sanitizeFileName(name: string): string {
  const base = name.replace(/[/\\]/g, "_").replace(/[^a-zA-Z0-9._-]/g, "_")
  return base.length > 0 ? base.slice(-120) : "dosya"
}

export const PERSONNEL_DOCS_BUCKET = "personnel-docs"

// Blog kapak/içerik görselleri — public bucket (blog herkese açık olduğu için imzasız URL).
export const BLOG_MEDIA_BUCKET = "blog-media"

// NOT: Ürün fotoğrafları bu dosyadan DEĞİL, lib/storage/object-store.ts
// üzerinden yazılır — sağlayıcı (Supabase/R2/Blob) değişebilsin diye. Bucket
// adı da orada durur; buraya bir sabit koymak ikinci bir kaynak olurdu.

/** Public bucket'taki nesnenin kalıcı public URL'ini üretir. */
export function getPublicUrl(bucket: string, path: string): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL tanımlı değil")
  return `${url.replace(/\/$/, "")}/storage/v1/object/public/${bucket}/${path}`
}

/**
 * getPublicUrl() ile üretilmiş bir URL'den bucket içindeki yolu geri çıkarır.
 * Eski nesneyi silmek ve "bu URL gerçekten bizim mi" sorusunu yanıtlamak için.
 * Biçimi tanınmayan/başka bir adrese ait URL'de null döner — yabancı bir sunucuya
 * silme isteği göndermeyelim, keza istemciden gelen serbest URL'i kabul etmeyelim.
 */
export function publicObjectPath(bucket: string, url: string): string | null {
  const marker = `/storage/v1/object/public/${bucket}/`
  const i = url.indexOf(marker)
  if (i === -1) return null
  const path = url.slice(i + marker.length).split("?")[0]
  return path ? decodeURIComponent(path) : null
}
