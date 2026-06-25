/**
 * Belge Şablonu Tasarımcısı.
 *
 * Kullanıcının sıfırdan geçerli bir UBL→HTML XSLT'si yazması (ya da yüklemesi)
 * yerine, Kobipo'nun kanıtlanmış örnek şablonunu TABAN alıp üstüne yalnızca
 * GÖRSEL bir tema (renkler, yazı tipi, punto, tablo düzeni, yoğunluk, kenar
 * boşlukları) enjekte ederiz.
 *
 * Böylece UBL dönüşüm mantığı (alanlar, QR, tevkifat, istisna vb.) hiç
 * bozulmadan korunur — fatura GİB'e sorunsuz gider — ama görünüm firmaya özel olur.
 *
 * Üretilen XSLT, mevcut `templates/preview` ve `templates` (addTenantXslt)
 * endpoint'lerine ham `content` olarak verilir; ayrı bir gönderim yolu yoktur.
 *
 * NOT: Bu modül istemci-güvenli (pure) tutulur — `fs` vb. Node API'leri
 * import ETMEZ; böylece tasarımcı UI bileşeni sabitleri (DESIGN_FONTS) sorunsuz
 * bundle'lar. Taban XSLT'yi okuyan fs'li kısım API route'unda yapılır.
 */

export type TableHeaderStyle = "accent" | "light" | "none"
export type Density = "compact" | "normal" | "relaxed"
export type PageMargin = "narrow" | "normal" | "wide"
export type HeadingTransform = "uppercase" | "none"

export interface TemplateDesignOptions {
  /** Marka/vurgu rengi — #RRGGBB (ana başlıklar, çizgiler, tablo şeridi) */
  accentColor: string
  /** İkincil renk — alt başlıklar (h2) ve etiketler */
  secondaryColor: string
  /** Gövde metin rengi */
  textColor: string
  /** Yazı tipi anahtarı (DESIGN_FONTS) */
  fontKey: string
  /** Taban punto (px) */
  baseFontSize: number
  /** Firma adı/ana başlık ölçeği (1.0–2.2 ×) */
  titleScale: number
  /** Kalem tablosu başlık şeridi stili */
  tableHeader: TableHeaderStyle
  /** Tablo çizgi rengi — #RRGGBB */
  tableBorderColor: string
  /** Tek/çift satır gölgelendirme (zebra) */
  zebraRows: boolean
  /** Hücre yoğunluğu (padding) */
  density: Density
  /** Sayfa kenar boşluğu */
  pageMargin: PageMargin
  /** Başlık metin dönüşümü */
  headingTransform: HeadingTransform
  /** Vurgu çizgisi kalınlığı (px) */
  lineThickness: number
  /** Firma logosu — gömülü base64 data URI (boş = logo yok) */
  logoDataUri: string
  /** Gömülü logo kutu genişliği (px) */
  logoWidth: number
  /** Gömülü logo kutu yüksekliği (px) */
  logoHeight: number
  /** Firma kaşesi/mührü — gömülü base64 data URI (boş = kaşe yok) */
  stampDataUri: string
  /** Gömülü kaşe kutu genişliği (px) */
  stampWidth: number
  /** Gömülü kaşe kutu yüksekliği (px) */
  stampHeight: number
  /** Sayfa arka plan rengi */
  pageBackground: string
  /** Satır yüksekliği (line-height, ×) */
  lineHeight: number
  /** Fatura altına eklenecek serbest metin (IBAN, banka, not). Çok satır olabilir. */
  footerNote: string
}

/** Alt bilgi serbest metni için üst sınır. */
export const MAX_FOOTER_NOTE_LEN = 600

/** İzinli logo data URI biçimi (png/jpeg/gif/webp, base64). */
const DATA_URI_RE = /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/
/** Gömülü logo için üst sınır (~400 KB ham ≈ 540 bin base64 karakter). */
export const MAX_LOGO_DATA_URI_LEN = 560_000

/** Logo data URI'sini doğrular; geçersiz/çok büyükse boş döner. */
export function sanitizeLogoDataUri(input: unknown): string {
  if (typeof input !== "string") return ""
  const v = input.trim()
  if (!v) return ""
  if (v.length > MAX_LOGO_DATA_URI_LEN) return ""
  return DATA_URI_RE.test(v) ? v : ""
}

