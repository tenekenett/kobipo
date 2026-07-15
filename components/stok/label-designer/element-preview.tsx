"use client"

// Etiket Tasarımcısı — öğe içerik önizlemesi (DOM renderer). PDF tarafıyla
// (lib/pdf/label-pdf.ts) aynı modeli çizer: mm→px (pxPerMm·zoom), satır
// yüksekliği 1.15, shrink tek satırı 0.5pt adımla sığdırır (alt sınır 4pt),
// barkod/QR bitmap'leri her değişimde yeniden üretilir (persist edilmez).

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle } from "lucide-react"
import type {
  BarcodeElement,
  FieldElement,
  ImageElement,
  LabelElement,
  QrElement,
  ShapeElement,
  TextElement,
} from "@/lib/labels/types"
import type { LabelCompanyInfo, LabelProduct } from "@/lib/labels/fields"
import { resolveCodeValue, resolveFieldValue } from "@/lib/labels/fields"
import { PT_TO_MM, barcodeTextLayout, mmToPx } from "@/lib/labels/geometry"
import { renderBarcodeDataUrl, renderQrDataUrl } from "@/lib/labels/barcode"

/** PDF'teki DejaVu Sans'a en yakın yaygın sistem font yığını. */
export const LABEL_FONT_STACK = '"DejaVu Sans", Verdana, Arial, sans-serif'
const LINE_HEIGHT = 1.15

let measureCtx: CanvasRenderingContext2D | null = null

function measureTextPx(text: string, fontPx: number, bold: boolean): number {
  if (typeof document === "undefined") return text.length * fontPx * 0.6
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d")
  if (!measureCtx) return text.length * fontPx * 0.6
  measureCtx.font = `${bold ? "bold " : ""}${fontPx}px ${LABEL_FONT_STACK}`
  return measureCtx.measureText(text).width
}

/** PDF'teki shrink kuralının DOM eşleniği: 0.5pt adımlarla kutuya sığdır. */
function fitSizePt(text: string, boxWMm: number, startPt: number, bold: boolean, zoom: number): number {
  const boxWpx = mmToPx(boxWMm, zoom)
  let sizePt = startPt
  while (sizePt > 4 && measureTextPx(text, sizePt * PT_TO_MM * mmToPx(1, zoom), bold) > boxWpx) {
    sizePt -= 0.5
  }
  return sizePt
}

interface PreviewProps {
  el: LabelElement
  zoom: number
  product: LabelProduct
  company: LabelCompanyInfo
}

function TextPreview({
  el,
  zoom,
  str,
}: {
  el: TextElement | FieldElement
  zoom: number
  str: string
}) {
  const sizePt = useMemo(
    () => (el.fit === "shrink" ? fitSizePt(str, el.w, el.font.sizePt, el.font.bold, zoom) : el.font.sizePt),
    [el.fit, el.font.bold, el.font.sizePt, el.w, str, zoom]
  )
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        fontFamily: LABEL_FONT_STACK,
        fontSize: sizePt * PT_TO_MM * mmToPx(1, zoom),
        fontWeight: el.font.bold ? 700 : 400,
        color: el.font.color,
        textAlign: el.font.align,
        lineHeight: LINE_HEIGHT,
        whiteSpace: el.fit === "wrap" ? "normal" : "nowrap",
        wordBreak: "break-word",
      }}
    >
      {str}
    </div>
  )
}

/** Barkod üretilemediğinde gösterilen uyarı kutusu (PDF ham değeri metin basar). */
function InvalidCodeBox({ value, zoom }: { value: string; zoom: number }) {
  return (
    <div
      className="flex h-full w-full flex-col items-center justify-center gap-0.5 rounded-sm border border-dashed border-destructive/60 text-destructive"
      style={{ fontSize: Math.max(9, mmToPx(2.4, zoom) * 0.8) }}
    >
      <AlertTriangle style={{ width: mmToPx(3, zoom), height: mmToPx(3, zoom) }} />
      <span className="max-w-full truncate px-1">{value || "Değer yok"}</span>
    </div>
  )
}

