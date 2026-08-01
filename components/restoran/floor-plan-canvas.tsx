"use client"

// Salon planı tuvali — KARE ızgara üzerinde masa ve kroki öğeleri.
//
// Tuval kendi ölçüsünü kapsayıcıdan alır ve daima karedir: `grid × grid` hücre,
// hücre boyu = kenar / grid. Piksel hiçbir yerde saklanmaz (koordinatlar hücre
// cinsinden DB'de durur) — plan telefonda da, geniş ekranda da aynı görünür.
//
// Üç jest, tek yerde: TAŞI (gövdeden çek), BOYUTLANDIR (kenar/köşe tutamacı),
// ÇİZ (araç seçiliyken boş tuvale sürükle). Hepsi işaretçiyi TUVALE kilitler
// (setPointerCapture): parmak öğenin dışına taşınca jest kopmasın.
//
// Kullanım kipinde dördüncü bir jest var: dolu masayı başka masanın üstüne
// bırakmak (taşı/birleştir). Boyutlandırma tutamaçları kullanım kipinde HİÇ
// çizilmez — garson servis sırasında yanlışlıkla salonu yeniden tasarlamasın.

import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, Users } from "lucide-react"
import {
  RESIZE_HANDLES,
  clampRectToGrid,
  handleAnchor,
  handleCursor,
  rectBetween,
  resizeInGrid,
  type PlanRect,
  type ResizeHandle,
} from "@/lib/restoran/floor-plan"
import type { PlanItem, PlanTable } from "@/lib/swr/use-restoran"
import { currency } from "@/lib/fis/receipt-html"
import { cn } from "@/lib/utils"
import {
  TABLE_STATE_ICON,
  TABLE_STATE_STYLE,
  kindDef,
  tableState,
} from "./plan-kinds"

export type PlanSelection = { type: "table" | "item"; id: string }

/** Tuvalin büyüyebileceği en büyük kenar. Daha fazlası okumayı kolaylaştırmıyor,
 *  yalnız fareyi yoruyor. */
const MAX_SIDE = 880
/** Hücre bundan küçülürse tuval kaydırmaya geçer — 32'lik plan telefonda
 *  8 piksellik hücrelere inip dokunulamaz hale gelmesin. */
const MIN_CELL = 18
/** Jestin "dokunma" mı "sürükleme" mi olduğunu ayıran eşik (hücre). */
const DRAG_THRESHOLD = 0.25

type Gesture =
  | {
      kind: "move" | "resize"
      sel: PlanSelection
      handle?: ResizeHandle
      start: PlanRect
      cx: number
      cy: number
      moved: boolean
      last?: PlanRect
    }
  | { kind: "draw"; tool: string; ax: number; ay: number; moved: boolean; last?: PlanRect }
  | { kind: "carry"; table: PlanTable; cx: number; cy: number; moved: boolean; overId?: string | null }

const containsCell = (r: PlanRect, x: number, y: number) =>
  x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height

/** "2s 15d" — masanın ne kadardır dolu olduğu. */
export function elapsedLabel(fromIso: string, now: number): string {
  const mins = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 60000))
  if (mins < 60) return `${mins}d`
  return `${Math.floor(mins / 60)}s ${mins % 60}d`
}

interface FloorPlanCanvasProps {
  grid: number
  tables: PlanTable[]
  items: PlanItem[]
  editMode: boolean
  /** Kalem: seçili araç ("TABLE" veya kroki türü). Boşsa çizim kapalı. */
  tool: string | null
  selection: PlanSelection | null
  busyTableId: string | null
  /** Süre etiketlerinin tazelendiği an; dışarıdan verilir ki her tuval aynı
   *  dakikayı göstersin ve her biri kendi zamanlayıcısını kurmasın. */
  now: number
  onSelect: (sel: PlanSelection | null) => void
  /** Jest bitti — yeni yerleşimi kaydet. */
  onGeometry: (sel: PlanSelection, rect: PlanRect) => void
  /** Kalemle çizildi. `exact` false ise kullanıcı sürüklemedi (tek tık) —
   *  ölçü aracın varsayılanından alınmalı. */
  onDraw: (tool: string, rect: PlanRect, exact: boolean) => void
  onOpenTable: (table: PlanTable) => void
  /** Dolu masa başka masanın üstüne bırakıldı (taşı/birleştir). */
  onTableDrop: (source: PlanTable, target: PlanTable) => void
  onDeleteSelection?: () => void
  onDuplicateSelection?: () => void
}

