/**
 * PDF girdisi — belirlilik merdiveninin 1–4. basamaklarına hammadde
 * (docs/belge-tarama/PLAN.md §3.1).
 *
 * Tek kütüphane: `unpdf` (Mozilla PDF.js'in sunucusuz paketi). Metin katmanı,
 * gömülü görseller ve ek dosyalar (PDF/A-3 UBL XML) saf JS ile okunur —
 * yerel ikili yok. YALNIZ raster (sayfa → görsel) `@napi-rs/canvas` ister;
 * o da `sharp` gibi platform ikilisi taşır ve Vercel'de ÖLÇÜLMEDEN
 * güvenilmez (bkz. /api/alis/belge-tarama/saglik).
 *
 * Raster ne zaman gerekir:
 *   • metin katmanı olmayan (taranmış) PDF → sayfalar görsel olarak modele gider
 *   • karekod gömülü görsel değil vektör çizilmişse (1. sayfa rasterlenir)
 * Raster yoksa ikisi de bir "eksik" olarak sonuca yazılır, sessiz geçilmez.
 *
 * Yerel ikili sebebiyle ayrı dosyada tutulan hiçbir şey yok: bu modül zaten
 * yalnız sunucuda koşar (`sharp` gibi). İstemciye giden tipler `../turler.ts`te.
 */

import sharp from "sharp"
import jsQR from "jsqr"

export type PdfEk = { ad: string; icerik: Uint8Array }

export type PdfOkuma = {
  sayfaSayisi: number
  /** Sayfa başına metin (1. eleman = 1. sayfa). Katman yoksa boş dize. */
  metin: string[]
  /** Anlamlı metin katmanı var mı (bkz. METIN_ESIGI) */
  metinKatmaniVar: boolean
  /** Toplam anlamlı karakter — eşik ölçümü için ekrana yazılır */
  metinKarakter: number
  ekler: PdfEk[]
  /** 1. sayfadaki karekodun ham içeriği; bulunamadıysa null */
  karekodHam: string | null
  /** Karekod aranırken raster gerekti mi ve yapılabildi mi */
  karekodYolu: "gomulu-gorsel" | "raster" | "bulunamadi" | "raster-yok"
}

/**
 * Sayfa başına ortalama anlamlı karakter eşiği. Tek sayfalık en kısa e-Arşiv
 * faturası bile 500+ karakter taşır; taranmış PDF 0, tarayıcının OCR katmanı
 * eklediği PDF ise çöp karakterlerle gelebilir. Eşik ilk gerçek korpusta
 * ölçülecek — plan §3.1 "~200" diyor, ölçülene kadar o.
 */
export const METIN_ESIGI = 200

let pdfjsTanimli: Promise<void> | null = null

/**
 * Resmî `pdfjs-dist` legacy paketi tanımlanır: unpdf'in kendi sunucusuz paketi
 * raster YAPAMIYOR (renderPageAsImage resmî paket ister), legacy olmayan resmî
 * paket ise Node'da `hashOriginal.toHex is not a function` ile çöküyor (ölçüldü,
 * pdfjs 6.3). Metin/görsel/ek okuma legacy pakette de aynı çalışıyor (ölçüldü).
 */
async function unpdfHazirla() {
  const u = await import("unpdf")
  if (!pdfjsTanimli) {
    pdfjsTanimli = u.definePDFJSModule(() => import("pdfjs-dist/legacy/build/pdf.mjs") as any)
  }
  await pdfjsTanimli
  return u
}

function anlamliKarakter(metin: string): number {
  return (metin.match(/[\p{L}\p{N}]/gu) ?? []).length
}

/** Gömülü görselin ham pikselini jsQR'ın istediği RGBA'ya çevirir. */
function rgbaYap(data: Uint8ClampedArray, w: number, h: number, kanal: 1 | 3 | 4): Uint8ClampedArray {
  if (kanal === 4) return data
  const out = new Uint8ClampedArray(w * h * 4)
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    const r = kanal === 1 ? data[i] : data[i * 3]
    const g = kanal === 1 ? data[i] : data[i * 3 + 1]
    const b = kanal === 1 ? data[i] : data[i * 3 + 2]
    out[j] = r
    out[j + 1] = g
    out[j + 2] = b
    out[j + 3] = 255
  }
  return out
}

/** PNG/JPEG tamponundan karekod okur (raster çıktısı için). */
export async function karekodCozGorsel(gorsel: Buffer): Promise<string | null> {
  const { data, info } = await sharp(gorsel).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const r = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), info.width, info.height)
  return r?.data ?? null
}

/**
 * Sayfayı JPEG olarak rasterler (modele gidecek boyutta — girdi/gorsel.ts ile
 * aynı uzun kenar). `@napi-rs/canvas` yüklenemezse null döner; ÇAĞIRAN bunu
 * sonuca yazar.
 */
