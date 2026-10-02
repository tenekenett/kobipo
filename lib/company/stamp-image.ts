import sharp from "sharp"

/**
 * Kaşe görselinin makbuza hazırlanması (sunucu, sharp).
 *
 * Tasarımcı PNG/JPEG/GIF/WebP kabul ediyor, pdfmake yalnız PNG/JPEG basabiliyor;
 * görsel PNG'ye çevrilir (saydamlık korunur) ve uzun kenarı sınırlanır — 330 KB'lık
 * bir kaşe her makbuza olduğu gibi gömülmesin. SVG ve diğer biçimler reddedilir:
 * data URI'nin beyan ettiği tür değil, içeriğin gerçek biçimi denetlenir.
 */
const MAX_EDGE_PX = 800
/** İstemcinin gönderebileceği en büyük görsel (data URI karakteri) — Vercel gövde sınırı 4,5 MB. */
export const MAX_STAMP_UPLOAD_CHARS = 4_000_000
const ACCEPTED_FORMATS = new Set(["png", "jpeg", "gif", "webp"])

export class StampImageError extends Error {}

export function decodeDataUri(uri: string): Buffer | null {
  const match = /^data:image\/[a-z+.-]+;base64,([A-Za-z0-9+/]+={0,2})$/.exec(uri.trim())
  return match ? Buffer.from(match[1], "base64") : null
}

/**
 * `trim`: kenardaki boşluk (saydam ya da düz zemin) kırpılır — ayar kaşesinin basım
 * genişliği MÜREKKEBİN genişliği olsun diye. Şablon kaşesi kırpılmaz: orada kutu
 * ölçüsü faturadaki görünüme göre seçilmiş.
 */
export async function normalizeStampImage(input: Buffer, { trim }: { trim: boolean }) {
  const meta = await sharp(input)
    .metadata()
    .catch(() => null)
  if (!meta?.format || !ACCEPTED_FORMATS.has(meta.format)) {
    throw new StampImageError("Kaşe görseli PNG, JPEG, GIF ya da WebP olmalı.")
  }
  let image = sharp(input).rotate()
  if (trim) {
    // Tek renkli görselde sharp kırpacak bir şey bulamayıp hata verir; o zaman olduğu gibi kalır.
    const trimmed = await image.clone().trim().toBuffer().catch(() => null)
    if (trimmed) image = sharp(trimmed)
  }
  const { data, info } = await image
    .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true })
  return { dataUri: `data:image/png;base64,${data.toString("base64")}`, width: info.width, height: info.height }
}
