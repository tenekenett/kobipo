"use client"

// Etiket Tasarımcısı — tuval: etiket yüzeyi (mm ızgaralı), öğe seçimi,
// sürükle/boyutlandır (pointer capture; jest boyunca DRAG_UPDATE, bırakınca
// COMMIT → jest başına tek undo) ve klavye kısayolları.
// Yüzey her temada BEYAZDIR: baskı önizlemesidir, tema rengi almaz.

import { useCallback, useRef } from "react"
import type { LabelElement } from "@/lib/labels/types"
import type { LabelCompanyInfo, LabelProduct } from "@/lib/labels/fields"
import {
  RESIZE_HANDLES,
  type RectMm,
  type ResizeHandle,
  applyResize,
  clampRectToPage,
  handleCursor,
  mmToPx,
  pxToMm,
  snapMm,
} from "@/lib/labels/geometry"
import type { DesignerApi } from "./use-label-designer-state"
import { ElementPreview } from "./element-preview"

interface DesignerCanvasProps {
  api: DesignerApi
  zoom: number
  product: LabelProduct
  company: LabelCompanyInfo
}

interface DragState {
  mode: "move" | ResizeHandle
  id: string
  startClientX: number
  startClientY: number
  startRect: RectMm
  moved: boolean
}

/** Tutamaç konumunun CSS'i (6px kare, kenar/köşe ortalanır). */
function handleStyle(h: ResizeHandle): React.CSSProperties {
  const style: React.CSSProperties = {
    position: "absolute",
    width: 8,
    height: 8,
    cursor: handleCursor(h),
  }
  if (h.includes("n")) style.top = -4
  else if (h.includes("s")) style.bottom = -4
  else style.top = "calc(50% - 4px)"
  if (h.includes("w")) style.left = -4
  else if (h.includes("e")) style.right = -4
  else style.left = "calc(50% - 4px)"
  return style
}

export function DesignerCanvas({ api, zoom, product, company }: DesignerCanvasProps) {
  const { design, selectedId } = api
  const page = design.page
  const dragRef = useRef<DragState | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const surfaceW = mmToPx(page.widthMm, zoom)
  const surfaceH = mmToPx(page.heightMm, zoom)
  const gridMinor = mmToPx(1, zoom)
  const gridMajor = mmToPx(5, zoom)

  const beginGesture = useCallback(
    (e: React.PointerEvent, el: LabelElement, mode: DragState["mode"]) => {
      e.preventDefault()
      e.stopPropagation()
      api.select(el.id)
      wrapperRef.current?.focus()
      dragRef.current = {
        mode,
        id: el.id,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startRect: { x: el.x, y: el.y, w: el.w, h: el.h },
        moved: false,
      }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [api]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const dxMm = pxToMm(e.clientX - drag.startClientX, zoom)
      const dyMm = pxToMm(e.clientY - drag.startClientY, zoom)
      if (!drag.moved && Math.abs(dxMm) < 0.2 && Math.abs(dyMm) < 0.2) return
      drag.moved = true

      let rect: RectMm
      if (drag.mode === "move") {
        rect = {
          ...drag.startRect,
          x: snapMm(drag.startRect.x + dxMm),
          y: snapMm(drag.startRect.y + dyMm),
        }
      } else {
        const r = applyResize(drag.startRect, drag.mode, dxMm, dyMm)
        rect = { x: snapMm(r.x), y: snapMm(r.y), w: snapMm(r.w), h: snapMm(r.h) }
      }
      api.dragUpdate(drag.id, clampRectToPage(rect, page))
    },
    [api, page, zoom]
  )

  const onPointerUp = useCallback(() => {
    if (!dragRef.current) return
    if (dragRef.current.moved) api.commitGesture()
    dragRef.current = null
  }, [api])

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault()
        if (e.shiftKey) api.redo()
        else api.undo()
        return
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault()
        api.redo()
        return
      }
      const el = api.selectedElement
      if (!el) return
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault()
        api.duplicateElement(el.id)
        return
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault()
        api.deleteElement(el.id)
        return
      }
      if (e.key.startsWith("Arrow")) {
        e.preventDefault()
        const step = e.shiftKey ? 0.1 : 0.5
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0
        const rect = clampRectToPage(
          { x: snapMm(el.x + dx, 0.1), y: snapMm(el.y + dy, 0.1), w: el.w, h: el.h },
          page
        )
        api.patchElement(el.id, { x: rect.x, y: rect.y })
      }
    },
    [api, page]
  )

  const sorted = [...design.elements].sort((a, b) => a.z - b.z)

  return (
    <div
      ref={wrapperRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="flex h-full w-full items-center justify-center overflow-auto bg-muted/40 p-8 outline-none"
      data-testid="label-canvas"
    >
      <div className="flex flex-col items-center gap-2">
        <div
          className="relative shrink-0 shadow-md ring-1 ring-border"
          style={{
            width: surfaceW,
            height: surfaceH,
            backgroundColor: "#ffffff",
            backgroundImage: `
              linear-gradient(to right, rgba(59,130,246,0.14) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(59,130,246,0.14) 1px, transparent 1px),
              linear-gradient(to right, rgba(59,130,246,0.05) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(59,130,246,0.05) 1px, transparent 1px)
            `,
            backgroundSize: `${gridMajor}px ${gridMajor}px, ${gridMajor}px ${gridMajor}px, ${gridMinor}px ${gridMinor}px, ${gridMinor}px ${gridMinor}px`,
          }}
          onPointerDown={(e) => {
            // Boş yüzeye tıklayınca seçim kalkar (öğeler stopPropagation yapar).
            if (e.target === e.currentTarget) api.select(null)
            wrapperRef.current?.focus()
          }}
        >
          {sorted.map((el) => {
            const selected = el.id === selectedId
            return (
              <div
                key={el.id}
                onPointerDown={(e) => beginGesture(e, el, "move")}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                className={
                  selected
                    ? "absolute ring-2 ring-primary"
                    : "absolute ring-1 ring-transparent hover:ring-primary/40"
                }
                style={{
                  left: mmToPx(el.x, zoom),
                  top: mmToPx(el.y, zoom),
                  width: mmToPx(el.w, zoom),
                  height: mmToPx(el.h, zoom),
                  cursor: "move",
                  touchAction: "none",
                }}
              >
                <ElementPreview el={el} zoom={zoom} product={product} company={company} />
                {selected &&
                  RESIZE_HANDLES.map((h) => (
                    <div
                      key={h}
                      onPointerDown={(e) => beginGesture(e, el, h)}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      className="rounded-[2px] border border-primary bg-background"
                      style={{ ...handleStyle(h), touchAction: "none" }}
                    />
                  ))}
              </div>
            )
          })}
        </div>
        <div className="text-xs text-muted-foreground">
          {page.widthMm} × {page.heightMm} mm
          {page.labelType === "A4" ? " — A4 yaprak" : page.columns > 1 ? ` — ${page.columns} sütun rulo` : " — rulo"}
        </div>
      </div>
    </div>
  )
}