interface FontDef {
  key: string
  label: string
  stack: string
}

/** Güvenli yazı tipi beyaz listesi (CSS injection'a kapalı). */
export const DESIGN_FONTS: FontDef[] = [
  { key: "tahoma", label: "Tahoma", stack: "'Tahoma', Geneva, sans-serif" },
  { key: "arial", label: "Arial", stack: "'Arial', Helvetica, sans-serif" },
  { key: "calibri", label: "Calibri", stack: "'Calibri', 'Segoe UI', sans-serif" },
  { key: "verdana", label: "Verdana", stack: "'Verdana', Geneva, sans-serif" },
  { key: "trebuchet", label: "Trebuchet MS", stack: "'Trebuchet MS', 'Segoe UI', sans-serif" },
  { key: "times", label: "Times New Roman", stack: "'Times New Roman', Times, serif" },
  { key: "georgia", label: "Georgia", stack: "'Georgia', 'Times New Roman', serif" },
]

export const DENSITY_OPTIONS: Array<{ key: Density; label: string; padding: string }> = [
  { key: "compact", label: "Sıkışık", padding: "1px 3px" },
  { key: "normal", label: "Normal", padding: "3px 5px" },
  { key: "relaxed", label: "Ferah", padding: "6px 9px" },
]

export const MARGIN_OPTIONS: Array<{ key: PageMargin; label: string; value: string }> = [
  { key: "narrow", label: "Dar", value: "0.3in" },
  { key: "normal", label: "Normal", value: "0.6in" },
  { key: "wide", label: "Geniş", value: "1in" },
]

export const TABLE_HEADER_OPTIONS: Array<{ key: TableHeaderStyle; label: string }> = [
  { key: "accent", label: "Marka rengi" },
  { key: "light", label: "Açık gri" },
  { key: "none", label: "Sade" },
]

export const DEFAULT_DESIGN_OPTIONS: TemplateDesignOptions = {
  accentColor: "#185FA5",
  secondaryColor: "#0C3B6B",
  textColor: "#1A1A1A",
  fontKey: "tahoma",
  baseFontSize: 11,
  titleScale: 1.4,
  tableHeader: "accent",
  tableBorderColor: "#CCCCCC",
  zebraRows: true,
  density: "normal",
  pageMargin: "normal",
  headingTransform: "none",
  lineThickness: 2,
  logoDataUri: "",
  logoWidth: 120,
  logoHeight: 60,
  stampDataUri: "",
  stampWidth: 100,
  stampHeight: 100,
  pageBackground: "#FFFFFF",
  lineHeight: 1.3,
  footerNote: "",
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/

/** eDocumentType (1=E-Fatura, 2=E-Arşiv) → gömülü örnek anahtarı. */
export function sampleKeyForDocType(eDocumentType: number): string | null {
  if (eDocumentType === 1) return "e-fatura"
  if (eDocumentType === 2) return "e-arsiv"
  return null
}

function hex(value: unknown, fallback: string): string {
  return typeof value === "string" && HEX_RE.test(value.trim()) ? value.trim() : fallback
}

function clampNum(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

/** Gelen ham options'ı güvenli aralıklara çeker; geçersizlerde varsayılan. */
export function normalizeDesignOptions(input: unknown): TemplateDesignOptions {
  const o = (input ?? {}) as Partial<TemplateDesignOptions>
  const D = DEFAULT_DESIGN_OPTIONS
  return {
    accentColor: hex(o.accentColor, D.accentColor),
    secondaryColor: hex(o.secondaryColor, D.secondaryColor),
    textColor: hex(o.textColor, D.textColor),
    fontKey: DESIGN_FONTS.some((f) => f.key === o.fontKey) ? (o.fontKey as string) : D.fontKey,
    baseFontSize: Math.round(clampNum(o.baseFontSize, 8, 16, D.baseFontSize)),
    titleScale: Math.round(clampNum(o.titleScale, 1, 2.2, D.titleScale) * 10) / 10,
    tableHeader: pick(o.tableHeader, ["accent", "light", "none"], D.tableHeader),
    tableBorderColor: hex(o.tableBorderColor, D.tableBorderColor),
    zebraRows: typeof o.zebraRows === "boolean" ? o.zebraRows : D.zebraRows,
    density: pick(o.density, ["compact", "normal", "relaxed"], D.density),
    pageMargin: pick(o.pageMargin, ["narrow", "normal", "wide"], D.pageMargin),
    headingTransform: pick(o.headingTransform, ["uppercase", "none"], D.headingTransform),
    lineThickness: Math.round(clampNum(o.lineThickness, 1, 6, D.lineThickness)),
    logoDataUri: sanitizeLogoDataUri(o.logoDataUri),
    logoWidth: Math.round(clampNum(o.logoWidth, 40, 280, D.logoWidth)),
    logoHeight: Math.round(clampNum(o.logoHeight, 24, 160, D.logoHeight)),
    stampDataUri: sanitizeLogoDataUri(o.stampDataUri),
    stampWidth: Math.round(clampNum(o.stampWidth, 40, 240, D.stampWidth)),
    stampHeight: Math.round(clampNum(o.stampHeight, 40, 240, D.stampHeight)),
    pageBackground: hex(o.pageBackground, D.pageBackground),
    lineHeight: Math.round(clampNum(o.lineHeight, 1, 2, D.lineHeight) * 10) / 10,
    footerNote: typeof o.footerNote === "string" ? o.footerNote.slice(0, MAX_FOOTER_NOTE_LEN) : "",
  }
}

/** XSLT (XML) sonuç ağacına güvenli gömme için metni kaçışlar. */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/** #RRGGBB → {r,g,b} */
function toRgb(hexStr: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hexStr.slice(1, 3), 16),
    g: parseInt(hexStr.slice(3, 5), 16),
    b: parseInt(hexStr.slice(5, 7), 16),
  }
}