export function FloorPlanCanvas({
  grid,
  tables,
  items,
  editMode,
  tool,
  selection,
  busyTableId,
  now,
  onSelect,
  onGeometry,
  onDraw,
  onOpenTable,
  onTableDrop,
  onDeleteSelection,
  onDuplicateSelection,
}: FloorPlanCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const gestureRef = useRef<Gesture | null>(null)
  /** Jest sonundaki `pointerup`, ardından bir de `click` doğurur. Bu bayrak
   *  olmasa taşınan her masa bırakılınca bir de adisyon açardı. */
  const handledRef = useRef(false)

  const [wrapWidth, setWrapWidth] = useState(0)
  const [ghost, setGhost] = useState<{ id: string; rect: PlanRect } | null>(null)
  const [draft, setDraft] = useState<PlanRect | null>(null)
  const [carry, setCarry] = useState<{
    id: string
    dx: number
    dy: number
    overId: string | null
  } | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    setWrapWidth(el.clientWidth)
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (w) setWrapWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Kenar: kapsayıcıya sığar ama hücre okunmaz küçüklüğe inmez; inecekse tuval
  // kaydırılır (kapsayıcıda `overflow-auto`).
  const side = Math.max(Math.min(Math.max(wrapWidth, 260), MAX_SIDE), grid * MIN_CELL)
  const cell = side / grid
  const font = (mult: number) => Math.max(8, Math.round(cell * mult))
  const dense = cell < 34

  const cellAt = useCallback(
    (clientX: number, clientY: number) => {
      const box = surfaceRef.current?.getBoundingClientRect()
      if (!box) return { x: 0, y: 0 }
      return {
        x: Math.min(grid - 1, Math.max(0, Math.floor((clientX - box.left) / cell))),
        y: Math.min(grid - 1, Math.max(0, Math.floor((clientY - box.top) / cell))),
      }
    },
    [cell, grid],
  )

  const capture = (e: React.PointerEvent) => {
    surfaceRef.current?.setPointerCapture?.(e.pointerId)
  }

  const rectOf = (id: string, own: PlanRect): PlanRect =>
    ghost?.id === id ? ghost.rect : own

  // ---- Jest başlangıçları ---------------------------------------------------

  const beginEdit = (
    e: React.PointerEvent,
    sel: PlanSelection,
    start: PlanRect,
    handle?: ResizeHandle,
  ) => {
    e.preventDefault()
    e.stopPropagation()
    onSelect(sel)
    gestureRef.current = {
      kind: handle ? "resize" : "move",
      sel,
      handle,
      start,
      cx: e.clientX,
      cy: e.clientY,
      moved: false,
    }
    capture(e)
  }

  const beginCarry = (e: React.PointerEvent, table: PlanTable) => {
    e.preventDefault()
    gestureRef.current = {
      kind: "carry",
      table,
      cx: e.clientX,
      cy: e.clientY,
      moved: false,
      overId: null,
    }
    capture(e)
  }

  const onSurfacePointerDown = (e: React.PointerEvent) => {
    // Yalnız BOŞ tuval: öğeler kendi jestlerini başlatıp olayı durduruyor.
    if (e.target !== e.currentTarget) return
    if (!editMode) return
    if (!tool) {
      onSelect(null)
      return
    }
    e.preventDefault()
    const c = cellAt(e.clientX, e.clientY)
    const first = rectBetween(c.x, c.y, c.x, c.y, grid)
    gestureRef.current = { kind: "draw", tool, ax: c.x, ay: c.y, moved: false, last: first }
    setDraft(first)
    capture(e)
  }

  // ---- Jest sürerken --------------------------------------------------------

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gestureRef.current
    if (!g) return

    if (g.kind === "draw") {
      const c = cellAt(e.clientX, e.clientY)
      const rect = rectBetween(g.ax, g.ay, c.x, c.y, grid)
      if (c.x !== g.ax || c.y !== g.ay) g.moved = true
      g.last = rect
      setDraft(rect)
      return
    }

    if (g.kind === "carry") {
      // Boş masa taşınmaz (taşınacak hesabı yok): parmak kaysa bile dokunma
      // sayılır, adisyon açılır. Aksi halde hafif titreyen her dokunuş "hiçbir
      // şey olmadı" ile sonuçlanırdı.
      if (!g.table.openTicket) return
      const dx = e.clientX - g.cx
      const dy = e.clientY - g.cy
      if (Math.abs(dx) > cell * DRAG_THRESHOLD || Math.abs(dy) > cell * DRAG_THRESHOLD) {
        g.moved = true
      }
      const c = cellAt(e.clientX, e.clientY)
      const over = tables.find(
        (t) => t.id !== g.table.id && containsCell({ x: t.x, y: t.y, width: t.width, height: t.height }, c.x, c.y),
      )
      g.overId = over?.id ?? null
      setCarry({ id: g.table.id, dx, dy, overId: g.overId })
      return
    }

    const dxc = (e.clientX - g.cx) / cell
    const dyc = (e.clientY - g.cy) / cell
    if (Math.abs(dxc) > DRAG_THRESHOLD || Math.abs(dyc) > DRAG_THRESHOLD) g.moved = true
    if (!g.moved) return

    const rect =
      g.kind === "move"
        ? clampRectToGrid(
            { ...g.start, x: g.start.x + Math.round(dxc), y: g.start.y + Math.round(dyc) },
            grid,
          )
        : resizeInGrid(g.start, g.handle!, dxc, dyc, grid)

    g.last = rect
    setGhost({ id: g.sel.id, rect })
  }

  const onPointerUp = () => {
    const g = gestureRef.current
    gestureRef.current = null

    if (!g) return

    if (g.kind === "draw") {
      setDraft(null)
      // Sürüklenmediyse ölçü kullanıcının değil, aracın varsayılanıdır: tek
      // tıkla "duvar koy" ile sürükleyerek "şu boyda duvar çiz" aynı araçta.
      if (g.last) onDraw(g.tool, g.last, g.moved)
      return
    }

    if (g.kind === "carry") {
      const over = g.overId
      setCarry(null)
      // Yalnız burada: bu jestin ardından gelecek `click` yutulmalı. Klavyeyle
      // (Enter) gelen tıklamada pointerup olmadığı için bayrak basılı kalmaz.
      handledRef.current = true
      if (!g.moved) {
        onOpenTable(g.table)
        return
      }
      const target = over ? tables.find((t) => t.id === over) : null
      if (target) onTableDrop(g.table, target)
      return
    }

    setGhost(null)
    if (g.moved && g.last) onGeometry(g.sel, g.last)
  }

  const onPointerCancel = () => {
    gestureRef.current = null
    setGhost(null)
    setDraft(null)
    setCarry(null)
  }

  // ---- Klavye ---------------------------------------------------------------

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!editMode || !selection) return
    const source =
      selection.type === "table"
        ? tables.find((t) => t.id === selection.id)
        : items.find((i) => i.id === selection.id)
    if (!source) return
    const start: PlanRect = {
      x: source.x,
      y: source.y,
      width: source.width,
      height: source.height,
    }

    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault()
      onDeleteSelection?.()
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
      e.preventDefault()
      onDuplicateSelection?.()
      return
    }
    if (!e.key.startsWith("Arrow")) return
    e.preventDefault()
    const dx = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0
    const dy = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0
    // Shift + ok = boyutlandır (sağ/alt kenar), düz ok = taşı.
    const next = e.shiftKey
      ? clampRectToGrid({ ...start, width: start.width + dx, height: start.height + dy }, grid)
      : clampRectToGrid({ ...start, x: start.x + dx, y: start.y + dy }, grid)
    onGeometry(selection, next)
  }

  // ---- Çizim ----------------------------------------------------------------

  const handles = (sel: PlanSelection, rect: PlanRect) =>
    RESIZE_HANDLES.map((h) => {
      const anchor = handleAnchor(h)
      return (
        <span
          key={h}
          role="presentation"
          onPointerDown={(e) => beginEdit(e, sel, rect, h)}
          className="absolute z-30 rounded-[2px] border border-kobipo-blue bg-background shadow-sm dark:border-primary"
          style={{
            left: anchor.left,
            top: anchor.top,
            width: 11,
            height: 11,
            marginLeft: -5.5,
            marginTop: -5.5,
            cursor: handleCursor(h),
            touchAction: "none",
          }}
        />
      )
    })

  return (
    <div ref={wrapRef} className="overflow-auto">
      <div
        ref={surfaceRef}
        tabIndex={editMode ? 0 : -1}
        onKeyDown={onKeyDown}
        onPointerDown={onSurfacePointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        className={cn(
          "relative rounded-xl border border-border/70 bg-muted/20 outline-none",
          editMode && "touch-none",
          tool && editMode && "cursor-crosshair",
        )}
        style={{
          width: side,
          height: side,
          backgroundImage: `
            linear-gradient(to right, hsl(var(--border)) 1px, transparent 1px),
            linear-gradient(to bottom, hsl(var(--border)) 1px, transparent 1px),
            linear-gradient(to right, hsl(var(--border)/0.45) 1px, transparent 1px),
            linear-gradient(to bottom, hsl(var(--border)/0.45) 1px, transparent 1px)
          `,
          backgroundSize: `${cell * 4}px ${cell * 4}px, ${cell * 4}px ${cell * 4}px, ${cell}px ${cell}px, ${cell}px ${cell}px`,
        }}
      >
        {/* Kroki masaların ALTINDA çizilir ve kullanım kipinde tıklanamaz —
            garson duvara basıp adisyon açmasın. */}
        {items.map((item) => {
          const def = kindDef(item.kind)
          const Icon = def.icon
          const sel: PlanSelection = { type: "item", id: item.id }
          const rect = rectOf(item.id, {
            x: item.x,
            y: item.y,
            width: item.width,
            height: item.height,
          })
          const isSelected = editMode && selection?.type === "item" && selection.id === item.id
          const text = item.label || (def.showLabel ? def.label : "")

          return (
            <div
              key={item.id}
              role={editMode ? "button" : undefined}
              tabIndex={-1}
              onPointerDown={(e) => editMode && beginEdit(e, sel, rect)}
              className={cn(
                "absolute flex items-center justify-center gap-1 rounded-md border-2 p-0.5 text-center font-semibold leading-tight",
                def.className,
                editMode ? "cursor-move touch-none" : "pointer-events-none",
                isSelected && "z-20 ring-2 ring-kobipo-blue ring-offset-1 dark:ring-primary",
              )}
              style={{
                left: rect.x * cell,
                top: rect.y * cell,
                width: rect.width * cell,
                height: rect.height * cell,
                fontSize: font(0.24),
              }}
            >
              {item.kind !== "TEXT" && rect.width * cell > 26 && rect.height * cell > 18 && (
                <Icon className="shrink-0" style={{ width: font(0.34), height: font(0.34) }} />
              )}
              {text && <span className="line-clamp-2">{text}</span>}
              {isSelected && handles(sel, rect)}
            </div>
          )
        })}

        {tables.map((table) => {
          const sel: PlanSelection = { type: "table", id: table.id }
          const rect = rectOf(table.id, {
            x: table.x,
            y: table.y,
            width: table.width,
            height: table.height,
          })
          const isSelected = editMode && selection?.type === "table" && selection.id === table.id
          const state = tableState(table)
          const style = TABLE_STATE_STYLE[state]
          const StateIcon = TABLE_STATE_ICON[state]
          const carried = carry?.id === table.id
          const isDropTarget = carry?.overId === table.id
          const loading = busyTableId === table.id

          return (
            <div
              key={table.id}
              role="button"
              tabIndex={0}
              aria-label={`${table.name} — ${style.label}`}
              onPointerDown={(e) => {
                if (editMode) {
                  beginEdit(e, sel, rect)
                  return
                }
                beginCarry(e, table)
              }}
              onClick={() => {
                // İşaretçiyle gelen tıklama jest tarafından zaten karşılandı;
                // buraya yalnız klavye (Enter/Space) düşmeli.
                if (handledRef.current) {
                  handledRef.current = false
                  return
                }
                if (!editMode) onOpenTable(table)
              }}
              className={cn(
                "absolute z-10 flex flex-col items-center justify-center gap-0.5 border-2 p-0.5 text-center leading-tight transition-colors",
                table.shape === "CIRCLE" ? "rounded-full" : "rounded-xl",
                style.className,
                editMode ? "cursor-move touch-none" : "cursor-pointer",
                isSelected && "z-20 ring-2 ring-kobipo-blue ring-offset-1 dark:ring-primary",
                carried && "z-30 opacity-80 shadow-xl",
                isDropTarget && "z-20 ring-4 ring-emerald-500 ring-offset-1",
                loading && "opacity-60",
              )}
              style={{
                left: rect.x * cell,
                top: rect.y * cell,
                width: rect.width * cell - 4,
                height: rect.height * cell - 4,
                transform: carried ? `translate(${carry!.dx}px, ${carry!.dy}px)` : undefined,
              }}
            >
              {loading ? (
                <Loader2 className="animate-spin" style={{ width: font(0.4), height: font(0.4) }} />
              ) : (
                <>
                  <span
                    className="line-clamp-1 font-bold"
                    style={{ fontSize: font(0.3) }}
                  >
                    {table.name}
                  </span>

                  {table.openTicket ? (
                    <>
                      <span className="font-semibold" style={{ fontSize: font(0.26) }}>
                        {currency(table.openTicket.total)}
                      </span>
                      {!dense && (
                        <span className="opacity-70" style={{ fontSize: font(0.22) }}>
                          {elapsedLabel(table.openTicket.openedAt, now)} ·{" "}
                          {table.openTicket.itemCount} kalem
                        </span>
                      )}
                    </>
                  ) : state === "RESERVED" && table.reservation ? (
                    <span
                      className="flex items-center gap-1 font-semibold"
                      style={{ fontSize: font(0.23) }}
                    >
                      {StateIcon && (
                        <StateIcon style={{ width: font(0.26), height: font(0.26) }} />
                      )}
                      {new Date(table.reservation.reservedAt).toLocaleTimeString("tr-TR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  ) : state === "CLEANING" ? (
                    <span
                      className="flex items-center gap-1"
                      style={{ fontSize: font(0.23) }}
                    >
                      {StateIcon && (
                        <StateIcon style={{ width: font(0.26), height: font(0.26) }} />
                      )}
                      {!dense && "Toplanacak"}
                    </span>
                  ) : (
                    <span
                      className="flex items-center gap-1 opacity-70"
                      style={{ fontSize: font(0.23) }}
                    >
                      {table.capacity ? (
                        <>
                          <Users style={{ width: font(0.24), height: font(0.24) }} />
                          {table.capacity}
                        </>
                      ) : (
                        !dense && "Boş"
                      )}
                    </span>
                  )}
                </>
              )}

              {/* Hesap istendi rozeti: dolu masada tutar zaten yazıyor, durumu
                  renkten ayrı bir işaretle de vermek gerekiyor (renk körlüğü). */}
              {state === "BILL" && StateIcon && !loading && (
                <StateIcon
                  className="absolute right-0.5 top-0.5"
                  style={{ width: font(0.26), height: font(0.26) }}
                />
              )}

              {isSelected && handles(sel, rect)}
            </div>
          )
        })}

        {/* Kalem önizlemesi */}
        {draft && (
          <div
            className="pointer-events-none absolute z-40 rounded-md border-2 border-dashed border-kobipo-blue bg-kobipo-blue/10 dark:border-primary dark:bg-primary/10"
            style={{
              left: draft.x * cell,
              top: draft.y * cell,
              width: draft.width * cell,
              height: draft.height * cell,
            }}
          >
            <span className="absolute -top-5 left-0 rounded bg-kobipo-blue px-1 text-[10px] font-semibold text-white dark:bg-primary dark:text-primary-foreground">
              {draft.width} × {draft.height}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
