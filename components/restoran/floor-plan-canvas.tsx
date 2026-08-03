"use client"

// Salon planı tuvali — YATAY ızgara üzerinde masa ve kroki öğeleri.
//
// Tuval `cols × rows` hücredir ve hücre KAREDİR (kroki gerçek bir sketch;
// yamultmak yuvarlak masayı elips yapardı). Dışarıdan gelen sütun/satır sayıları
// birer ALT SINIRDIR — kaç hücre çizileceğine tuval karar verir, çünkü cevabı
// piksel belirler.
//
// İki şart aynı anda sağlanır:
//   1. Plan bir bakışta görünür — ölçek, içeriğin dayattığı ızgarayı kutuya
//      sığdıracak şekilde seçilir (`scale`).
//   2. Tuval kutuyu doldurur — artan yer BOŞLUK değil, fazladan zemin hücresi
//      olur; ızgara sağa ve aşağı uzar.
//
// Önce sabit oran (16:9), sonra "genişliği doldur, yüksekliği taşır" denendi:
// birincisinde tuval kartın ortasında yüzen dar bir kutuydu, ikincisinde derin
// bir plan sayfayı metrelerce uzatıyordu. Artan yeri zemine çevirmek ikisini de
// çözüyor ve kullanıcıya masa taşıyacak gerçek alan bırakıyor.
//
// Piksel hiçbir yerde saklanmaz (koordinatlar hücre cinsinden DB'de durur).
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
  PLAN_CELLS_MAX,
  RESIZE_HANDLES,
  clampRect,
  editRows,
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

/** Tuvalin kaplayabileceği ekran yüksekliği. Plan bir bakışta görülmeli:
 *  aşağı kaydırarak okunan kroki, salonun şeklini kafada tutmayı bırakıp
 *  masa aramaya çeviriyor. */
const VIEWPORT_RATIO = 0.68
const MIN_BUDGET = 320
/** Hücre bundan küçülürse tuval kaydırmaya geçer — 40 sütunluk plan telefonda
 *  8 piksellik hücrelere inip dokunulamaz hale gelmesin. */
const MIN_CELL = 18
/** Hücre bundan büyümez: artan yer masayı şişirmek yerine ZEMİNE gider. Küçük
 *  bir plan geniş ekranda dev masalara dönüşmesin. */
const MAX_CELL = 96
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
  /** En az kaç sütun çizilmeli: bölgenin ayarı ve içeriğin dayattığı genişlik.
   *  Ekranda yer varsa tuval bunun ÜSTÜNE çıkar. */
  minCols: number
  /** En az kaç satır çizilmeli (içeriğin dayattığı derinlik). */
  minRows: number
  tables: PlanTable[]
  items: PlanItem[]
  editMode: boolean
  /** Kalem: seçili araç ("TABLE" veya kroki türü). Boşsa çizim kapalı. */
  tool: string | null
  selection: PlanSelection | null
  busyTableId: string | null
  /** Filtre/aramanın seçtiği masalar. null = filtre yok. Eşleşmeyen masa
   *  soluklaşır ama TIKLANABİLİR kalır: filtre bir görüş yardımıdır, kilit
   *  değil — garson aradığı masayı görünce yanındakine de servis yapar. */
  focusIds?: Set<string> | null
  /** Süre etiketlerinin tazelendiği an; dışarıdan verilir ki her tuval aynı
   *  dakikayı göstersin ve her biri kendi zamanlayıcısını kurmasın. */
  now: number
  onSelect: (sel: PlanSelection | null) => void
  /** Jest bitti — yeni yerleşimi kaydet. */
  onGeometry: (sel: PlanSelection, rect: PlanRect) => void
  /** Kalemle çizildi. `exact` false ise kullanıcı sürüklemedi (tek tık) —
   *  ölçü aracın varsayılanından alınmalı. `grid` o anki tuvalin ızgarası:
   *  varsayılan ölçü oraya oturtulacak ve gerçek sayıyı yalnız tuval biliyor. */
  onDraw: (
    tool: string,
    rect: PlanRect,
    exact: boolean,
    grid: { cols: number; rows: number },
  ) => void
  onOpenTable: (table: PlanTable) => void
  /** Dolu masa başka masanın üstüne bırakıldı (taşı/birleştir). */
  onTableDrop: (source: PlanTable, target: PlanTable) => void
  onDeleteSelection?: () => void
  onDuplicateSelection?: () => void
}