/** Vurgu renginin okunabilir kontrast metni (siyah/beyaz) — basit luminance. */
export function contrastText(hexStr: string): string {
  const { r, g, b } = toRgb(hexStr)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.6 ? "#000000" : "#ffffff"
}

/** Rengi beyazla karıştırarak açık bir tonunu üretir (zebra için). amount 0–1. */
export function tint(hexStr: string, amount: number): string {
  const { r, g, b } = toRgb(hexStr)
  const mix = (c: number) => Math.round(c + (255 - c) * amount)
  const h = (c: number) => mix(c).toString(16).padStart(2, "0")
  return `#${h(r)}${h(g)}${h(b)}`
}

/** Tema CSS bloğunu üretir (mevcut stilleri ezmek için !important). */
function buildThemeCss(opts: TemplateDesignOptions): string {
  const font = DESIGN_FONTS.find((f) => f.key === opts.fontKey)?.stack ?? DESIGN_FONTS[0].stack
  const accent = opts.accentColor
  const onAccent = contrastText(accent)
  const margin = MARGIN_OPTIONS.find((m) => m.key === opts.pageMargin)?.value ?? "0.6in"
  const padding = DENSITY_OPTIONS.find((d) => d.key === opts.density)?.padding ?? "3px 5px"
  const transform = opts.headingTransform === "uppercase" ? "uppercase" : "none"

  // ÖNEMLİ: Taban şablonda hem başlık satırı hem de kalem (veri) satırları aynı
  // `tr.lineTableTr` sınıfını taşır; başlık satırı `<tbody>`'nin İLK satırıdır.
  // Bu yüzden başlık şeridini SADECE ilk satıra uygula — aksi halde tüm kalem
  // satırları vurgu rengine boyanır ve metin (kontrast nedeniyle) beyaza düşer.
  const headerRowSel =
    "#lineTable thead td, #lineTable thead th, " +
    "#lineTable > tbody > tr.lineTableTr:first-child > td, " +
    "#lineTable > tbody > tr.lineTableTr:first-child > td span"
  const headerRule =
    opts.tableHeader === "accent"
      ? `
      ${headerRowSel} {
        background-color: ${accent} !important;
        color: ${onAccent} !important;
      }`
      : opts.tableHeader === "light"
        ? `
      ${headerRowSel} {
        background-color: ${tint(accent, 0.86)} !important;
        color: ${opts.textColor} !important;
      }`
        : ""

  // Zebra: başlık ilk satır olduğundan, veri satırları 2. satırdan başlar. Şema
  // önizlemesiyle aynı parite için başlık hariç çift sıradaki veri satırlarını gölgele.
  const zebraRule = opts.zebraRows
    ? `
      #lineTable > tbody > tr.lineTableTr:nth-child(odd):not(:first-child) > td { background-color: ${tint(accent, 0.92)} !important; }`
    : ""

  // Firma logosu: taban şablondaki boş `#TenantLogo` yer tutucusuna CSS arka plan
  // olarak gömülür. Böylece gövdeye dokunmadan (yalnız CSS) logo görünür; data URI
  // sadece base64 + mime içerdiğinden url("...") içine güvenle yazılır.
  const embedImageRule = (selector: string, uri: string, w: number, h: number) =>
    uri && DATA_URI_RE.test(uri)
      ? `
      ${selector} {
        display: inline-block !important;
        width: ${w}px !important;
        height: ${h}px !important;
        background-image: url("${uri}") !important;
        background-size: contain !important;
        background-repeat: no-repeat !important;
        background-position: center !important;
      }`
      : ""

  const logoRule = embedImageRule("#TenantLogo", opts.logoDataUri, opts.logoWidth, opts.logoHeight)
  const stampRule = embedImageRule("#TenantStampLogo", opts.stampDataUri, opts.stampWidth, opts.stampHeight)

  return `
    /* ===== Kobipo Şablon Tasarımcısı — tema ===== */
    body {
      font-family: ${font} !important;
      font-size: ${opts.baseFontSize}px !important;
      color: ${opts.textColor} !important;
      background-color: ${opts.pageBackground} !important;
      line-height: ${opts.lineHeight} !important;
      margin: ${margin} !important;
    }
    h1 { color: ${accent} !important; font-size: ${opts.titleScale}em !important; text-transform: ${transform} !important; }
    h2 { color: ${opts.secondaryColor} !important; text-transform: ${transform} !important; }
    hr {
      color: ${accent} !important;
      background-color: ${accent} !important;
      height: ${opts.lineThickness}px !important;
      border: 0 !important;
      border-bottom: ${opts.lineThickness}px solid ${accent} !important;
    }
    #lineTable, #lineTable td, #lineTable th, .lineTableTd, .lineTableTr td {
      border-color: ${opts.tableBorderColor} !important;
    }
    #lineTable td, #lineTable th, .lineTableTd { padding: ${padding} !important; }${headerRule}${zebraRule}${logoRule}${stampRule}
  `
}

