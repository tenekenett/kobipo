// Etiket Tasarımcısı — boyut önayarları ve hazır başlangıç şablonları.
// Şablonlar elle kurulmuş LabelDesign nesneleridir; toolbox "Hazır Şablonlar"
// sekmesinden tek tıkla mevcut tasarımın yerine yüklenir.

import type {
  BarcodeElement,
  FieldElement,
  FontSpec,
  LabelDesign,
  LabelType,
  QrElement,
  ShapeElement,
  TextAlign,
} from "./types"
import { LABEL_DESIGN_VERSION } from "./types"

export interface SizePreset {
  label: string
  labelType: LabelType
  widthMm: number
  heightMm: number
  gapXMm: number
  gapYMm: number
  a4?: { marginTopMm: number; marginLeftMm: number }
}

export const SIZE_PRESETS: SizePreset[] = [
  { label: "Rulo 20×40", labelType: "ROLL", widthMm: 20, heightMm: 40, gapXMm: 2, gapYMm: 2 },
  { label: "Rulo 40×20", labelType: "ROLL", widthMm: 40, heightMm: 20, gapXMm: 2, gapYMm: 2 },
  { label: "Rulo 50×30", labelType: "ROLL", widthMm: 50, heightMm: 30, gapXMm: 2, gapYMm: 2 },
  { label: "Rulo 60×40", labelType: "ROLL", widthMm: 60, heightMm: 40, gapXMm: 2, gapYMm: 2 },
  { label: "Rulo 80×50", labelType: "ROLL", widthMm: 80, heightMm: 50, gapXMm: 2, gapYMm: 2 },
  { label: "Rulo 100×50", labelType: "ROLL", widthMm: 100, heightMm: 50, gapXMm: 2, gapYMm: 2 },
  { label: "Rulo 100×80", labelType: "ROLL", widthMm: 100, heightMm: 80, gapXMm: 2, gapYMm: 2 },
  {
    label: "A4 21'li (63,5×38,1)",
    labelType: "A4",
    widthMm: 63.5,
    heightMm: 38.1,
    gapXMm: 2.5,
    gapYMm: 0,
    a4: { marginTopMm: 15.1, marginLeftMm: 7.2 },
  },
  {
    label: "A4 24'lü (70×36)",
    labelType: "A4",
    widthMm: 70,
    heightMm: 36,
    gapXMm: 0,
    gapYMm: 0,
    a4: { marginTopMm: 4.5, marginLeftMm: 0 },
  },
  {
    label: "A4 16'lı (105×37)",
    labelType: "A4",
    widthMm: 105,
    heightMm: 37,
    gapXMm: 0,
    gapYMm: 0,
    a4: { marginTopMm: 0.5, marginLeftMm: 0 },
  },
]

// ---------------------------------------------------------------------------
// Hazır şablonlar — element kurucu kısayolları
// ---------------------------------------------------------------------------

function font(sizePt: number, opts?: Partial<FontSpec>): FontSpec {
  return { sizePt, bold: false, align: "left" as TextAlign, color: "#000000", ...opts }
}

let nextZ = 0

function fieldEl(
  id: string,
  fieldKey: FieldElement["fieldKey"],
  rect: { x: number; y: number; w: number; h: number },
  f: FontSpec,
  extra?: Partial<FieldElement>
): FieldElement {
  return {
    id,
    type: "field",
    fieldKey,
    ...rect,
    rotation: 0,
    z: nextZ++,
    font: f,
    fit: "shrink",
    ...extra,
  }
}

function barcodeEl(
  id: string,
  rect: { x: number; y: number; w: number; h: number },
  extra?: Partial<BarcodeElement>
): BarcodeElement {
  return {
    id,
    type: "barcode",
    source: "barcode",
    symbology: "auto",
    showText: true,
    ...rect,
    rotation: 0,
    z: nextZ++,
    ...extra,
  }
}

function qrEl(
  id: string,
  rect: { x: number; y: number; w: number; h: number },
  extra?: Partial<QrElement>
): QrElement {
  return { id, type: "qr", source: "barcode", ...rect, rotation: 0, z: nextZ++, ...extra }
}

function lineEl(
  id: string,
  rect: { x: number; y: number; w: number; h: number },
  extra?: Partial<ShapeElement>
): ShapeElement {
  return {
    id,
    type: "shape",
    shape: "line",
    strokeColor: "#000000",
    strokeWidthMm: 0.3,
    dashed: false,
    fillColor: null,
    ...rect,
    rotation: 0,
    z: nextZ++,
    ...extra,
  }
}

function design(page: LabelDesign["page"], elements: LabelDesign["elements"]): LabelDesign {
  // z'yi dizi sırasından yeniden ata (kurucuların global sayacından bağımsız).
  return {
    version: LABEL_DESIGN_VERSION,
    page,
    elements: elements.map((el, i) => ({ ...el, z: i })),
  }
}

export interface StarterTemplate {
  name: string
  description: string
  design: LabelDesign
}