export async function pdfSayfaRaster(
  dosya: Buffer,
  sayfa: number,
  secenek: { uzunKenar?: number } = {}
): Promise<Buffer | null> {
  const u = await unpdfHazirla()
  let canvasImport: () => Promise<any>
  try {
    const canvas = await import("@napi-rs/canvas")
    canvasImport = async () => canvas
  } catch {
    return null
  }
  const uzun = secenek.uzunKenar ?? 1568
  // Önce doğal boyutu öğren: A4 72dpi = 595×842; uzun kenarı hedefe ölçekle.
  const pdf = await u.getDocumentProxy(new Uint8Array(dosya))
  const p = await pdf.getPage(sayfa)
  const vp = p.getViewport({ scale: 1 })
  const olcek = uzun / Math.max(vp.width, vp.height)
  const png = await u.renderPageAsImage(pdf, sayfa, { canvasImport, scale: olcek })
  return sharp(Buffer.from(png as ArrayBuffer)).jpeg({ quality: 85 }).toBuffer()
}

export type PdfMetin = Pick<PdfOkuma, "sayfaSayisi" | "metin" | "metinKatmaniVar" | "metinKarakter">

/**
 * Yalnız sayfa sayısı + metin katmanı — ek dosya ve karekod ARANMAZ. Menü
 * tarama (lib/menu-ocr) bunu kullanır: menüde UBL eki de GİB karekodu da yoktur,
 * 1. sayfayı 2000 px rasterleyip karekod aramak boşa süre ve bellek olurdu.
 * `pdfOku` aynı okumayı yapıp üstüne ek/karekod merdivenini ekler.
 */
export async function pdfMetinOku(dosya: Buffer): Promise<PdfMetin> {
  const u = await unpdfHazirla()
  const pdf = await u.getDocumentProxy(new Uint8Array(dosya))
  return metinKatmani(u, pdf)
}

async function metinKatmani(u: Awaited<ReturnType<typeof unpdfHazirla>>, pdf: any): Promise<PdfMetin> {
  const sayfaSayisi: number = pdf.numPages
  const { text } = await u.extractText(pdf, { mergePages: false })
  const metin = (Array.isArray(text) ? text : [text]).map((t) => String(t ?? ""))
  const metinKarakter = metin.reduce((a, t) => a + anlamliKarakter(t), 0)
  const metinKatmaniVar = sayfaSayisi > 0 && metinKarakter / sayfaSayisi >= METIN_ESIGI
  return { sayfaSayisi, metin, metinKatmaniVar, metinKarakter }
}

export async function pdfOku(dosya: Buffer): Promise<PdfOkuma> {
  const u = await unpdfHazirla()
  const pdf = await u.getDocumentProxy(new Uint8Array(dosya))
  const { sayfaSayisi, metin, metinKatmaniVar, metinKarakter } = await metinKatmani(u, pdf)

  // pdfjs 6: getAttachments() bir Map döner ve İÇERİK TAŞIMAZ (yalnız ad);
  // bayt için getAttachmentContent(id). Eski paketler nesne + `content` verirdi;
  // ikisi de karşılanır (ölçüldü: pdfkit eki 6.3'te ancak ikinci çağrıyla okundu).
  const ekler: PdfEk[] = []
  const hamEkler: any = await pdf.getAttachments().catch(() => null)
  if (hamEkler) {
    const girdiler: Array<[string, any]> =
      hamEkler instanceof Map ? [...hamEkler.entries()] : Object.entries(hamEkler as Record<string, any>)
    for (const [anahtar, deger] of girdiler) {
      let icerik: Uint8Array | undefined = deger?.content
      if (!icerik && typeof (pdf as any).getAttachmentContent === "function") {
        icerik = await (pdf as any).getAttachmentContent(anahtar).catch(() => undefined)
      }
      if (icerik && icerik.length > 0) ekler.push({ ad: String(deger?.filename || anahtar), icerik })
    }
  }

  // Karekod: önce 1. sayfanın gömülü görselleri (saf JS), yoksa raster.
  let karekodHam: string | null = null
  let karekodYolu: PdfOkuma["karekodYolu"] = "bulunamadi"
  if (sayfaSayisi > 0) {
    const gorseller = await u.extractImages(pdf, 1).catch(() => [])
    for (const g of gorseller) {
      // Karekod görseli küçüktür; sayfa boyu bir tarama görselini jsQR'a vermek
      // hem yavaş hem anlamsız (o zaten "taranmış PDF" yoludur, raster aşağıda).
      if (g.width * g.height > 4_000_000) continue
      const r = jsQR(rgbaYap(g.data, g.width, g.height, g.channels), g.width, g.height)
      if (r?.data) {
        karekodHam = r.data
        karekodYolu = "gomulu-gorsel"
        break
      }
    }
    if (!karekodHam) {
      const raster = await pdfSayfaRaster(dosya, 1, { uzunKenar: 2000 })
      if (raster == null) {
        karekodYolu = "raster-yok"
      } else {
        karekodHam = await karekodCozGorsel(raster)
        karekodYolu = karekodHam ? "raster" : "bulunamadi"
      }
    }
  }

  return { sayfaSayisi, metin, metinKatmaniVar, metinKarakter, ekler, karekodHam, karekodYolu }
}