/**
 * Alt bilgi serbest metni için, `</body>`'den hemen önce eklenecek HTML bloğu
 * üretir (ekle-yalnız, en altta). Metin XML-kaçışlanır; satır sonları <br/> olur.
 * XSLT iyi-biçimli XML gerektirdiğinden çıktı self-closing/kapalı etiketlerle yazılır.
 */
function buildFooterHtml(opts: TemplateDesignOptions): string {
  const note = opts.footerNote.trim()
  if (!note) return ""
  const lines = note
    .split(/\r?\n/)
    .map((l) => escapeXml(l))
    .join("<br/>")
  const fontPx = Math.max(8, opts.baseFontSize - 1)
  return `<div style="width:800px;margin-top:14px;padding-top:6px;border-top:${opts.lineThickness}px solid ${opts.accentColor};font-size:${fontPx}px;color:${opts.textColor};line-height:${opts.lineHeight};">${lines}</div>`
}

/**
 * Taban XSLT'ye tasarımı uygular:
 *  1) Tema CSS'i, mevcut stil bloğunun KAPANIŞINDAN hemen önce enjekte edilir
 *     (cascade'de en sona düşer, kazanır).
 *  2) Alt bilgi metni (varsa) `</body>` öncesine eklenir (ekle-yalnız).
 * UBL dönüşüm mantığına dokunulmaz.
 */
export function applyThemeToXslt(baseXslt: string, opts: TemplateDesignOptions): string {
  let out = baseXslt

  const styleIdx = out.indexOf("</style>")
  if (styleIdx !== -1) {
    out = out.slice(0, styleIdx) + buildThemeCss(opts) + out.slice(styleIdx)
  }

  const footer = buildFooterHtml(opts)
  if (footer) {
    const bodyIdx = out.lastIndexOf("</body>")
    if (bodyIdx !== -1) {
      out = out.slice(0, bodyIdx) + footer + out.slice(bodyIdx)
    }
  }

  return out
}