export function FloorPlanCanvas({
  minCols,
  minRows,
  tables,
  items,
  editMode,
  tool,
  selection,
  busyTableId,
  focusIds,
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
  // Yükseklik bütçesi ekrandan gelir. SSR'da pencere yok; 800 makul bir
  // başlangıç, ilk boyamada gerçek değerle değişiyor.
  const [viewportHeight, setViewportHeight] = useState(800)
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

  useEffect(() => {
    const read = () => setViewportHeight(window.innerHeight)
    read()
    window.addEventListener("resize", read)
    return () => window.removeEventListener("resize", read)
  }, [])

  // 1) Ölçek: zorunlu ızgara (`minCols × minRows`) kutuya tam sığsın. Tam sayı,
  //    çünkü kesirli hücre tuvali kutudan bir piksel taşırıp gereksiz kaydırma
  //    çubuğu çıkarabiliyor.
  const budget = Math.max(MIN_BUDGET, viewportHeight * VIEWPORT_RATIO)
  const boxWidth = Math.max(wrapWidth, 260)
  const cell = Math.max(
    MIN_CELL,
    Math.min(MAX_CELL, Math.floor(Math.min(boxWidth / minCols, budget / minRows))),
  )
  // 2) Artan yer zemine gider: ızgara kutuyu dolduracak kadar uzar. Tavan
  //    ayarın tavanı DEĞİL (`PLAN_CELLS_MAX`) — 40'ta kesmek, hücrenin küçüldüğü
  //    derin planlarda tuvali kutudan dar bırakıp yan boşlukları geri getiriyordu.
  const cols = Math.min(PLAN_CELLS_MAX, Math.max(minCols, Math.floor(boxWidth / cell)))
  const base = Math.min(PLAN_CELLS_MAX, Math.max(minRows, Math.floor(budget / cell)))
  // Düzenlerken altta iki boş satır: ızgara zaten kutuyu doldurduğu için derin
  // bir planda aşağıda hiç yer kalmıyor, plan büyütülemez hale geliyordu.
  const rows = editMode ? editRows(base) : base
  const width = cell * cols
  const height = cell * rows
  const font = (mult: number) => Math.max(8, Math.round(cell * mult))
  const dense = cell < 34

  const cellAt = useCallback(
    (clientX: number, clientY: number) => {
      const box = surfaceRef.current?.getBoundingClientRect()
      if (!box) return { x: 0, y: 0 }
      return {
        x: Math.min(cols - 1, Math.max(0, Math.floor((clientX - box.left) / cell))),
        y: Math.min(rows - 1, Math.max(0, Math.floor((clientY - box.top) / cell))),
      }
    },
    [cell, cols, rows],
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
    const first = rectBetween(c.x, c.y, c.x, c.y, cols, rows)
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
      const rect = rectBetween(g.ax, g.ay, c.x, c.y, cols, rows)
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
        ? clampRect(
            { ...g.start, x: g.start.x + Math.round(dxc), y: g.start.y + Math.round(dyc) },
            cols,
            rows,
          )
        : resizeInGrid(g.start, g.handle!, dxc, dyc, cols, rows)

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
      if (g.last) onDraw(g.tool, g.last, g.moved, { cols, rows })
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
      ? clampRect({ ...start, width: start.width + dx, height: start.height + dy }, cols, rows)
      : clampRect({ ...start, x: start.x + dx, y: start.y + dy }, cols, rows)
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
          // mx-auto: yükseklik bütçesi bağlayıcı olduğunda tuval karttan dar
          // kalır; sola yapışınca sağda açıklanamayan bir boşluk kalıyordu.
          "relative mx-auto rounded-xl border border-border/70 bg-muted/25 shadow-inner outline-none",
          editMode && "touch-none",
          tool && editMode && "cursor-crosshair",
        )}
        style={{
          width,
          height,
          // Izgara zemindir, desen değil: kullanım kipinde masaların önüne
          // geçmesin diye çizgiler soluk. Kalın çizgi 4 hücrede bir.
          backgroundImage: `
            linear-gradient(to right, hsl(var(--border)/0.6) 1px, transparent 1px),
            linear-gradient(to bottom, hsl(var(--border)/0.6) 1px, transparent 1px),
            linear-gradient(to right, hsl(var(--border)/0.28) 1px, transparent 1px),
            linear-gradient(to bottom, hsl(var(--border)/0.28) 1px, transparent 1px)
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
          const dimmed = focusIds ? !focusIds.has(table.id) : false
          const matched = focusIds ? !dimmed : false

          // Küçük hücrede masaya sığmayan bilgi (kalem sayısı, rezervasyon
          // sahibi) burada okunur: kutuyu büyütmeden ayrıntı verir.
          const hint = [
            table.name,
            style.label,
            table.capacity ? `${table.capacity} kişilik` : null,
            table.openTicket
              ? `${currency(table.openTicket.total)} · ${table.openTicket.itemCount} kalem · ${elapsedLabel(table.openTicket.openedAt, now)}`
              : null,
            table.reservation
              ? `${table.reservation.guestName} — ${new Date(table.reservation.reservedAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")

          return (
            <div
              key={table.id}
              role="button"
              tabIndex={0}
              title={hint}
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
                // Geçiş listesi ELLE yazılı: `transition-all` sürüklerken
                // transform'u ve left/top'u da yumuşatıp jesti parmağın
                // arkasında bırakıyor.
                "absolute z-10 flex flex-col items-center justify-center gap-0.5 border-2 p-0.5 text-center leading-tight shadow-sm transition-[background-color,border-color,color,box-shadow,opacity,filter] duration-150",
                table.shape === "CIRCLE" ? "rounded-full" : "rounded-xl",
                style.className,
                editMode
                  ? "cursor-move touch-none"
                  : "cursor-pointer hover:z-20 hover:shadow-md hover:brightness-[1.03]",
                isSelected && "z-20 ring-2 ring-kobipo-blue ring-offset-1 dark:ring-primary",
                matched && !isSelected && "z-20 ring-2 ring-kobipo-blue ring-offset-1 dark:ring-primary",
                dimmed && "opacity-25 saturate-50",
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
