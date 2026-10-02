import { describe, expect, it } from "vitest"
import sharp from "sharp"
import { StampImageError, decodeDataUri, normalizeStampImage } from "./stamp-image"

/** Saydam zemin ortasında dolu bir dikdörtgen: kaşe taramasının kenar boşluğu. */
async function paddedStamp(format: "png" | "webp") {
  const ink = await sharp({ create: { width: 120, height: 60, channels: 4, background: "#1d3fbf" } }).png().toBuffer()
  const base = sharp({ create: { width: 400, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: ink, left: 140, top: 120 }])
  return format === "png" ? base.png().toBuffer() : base.webp({ lossless: true }).toBuffer()
}

describe("normalizeStampImage", () => {
  it("ayar kaşesinde kenar boşluğu kırpılır, saydamlık korunur, çıktı PNG'dir", async () => {
    const out = await normalizeStampImage(await paddedStamp("png"), { trim: true })
    expect(out.dataUri.startsWith("data:image/png;base64,")).toBe(true)
    expect([out.width, out.height]).toEqual([120, 60])
    const meta = await sharp(decodeDataUri(out.dataUri)!).metadata()
    expect(meta.format).toBe("png")
    expect(meta.hasAlpha).toBe(true)
  })

  it("şablon kaşesi kırpılmaz; WebP de PNG'ye çevrilir (pdfmake WebP basamaz)", async () => {
    const out = await normalizeStampImage(await paddedStamp("webp"), { trim: false })
    expect([out.width, out.height]).toEqual([400, 300])
    expect((await sharp(decodeDataUri(out.dataUri)!).metadata()).format).toBe("png")
  })

  it("uzun kenar 800 px'e indirilir", async () => {
    const big = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: "#ffffff" } }).jpeg().toBuffer()
    const out = await normalizeStampImage(big, { trim: true })
    expect(Math.max(out.width, out.height)).toBe(800)
  })

  it("SVG ve bozuk içerik reddedilir — beyan edilen tür değil, içerik denetlenir", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>')
    await expect(normalizeStampImage(svg, { trim: true })).rejects.toBeInstanceOf(StampImageError)
    await expect(normalizeStampImage(Buffer.from("kaşe değil"), { trim: true })).rejects.toBeInstanceOf(StampImageError)
  })
})
