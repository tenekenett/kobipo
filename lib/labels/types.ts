// Etiket Tasarımcısı — tasarım şeması (tek doğruluk kaynağı).
// Tüm koordinat/boyutlar mm cinsindendir; iki renderer (DOM editör + jsPDF)
// aynı modeli çizer. Bu dosya saf TS'dir (React/DOM yok) — API rotaları da
// normalizeLabelDesign ile yazım öncesi payload'ı temizler.

export const LABEL_DESIGN_VERSION = 1

// Sunucu tarafı design boyut guard'ı (JSON.stringify uzunluğu). Görsel/emoji
// data-URI'ları design içinde saklandığından üst sınır gerekir.
export const MAX_DESIGN_JSON_BYTES = 1_500_000

export type LabelType = "ROLL" | "A4"

export interface LabelPage {
  labelType: LabelType
  widthMm: number // tek etiketin genişliği
  heightMm: number // tek etiketin yüksekliği
  columns: number // yanyana etiket sayısı (ROLL; A4'te otomatik hesaplanır)
  gapXMm: number // yatay etiket arası boşluk
  gapYMm: number // dikey etiket arası boşluk (A4)
  a4?: { marginTopMm: number; marginLeftMm: number } // A4 sayfa kenar boşlukları
}

export type LabelRotation = 0 | 90 | 180 | 270

export type TextAlign = "left" | "center" | "right"

export interface FontSpec {
  sizePt: number // punto (jsPDF setFontSize ile birebir; 1pt = 0.352778mm)
  bold: boolean
  align: TextAlign
  color: string // #rrggbb
}

export type TextFit = "wrap" | "shrink"

interface LabelElementBase {
  id: string
  x: number
  y: number
  w: number
  h: number
  rotation: LabelRotation
  z: number // çizim sırası (küçük altta)
}

export interface TextElement extends LabelElementBase {
  type: "text"
  text: string // sabit metin
  font: FontSpec
  fit: TextFit
}

export type ProductFieldKey =
  | "name"
  | "code"
  | "barcode"
  | "salePrice"
  | "salePriceWithVat"
  | "unit"
  | "category"
  | "companyName"
  | "date"

export interface FieldElement extends LabelElementBase {
  type: "field"
  fieldKey: ProductFieldKey
  prefix?: string
  suffix?: string
  // Yalnızca fiyat alanları için: ondalık hane + para birimi gösterimi.
  price?: { decimals: number; showCurrency: boolean }
  font: FontSpec
  fit: TextFit
}

export type BarcodeSource = "barcode" | "code" | "custom"
export type BarcodeSymbology = "auto" | "ean13" | "code128"

export interface BarcodeElement extends LabelElementBase {
  type: "barcode"
  source: BarcodeSource
  customValue?: string
  symbology: BarcodeSymbology
  showText: boolean // çubukların altına rakamları yaz (metni biz çizeriz)
}

export type QrSource = "barcode" | "code" | "name" | "custom"

export interface QrElement extends LabelElementBase {
  type: "qr"
  source: QrSource
  customValue?: string
}

export type ShapeKind = "line" | "rect" | "circle"

export interface ShapeElement extends LabelElementBase {
  type: "shape"
  shape: ShapeKind
  strokeColor: string
  strokeWidthMm: number
  dashed: boolean
  fillColor?: string | null // yalnız rect/circle; null = dolgusuz
}

export interface ImageElement extends LabelElementBase {
  type: "image"
  // Küçültülmüş PNG/JPEG data-URI (emoji de ekleme anında buraya rasterize edilir).
  dataUrl: string
}

export type LabelElement =
  | TextElement
  | FieldElement
  | BarcodeElement
  | QrElement
  | ShapeElement
  | ImageElement

export type LabelElementType = LabelElement["type"]

export interface LabelDesign {
  version: number
  page: LabelPage
  elements: LabelElement[]
}

// ---------------------------------------------------------------------------
// Varsayılanlar
// ---------------------------------------------------------------------------

export const DEFAULT_FONT: FontSpec = {
  sizePt: 8,
  bold: false,
  align: "left",
  color: "#000000",
}