function BarcodePreview({ el, zoom, product }: { el: BarcodeElement; zoom: number; product: LabelProduct }) {
  const value = resolveCodeValue(el, product).trim()
  const layout = barcodeTextLayout(el.h, el.showText)
  const [url, setUrl] = useState<string | null>(null)
  const [pending, setPending] = useState(true)

  useEffect(() => {
    let active = true
    setPending(true)
    renderBarcodeDataUrl(value, el.symbology, el.w, layout.barsH).then((u) => {
      if (!active) return
      setUrl(u)
      setPending(false)
    })
    return () => {
      active = false
    }
  }, [value, el.symbology, el.w, layout.barsH])

  if (!url) {
    return pending ? null : <InvalidCodeBox value={value} zoom={zoom} />
  }

  return (
    <div className="flex h-full w-full flex-col">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt=""
        draggable={false}
        style={{ width: "100%", height: mmToPx(layout.barsH, zoom), objectFit: "fill" }}
      />
      {el.showText && layout.textH > 0 && (
        <div
          style={{
            fontFamily: LABEL_FONT_STACK,
            fontSize: layout.textPt * PT_TO_MM * mmToPx(1, zoom),
            textAlign: "center",
            lineHeight: 1,
            marginTop: mmToPx(0.3, zoom),
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          {value}
        </div>
      )}
    </div>
  )
}

function QrPreview({ el, zoom, product }: { el: QrElement; zoom: number; product: LabelProduct }) {
  const value = resolveCodeValue(el, product).trim()
  const side = Math.min(el.w, el.h)
  const [url, setUrl] = useState<string | null>(null)
  const [pending, setPending] = useState(true)

  useEffect(() => {
    let active = true
    setPending(true)
    renderQrDataUrl(value, side).then((u) => {
      if (!active) return
      setUrl(u)
      setPending(false)
    })
    return () => {
      active = false
    }
  }, [value, side])

  if (!url) {
    return pending ? null : <InvalidCodeBox value={value} zoom={zoom} />
  }

  return (
    <div className="flex h-full w-full items-center justify-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt=""
        draggable={false}
        style={{ width: mmToPx(side, zoom), height: mmToPx(side, zoom) }}
      />
    </div>
  )
}

function ShapePreview({ el, zoom }: { el: ShapeElement; zoom: number }) {
  const strokePx = Math.max(1, mmToPx(el.strokeWidthMm, zoom))
  const borderStyle = el.dashed ? "dashed" : "solid"

  if (el.shape === "line") {
    // Kutunun ortasından geçen yatay çizgi (PDF ile aynı).
    return (
      <div className="flex h-full w-full items-center">
        <div
          style={{
            width: "100%",
            height: 0,
            borderTop: `${strokePx}px ${borderStyle} ${el.strokeColor}`,
          }}
        />
      </div>
    )
  }

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        border: `${strokePx}px ${borderStyle} ${el.strokeColor}`,
        borderRadius: el.shape === "circle" ? "50%" : undefined,
        backgroundColor: el.fillColor ?? "transparent",
      }}
    />
  )
}

function ImagePreview({ el }: { el: ImageElement }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={el.dataUrl}
      alt=""
      draggable={false}
      style={{ width: "100%", height: "100%", objectFit: "fill" }}
    />
  )
}

/**
 * Öğenin iç görselini çizer; rotasyon içerik sarmalayıcısına uygulanır
 * (merkez etrafında CSS rotate = PDF'in merkez etrafında döndürme davranışı).
 * Konum/boyut/seçim çerçevesi çağıran canvas'ın işidir.
 */
export function ElementPreview({ el, zoom, product, company }: PreviewProps) {
  let content: React.ReactNode
  switch (el.type) {
    case "text":
      content = <TextPreview el={el} zoom={zoom} str={el.text} />
      break
    case "field":
      content = <TextPreview el={el} zoom={zoom} str={resolveFieldValue(el, product, company)} />
      break
    case "barcode":
      content = <BarcodePreview el={el} zoom={zoom} product={product} />
      break
    case "qr":
      content = <QrPreview el={el} zoom={zoom} product={product} />
      break
    case "shape":
      content = <ShapePreview el={el} zoom={zoom} />
      break
    case "image":
      content = <ImagePreview el={el} />
      break
  }

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
      }}
    >
      {content}
    </div>
  )
}