function rollPage(widthMm: number, heightMm: number): LabelDesign["page"] {
  return { labelType: "ROLL", widthMm, heightMm, columns: 1, gapXMm: 2, gapYMm: 2 }
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    name: "Fiyat Etiketi 40×20",
    description: "Ürün adı, barkod ve KDV dahil fiyat — en yaygın rulo boyu",
    design: design(rollPage(40, 20), [
      fieldEl("p1-name", "name", { x: 1, y: 0.5, w: 38, h: 6 }, font(6.5, { bold: true }), {
        fit: "wrap",
      }),
      barcodeEl("p1-bc", { x: 1, y: 7.5, w: 23, h: 11.5 }),
      fieldEl(
        "p1-price",
        "salePriceWithVat",
        { x: 25, y: 9.5, w: 14, h: 8 },
        font(10, { bold: true, align: "right" }),
        { price: { decimals: 2, showCurrency: true } }
      ),
    ]),
  },
  {
    name: "Barkod Etiketi 50×30",
    description: "Ürün adı + büyük barkod",
    design: design(rollPage(50, 30), [
      fieldEl("p2-name", "name", { x: 1.5, y: 1, w: 47, h: 7 }, font(7, { align: "center" }), {
        fit: "wrap",
      }),
      barcodeEl("p2-bc", { x: 5, y: 8.5, w: 40, h: 19 }),
    ]),
  },
  {
    name: "Raf Etiketi 60×40",
    description: "Firma, ürün adı, kod, barkod ve büyük fiyat",
    design: design(rollPage(60, 40), [
      fieldEl("p3-comp", "companyName", { x: 2, y: 1, w: 56, h: 4 }, font(6, { align: "center" })),
      lineEl("p3-line", { x: 2, y: 5.8, w: 56, h: 0.3 }),
      fieldEl("p3-name", "name", { x: 2, y: 7, w: 56, h: 9 }, font(9, { bold: true }), {
        fit: "wrap",
      }),
      fieldEl("p3-code", "code", { x: 2, y: 16.5, w: 28, h: 4 }, font(6), { prefix: "Kod: " }),
      barcodeEl("p3-bc", { x: 2, y: 22, w: 30, h: 16 }),
      fieldEl(
        "p3-price",
        "salePriceWithVat",
        { x: 34, y: 24, w: 24, h: 12 },
        font(16, { bold: true, align: "right" }),
        { price: { decimals: 2, showCurrency: true } }
      ),
    ]),
  },
  {
    name: "QR'lı Etiket 50×30",
    description: "QR kod (barkod değerinden) + ad ve fiyat",
    design: design(rollPage(50, 30), [
      qrEl("p4-qr", { x: 2, y: 2, w: 16, h: 16 }),
      fieldEl("p4-code", "code", { x: 2, y: 19.5, w: 16, h: 3.5 }, font(5, { align: "center" })),
      fieldEl("p4-name", "name", { x: 20, y: 2, w: 28, h: 9 }, font(7, { bold: true }), {
        fit: "wrap",
      }),
      fieldEl(
        "p4-price",
        "salePriceWithVat",
        { x: 20, y: 16, w: 28, h: 10 },
        font(13, { bold: true, align: "right" }),
        { price: { decimals: 2, showCurrency: true } }
      ),
    ]),
  },
  {
    name: "Koli Etiketi 100×50",
    description: "Firma, büyük ürün adı, kod/birim/tarih ve barkod",
    design: design(rollPage(100, 50), [
      fieldEl("p5-comp", "companyName", { x: 3, y: 2, w: 94, h: 5 }, font(8)),
      lineEl("p5-line", { x: 3, y: 8, w: 94, h: 0.4 }, { strokeWidthMm: 0.4 }),
      fieldEl("p5-name", "name", { x: 3, y: 10, w: 94, h: 12 }, font(14, { bold: true }), {
        fit: "wrap",
      }),
      fieldEl("p5-code", "code", { x: 3, y: 23.5, w: 42, h: 5 }, font(8), { prefix: "Kod: " }),
      fieldEl("p5-unit", "unit", { x: 3, y: 29.5, w: 42, h: 5 }, font(8), { prefix: "Birim: " }),
      fieldEl("p5-date", "date", { x: 3, y: 43, w: 42, h: 4.5 }, font(6.5), { prefix: "Tarih: " }),
      barcodeEl("p5-bc", { x: 50, y: 24, w: 47, h: 22 }),
    ]),
  },
  {
    name: "A4 21'li Fiyat Etiketi",
    description: "63,5×38,1 yapışkanlı yaprak (3×7) — ad, barkod, fiyat",
    design: design(
      {
        labelType: "A4",
        widthMm: 63.5,
        heightMm: 38.1,
        columns: 3,
        gapXMm: 2.5,
        gapYMm: 0,
        a4: { marginTopMm: 15.1, marginLeftMm: 7.2 },
      },
      [
        fieldEl("p6-name", "name", { x: 3, y: 2.5, w: 57.5, h: 10 }, font(9, { bold: true }), {
          fit: "wrap",
        }),
        barcodeEl("p6-bc", { x: 3, y: 14.5, w: 32, h: 18 }),
        fieldEl(
          "p6-price",
          "salePriceWithVat",
          { x: 37, y: 18, w: 23.5, h: 12 },
          font(14, { bold: true, align: "right" }),
          { price: { decimals: 2, showCurrency: true } }
        ),
      ]
    ),
  },
]