export function makeElementId(): string {
  return `el-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function createDefaultDesign(): LabelDesign {
  return {
    version: LABEL_DESIGN_VERSION,
    page: {
      labelType: "ROLL",
      widthMm: 40,
      heightMm: 20,
      columns: 1,
      gapXMm: 2,
      gapYMm: 2,
    },
    elements: [],
  }
}

// ---------------------------------------------------------------------------
// Normalizasyon — API yazımdan önce ve client yüklemeden sonra çağırır.
// Bilinmeyen öğe tiplerini atar, sayıları clamp'ler, eksik alanlara varsayılan
// koyar. Amaç: bozuk/eski/elle kurcalanmış JSON'un editörü veya PDF'i
// kırmaması.
// ---------------------------------------------------------------------------

const MAX_ELEMENTS = 100
const MAX_IMAGE_DATAURL_CHARS = 700_000
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
// Yalnız png/jpeg: jsPDF webp render edemez; yükleyici zaten PNG'ye çevirir.
const IMAGE_DATAURL = /^data:image\/(?:png|jpeg);base64,/

function num(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : def
  return Math.min(max, Math.max(min, n))
}

function str(v: unknown, def = ""): string {
  return typeof v === "string" ? v : def
}

function bool(v: unknown, def: boolean): boolean {
  return typeof v === "boolean" ? v : def
}

function color(v: unknown, def = "#000000"): string {
  const s = str(v)
  return HEX_COLOR.test(s) ? s : def
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], def: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : def
}

function normalizeFont(raw: unknown): FontSpec {
  const f = (raw ?? {}) as Record<string, unknown>
  return {
    sizePt: num(f.sizePt, DEFAULT_FONT.sizePt, 4, 72),
    bold: bool(f.bold, false),
    align: oneOf(f.align, ["left", "center", "right"] as const, "left"),
    color: color(f.color),
  }
}

function normalizeBase(raw: Record<string, unknown>, page: LabelPage, index: number) {
  const w = num(raw.w, 10, 0.5, Math.max(page.widthMm, page.heightMm))
  const h = num(raw.h, 5, 0.5, Math.max(page.widthMm, page.heightMm))
  return {
    id: str(raw.id) || makeElementId(),
    x: num(raw.x, 0, -w + 1, page.widthMm - 1),
    y: num(raw.y, 0, -h + 1, page.heightMm - 1),
    w,
    h,
    rotation: ([0, 90, 180, 270] as const).includes(raw.rotation as LabelRotation)
      ? (raw.rotation as LabelRotation)
      : 0,
    z: typeof raw.z === "number" && Number.isFinite(raw.z) ? raw.z : index,
  }
}

function normalizeElement(
  raw: unknown,
  page: LabelPage,
  index: number
): LabelElement | null {
  if (!raw || typeof raw !== "object") return null
  const e = raw as Record<string, unknown>
  const base = normalizeBase(e, page, index)

  switch (e.type) {
    case "text":
      return {
        ...base,
        type: "text",
        text: str(e.text).slice(0, 500),
        font: normalizeFont(e.font),
        fit: oneOf(e.fit, ["wrap", "shrink"] as const, "shrink"),
      }
    case "field": {
      const fieldKey = oneOf(
        e.fieldKey,
        [
          "name",
          "code",
          "barcode",
          "salePrice",
          "salePriceWithVat",
          "unit",
          "category",
          "companyName",
          "date",
        ] as const,
        "name"
      )
      const priceRaw = (e.price ?? null) as Record<string, unknown> | null
      const isPrice = fieldKey === "salePrice" || fieldKey === "salePriceWithVat"
      return {
        ...base,
        type: "field",
        fieldKey,
        prefix: str(e.prefix).slice(0, 50) || undefined,
        suffix: str(e.suffix).slice(0, 50) || undefined,
        price: isPrice
          ? {
              decimals: num(priceRaw?.decimals, 2, 0, 4),
              showCurrency: bool(priceRaw?.showCurrency, true),
            }
          : undefined,
        font: normalizeFont(e.font),
        fit: oneOf(e.fit, ["wrap", "shrink"] as const, "shrink"),
      }
    }
    case "barcode":
      return {
        ...base,
        type: "barcode",
        source: oneOf(e.source, ["barcode", "code", "custom"] as const, "barcode"),
        customValue: str(e.customValue).slice(0, 80) || undefined,
        symbology: oneOf(e.symbology, ["auto", "ean13", "code128"] as const, "auto"),
        showText: bool(e.showText, true),
      }
    case "qr":
      return {
        ...base,
        type: "qr",
        source: oneOf(e.source, ["barcode", "code", "name", "custom"] as const, "barcode"),
        customValue: str(e.customValue).slice(0, 500) || undefined,
      }
    case "shape": {
      const shape = oneOf(e.shape, ["line", "rect", "circle"] as const, "rect")
      const fill = e.fillColor
      return {
        ...base,
        type: "shape",
        shape,
        strokeColor: color(e.strokeColor),
        strokeWidthMm: num(e.strokeWidthMm, 0.3, 0.1, 5),
        dashed: bool(e.dashed, false),
        fillColor:
          shape !== "line" && typeof fill === "string" && HEX_COLOR.test(fill) ? fill : null,
      }
    }
    case "image": {
      const dataUrl = str(e.dataUrl)
      if (!IMAGE_DATAURL.test(dataUrl) || dataUrl.length > MAX_IMAGE_DATAURL_CHARS) return null
      return { ...base, type: "image", dataUrl }
    }
    default:
      return null
  }
}

export function normalizeLabelDesign(raw: unknown): LabelDesign {
  const d = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>
  const p = (d.page && typeof d.page === "object" ? d.page : {}) as Record<string, unknown>

  const labelType = oneOf(p.labelType, ["ROLL", "A4"] as const, "ROLL")
  const a4Raw = (p.a4 ?? null) as Record<string, unknown> | null
  const page: LabelPage = {
    labelType,
    widthMm: num(p.widthMm, 40, 5, 210),
    heightMm: num(p.heightMm, 20, 5, 297),
    columns: Math.round(num(p.columns, 1, 1, 12)),
    gapXMm: num(p.gapXMm, 2, 0, 50),
    gapYMm: num(p.gapYMm, 2, 0, 50),
    a4:
      labelType === "A4"
        ? {
            marginTopMm: num(a4Raw?.marginTopMm, 10, 0, 50),
            marginLeftMm: num(a4Raw?.marginLeftMm, 5, 0, 50),
          }
        : undefined,
  }

  const rawElements = Array.isArray(d.elements) ? d.elements.slice(0, MAX_ELEMENTS) : []
  const elements = rawElements
    .map((el, i) => normalizeElement(el, page, i))
    .filter((el): el is LabelElement => el !== null)

  return { version: LABEL_DESIGN_VERSION, page, elements }
}
