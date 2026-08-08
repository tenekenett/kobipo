"use client"

/**
 * Vardiya takvimi — gün görünümü.
 *
 * Satır = personel, yatay eksen = saat. Vardiya barı doğrudan ızgarada çizilir:
 * boş satırda sürükleyerek yeni vardiya, barın gövdesinden tutup taşıma, iki
 * kenarındaki tutamaçtan mesai saatini uzatıp kısaltma.
 *
 * Jest deseni components/restoran/floor-plan-canvas.tsx ile aynı: tek bir
 * `gestureRef` + yüzeye `setPointerCapture`. Parmak/fare bar'ın dışına taştığında
 * jestin kopmaması için şart — kroki editöründe bu ders zaten alınmıştı.
 *
 * Saatler gün başından itibaren DAKİKA (lib/personel/vardiya.ts). Piksel↔dakika
 * çevrimi ızgaranın ölçülen genişliğinden yapılır; satırların hepsi aynı
 * geometriye sahip olduğu için tek bir sarmalayıcı ölçmek yeter.
 */

import { useCallback, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { Plus } from "lucide-react"
import {
  DAY_MINUTES,
  MIN_SHIFT_MINUTES,
  SNAP_MINUTES,
  clampMinute,
  crossesMidnight,
  durationLabel,
  minuteToHHMM,
  netMinutes,
  shiftLabel,
  snap,
} from "@/lib/personel/vardiya"
import type { OpeningDay } from "@/lib/personel/opening-hours"
import { barClass, softBarClass } from "@/components/personel/shift-colors"

export type TimelineEmployee = {
  id: string
  name: string
  department?: string | null
  position?: string | null
}

export type TimelineShift = {
  id: string
  employeeId: string
  plannedStart: number
  plannedEnd: number
  /** Fiilî damgalar; yoksa vardiya henüz yalnız plandır. */
  actualStart?: number | null
  actualEnd?: number | null
  status?: string
  breakMinutes: number
  note?: string | null
  /** Şablon rengi (varsa barın rengi budur), şablonsuz vardiyada null. */
  color?: string | null
  templateName?: string | null
}

/** Onaylı izin — vardiya yerine satırda bant olarak görünür. */
export type TimelineLeave = {
  employeeId: string
  label: string
}

type Draft = { employeeId: string; start: number; end: number }

/**
 * Jestin son durumu `last` ile REF'te taşınır, yalnız `draft` state'inde değil.
 *
 * State'e güvenmek gerçek bir hataya yol açtı: hızlı bir sürüklemede son
 * `pointermove`'un `setDraft`'i ile `pointerup` aynı React batch'ine düşüyor,
 * `onPointerUp` closure'ı eski değeri okuyor ve kayıt ESKİ saatiyle geri
 * yazılıyordu — istek 200 dönüyor ama ekranda hiçbir şey değişmiyordu.
 * `draft` yalnız çizim içindir. (Aynı sebeple floor-plan-canvas da `g.last` tutar.)
 */
type Gesture =
  | { kind: "draw"; employeeId: string; anchor: number; moved: boolean; last: Draft }
  | { kind: "move"; shift: TimelineShift; grab: number; moved: boolean; last: Draft }
  | { kind: "resize"; shift: TimelineShift; edge: "start" | "end"; moved: boolean; last: Draft }

/** Sürükleme sayılması için gereken en küçük hareket (dakika). Titrek dokunuş tık sayılsın. */
const DRAG_THRESHOLD = 10

/**
 * Personel adı sütununun genişliği (px). Piksel↔dakika çevrimi buna dayanır.
 *
 * Dışa açık: altındaki kapsama şeridi aynı eksene oturmak zorunda ve kendi
 * sabitini tutsaydı iki grafik birbirine göre kayardı.
 */
export const TIMELINE_NAME_WIDTH = 208
const NAME_W = TIMELINE_NAME_WIDTH

/** Bir saatin en az kaç piksel olacağı — dar ekranda ızgara yatay kayar. */
const HOUR_PX = 58

/**
 * Bar rengi: şablon rengi varsa o (sabahçı/akşamcı ayrımı), yoksa personel
 * sırasına göre — bitişik satırlarda aynı renk iki vardiyayı tek bar gibi
 * gösteriyordu. Palet components/personel/shift-colors.ts'te.
 */

export function VardiyaTimeline({
  employees,
  shifts,
  leaves,
  opening,
  holiday,
  window: win,
  readOnly,
  onCreate,
  onUpdate,
  onOpenShift,
  onOpenOpening,
}: {
  employees: TimelineEmployee[]
  shifts: TimelineShift[]
  leaves: TimelineLeave[]
  opening: OpeningDay | null
  /** O günün tatili; yoksa null. Açılış saati satırının yerine geçer. */
  holiday: { name: string; halfDayFrom: number | null } | null
  window: { from: number; to: number }
  readOnly?: boolean
  onCreate: (draft: Draft) => void
  onUpdate: (shiftId: string, next: { employeeId: string; start: number; end: number }) => void
  onOpenShift: (shift: TimelineShift) => void
  onOpenOpening: () => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const gestureRef = useRef<Gesture | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)

  const span = Math.max(60, win.to - win.from)
  const hours = useMemo(() => {
    const list: number[] = []
    for (let m = Math.ceil(win.from / 60) * 60; m <= win.to; m += 60) list.push(m)
    return list
  }, [win.from, win.to])

  /** Dakika → ızgara içindeki yüzde konum. */
  const pct = useCallback((m: number) => ((m - win.from) / span) * 100, [win.from, span])

  /**
   * İmleç x'i → dakika. Izgara alanı, sarmalayıcının solundan ad sütunu kadar
   * içeride başlar; tüm satırlar aynı düzende olduğu için tek ölçüm yeterli.
   */
  const minuteAt = useCallback(
    (clientX: number) => {
      const box = wrapRef.current?.getBoundingClientRect()
      if (!box) return win.from
      const trackLeft = box.left + NAME_W
      const trackWidth = Math.max(1, box.width - NAME_W)
      const ratio = (clientX - trackLeft) / trackWidth
      return clampMinute(win.from + ratio * span)
    },
    [win.from, span],
  )

  /** İmleç y'si hangi personel satırında — barı başka satıra taşımak için. */
  const employeeAt = useCallback(
    (clientY: number): string | null => {
      for (const [id, el] of rowRefs.current) {
        const r = el.getBoundingClientRect()
        if (clientY >= r.top && clientY <= r.bottom) return id
      }
      return null
    },
    [],
  )

  const capture = (e: React.PointerEvent) => {
    wrapRef.current?.setPointerCapture?.(e.pointerId)
  }

  const beginDraw = (e: React.PointerEvent, employeeId: string) => {
    if (readOnly) return
    // Yalnız boş zemin: barlar kendi jestlerini başlatıp olayı durduruyor.
    if (e.target !== e.currentTarget) return
    e.preventDefault()
    const anchor = snap(minuteAt(e.clientX))
    const first = { employeeId, start: anchor, end: anchor }
    gestureRef.current = { kind: "draw", employeeId, anchor, moved: false, last: first }
    setDraft(first)
    capture(e)
  }

  const beginMove = (e: React.PointerEvent, shift: TimelineShift) => {
    if (readOnly) return
    e.preventDefault()
    e.stopPropagation()
    const first = { employeeId: shift.employeeId, start: shift.plannedStart, end: shift.plannedEnd }
    gestureRef.current = {
      kind: "move",
      shift,
      grab: minuteAt(e.clientX) - shift.plannedStart,
      moved: false,
      last: first,
    }
    setDraft(first)
    capture(e)
  }

  const beginResize = (e: React.PointerEvent, shift: TimelineShift, edge: "start" | "end") => {
    if (readOnly) return
    e.preventDefault()
    e.stopPropagation()
    const first = { employeeId: shift.employeeId, start: shift.plannedStart, end: shift.plannedEnd }
    gestureRef.current = { kind: "resize", shift, edge, moved: false, last: first }
    setDraft(first)
    capture(e)
  }

  /** Jest sonucunu ref'e YAZ, sonra ekrana bas — pointerup ref'ten okur. */
  const apply = (g: Gesture, next: Draft) => {
    g.last = next
    setDraft(next)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gestureRef.current
    if (!g) return
    const m = snap(minuteAt(e.clientX))

    if (g.kind === "draw") {
      if (Math.abs(m - g.anchor) >= DRAG_THRESHOLD) g.moved = true
      apply(g, {
        employeeId: g.employeeId,
        start: Math.min(g.anchor, m),
        end: Math.max(g.anchor, m),
      })
      return
    }

    if (g.kind === "move") {
      const len = g.shift.plannedEnd - g.shift.plannedStart
      const start = clampMinute(snap(m - g.grab))
      if (Math.abs(start - g.shift.plannedStart) >= DRAG_THRESHOLD) g.moved = true
      // Dikey hareket satır (personel) değiştirir; imleç ızgaranın dışındaysa
      // son geçerli satır korunur — kenardan çıkınca bar kaybolmasın.
      const overId = employeeAt(e.clientY)
      if (overId && overId !== g.shift.employeeId) g.moved = true
      apply(g, {
        employeeId: overId ?? g.shift.employeeId,
        start,
        end: start + len,
      })
      return
    }

    const s = g.shift
    if (g.edge === "start") {
      const start = Math.min(m, s.plannedEnd - MIN_SHIFT_MINUTES)
      if (Math.abs(start - s.plannedStart) >= DRAG_THRESHOLD) g.moved = true
      apply(g, { employeeId: s.employeeId, start: clampMinute(start), end: s.plannedEnd })
    } else {
      const end = Math.max(m, s.plannedStart + MIN_SHIFT_MINUTES)
      if (Math.abs(end - s.plannedEnd) >= DRAG_THRESHOLD) g.moved = true
      apply(g, { employeeId: s.employeeId, start: s.plannedStart, end: clampMinute(end) })
    }
  }

  const onPointerUp = () => {
    const g = gestureRef.current
    gestureRef.current = null
    setDraft(null)
    if (!g) return
    // State DEĞİL ref: son pointermove'un setDraft'i bu turda henüz işlenmemiş olabilir.
    const d = g.last

    if (g.kind === "draw") {
      // Sürüklenmediyse ölçü kullanıcının değil, varsayılanın: tek tıkla
      // "buraya vardiya koy", sürükleyerek "şu saatler arası vardiya".
      let start = d.start
      let end = g.moved ? d.end : Math.min(win.to, start + defaultLength(opening))
      // Izgaranın sağ ucuna tıklandığında varsayılan boy sığmaz. Sessizce hiçbir
      // şey yapmak yerine vardiyayı sona yaslıyoruz — tık karşılıksız kalmasın.
      if (!g.moved && end - start < MIN_SHIFT_MINUTES) {
        end = win.to
        start = Math.max(win.from, end - defaultLength(opening))
      }
      if (end - start < MIN_SHIFT_MINUTES) return
      onCreate({ employeeId: d.employeeId, start, end })
      return
    }

    if (!g.moved) {
      // Sürükleme olmadıysa bu bir tıktır: düzenleme penceresi açılır.
      onOpenShift(g.shift)
      return
    }
    onUpdate(g.shift.id, { employeeId: d.employeeId, start: d.start, end: d.end })
  }

  const onPointerCancel = () => {
    gestureRef.current = null
    setDraft(null)
  }

  /**
   * Klavyeyle vardiya düzenleme.
   *
   * Izgara bugüne kadar YALNIZ işaretçiyle çalışıyordu: barlar odaklanamayan
   * `div`lerdi, dolayısıyla klavye kullanan ya da ekran okuyucuyla gezen biri
   * takvimi hiç kullanamıyordu. Jest deseninin karşılığı:
   *
   * - ← →           barı 15 dk kaydırır (Shift ile 1 saat)
   * - Alt + ← →     yalnız BİTİŞİ oynatır, yani süreyi değiştirir (resize)
   * - ↑ ↓           barı önceki/sonraki personel satırına taşır
   * - Enter / Space düzenleme penceresini açar (tıklamanın karşılığı)
   *
   * Adım `SNAP_MINUTES` ile aynı: klavyeyle çizilen plan, sürüklenerek çizilenle
   * aynı ızgaraya oturmalı.
   */
  const onBarKeyDown = (e: React.KeyboardEvent, s: TimelineShift) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      onOpenShift(s)
      return
    }
    if (readOnly) return

    const length = s.plannedEnd - s.plannedStart
    const step = e.shiftKey ? 60 : SNAP_MINUTES

    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault()
      const delta = (e.key === "ArrowLeft" ? -1 : 1) * step
      if (e.altKey) {
        const end = clampMinute(Math.max(s.plannedStart + MIN_SHIFT_MINUTES, s.plannedEnd + delta))
        onUpdate(s.id, { employeeId: s.employeeId, start: s.plannedStart, end })
      } else {
        const start = clampMinute(s.plannedStart + delta)
        onUpdate(s.id, { employeeId: s.employeeId, start, end: start + length })
      }
      return
    }

    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault()
      const index = employees.findIndex((emp) => emp.id === s.employeeId)
      const next = employees[index + (e.key === "ArrowUp" ? -1 : 1)]
      if (!next) return
      onUpdate(s.id, { employeeId: next.id, start: s.plannedStart, end: s.plannedEnd })
    }
  }

  const minWidth = NAME_W + (span / 60) * HOUR_PX
  /**
   * Satır yüksekliği personel sayısına göre esner: dört kişilik bir ekipte sabit
   * 46px'lik satırlar sayfanın altında yarım ekran boşluk bırakıyordu. Kalabalık
   * listede tavan devreye girer, aksi halde ızgara ekrana sığmazdı.
   */
  const rowHeight = employees.length <= 4 ? 84 : employees.length <= 8 ? 62 : 46

  return (
    <div className="overflow-x-auto rounded-xl border border-border/70 bg-card">
      <div
        ref={wrapRef}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        className="relative select-none"
        // pan-y: dikey sayfa kaydırma tarayıcıda kalsın, YATAY jest bize gelsin.
        // touch-none olsaydı ızgara dokunmatikte hiç kaydırılamazdı; serbest
        // bıraksaydık bar sürüklerken sayfa kayardı.
        style={{ minWidth, touchAction: readOnly ? undefined : "pan-y" }}
      >
        {/* Saat cetveli */}
        <div className="flex border-b border-border/70 bg-muted/40">
          <div
            className="sticky left-0 z-20 shrink-0 border-r border-border/70 bg-muted/40 px-3 py-2 text-xs font-semibold text-muted-foreground"
            style={{ width: NAME_W }}
          >
            Personel
          </div>
          <div className="relative flex-1 py-2">
            {hours.map((m, idx) => {
              // İlk ve son etiket ORTALANMAZ, kenara yaslanır: -translate-x-1/2
              // onları yarı yarıya ızgaranın dışına taşırıyordu — soldaki personel
              // sütununun üstüne biniyor, sağdaki ise 16px'lik sahte bir yatay
              // kaydırma çubuğu yaratıyordu (ölçüldü: scrollW-clientW = 16).
              const first = idx === 0
              const last = idx === hours.length - 1
              return (
                <div
                  key={m}
                  className={cn(
                    "absolute top-1 text-[11px] tabular-nums text-muted-foreground",
                    !first && !last && "-translate-x-1/2",
                  )}
                  style={last ? { right: `${100 - pct(m)}%` } : { left: `${pct(m)}%` }}
                >
                  {minuteToHHMM(m)}
                  {crossesMidnight(m) && <span className="ml-0.5 text-[9px] text-amber-600">+1</span>}
                </div>
              )
            })}
            <div className="h-4" />
          </div>
        </div>

        {/* Açılış saati satırı — ekranın referans çizgisi. */}
        <div className="flex border-b border-border/70 bg-muted/20">
          <div
            className="sticky left-0 z-20 flex shrink-0 items-center justify-between gap-2 border-r border-border/70 bg-muted/20 px-3 py-2"
            style={{ width: NAME_W }}
          >
            <span className="text-xs font-semibold">Açılış saati</span>
            <button
              type="button"
              onClick={onOpenOpening}
              className="rounded-full border border-border p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Açılış saatini düzenle"
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>
          <Track pct={pct} hours={hours}>
            {/* Tatil, açılış saatinin YERİNE geçer: tatilde işletme kapalıdır,
                ikisini üst üste çizmek "açık ama tatil" gibi okunurdu. */}
            {holiday ? (
              <div className="absolute inset-y-1 left-0 right-0 flex items-center justify-center rounded-md bg-rose-500/10 px-2 text-[11px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-500/30 dark:text-rose-400">
                <span className="truncate">
                  {holiday.name}
                  {holiday.halfDayFrom != null && (
                    <> · yarım gün ({minuteToHHMM(holiday.halfDayFrom)} sonrası)</>
                  )}
                </span>
              </div>
            ) : opening ? (
              <div
                className="absolute inset-y-1 flex items-center justify-center overflow-hidden rounded-md bg-kobipo-blue/15 px-2 text-[11px] font-semibold text-kobipo-blue ring-1 ring-inset ring-kobipo-blue/30 dark:bg-primary/20 dark:text-primary dark:ring-primary/40"
                style={{ left: `${pct(opening.start)}%`, width: `${pct(opening.end) - pct(opening.start)}%` }}
              >
                <span className="truncate">
                  {minuteToHHMM(opening.start)} – {minuteToHHMM(opening.end)} (
                  {durationLabel(opening.end - opening.start)})
                </span>
              </div>
            ) : (
              <div className="absolute inset-y-0 left-2 flex items-center text-[11px] text-muted-foreground">
                Bu gün kapalı — düzenlemek için <span className="mx-1 font-semibold">+</span>
              </div>
            )}
          </Track>
        </div>

        {/* Personel satırları */}
        {employees.map((emp, i) => {
          const rowShifts = shifts.filter((s) => s.employeeId === emp.id)
          const leave = leaves.find((l) => l.employeeId === emp.id)
          // Taslak (henüz şablonu olmayan yeni bar) personel rengini kullanır.
          const rowColor = barClass(null, i)
          const draftHere = draft?.employeeId === emp.id ? draft : null
          // Sürüklenen bar hangisi: taslak konumu ondan okunacak. "draw" jestinde
          // henüz kayıt yok, o yüzden ayrı tutuluyor.
          const g = gestureRef.current
          const drawing = g?.kind === "draw"
          const active = g && g.kind !== "draw" ? g.shift : null
          return (
            <div
              key={emp.id}
              ref={(el) => {
                if (el) rowRefs.current.set(emp.id, el)
                else rowRefs.current.delete(emp.id)
              }}
              className="flex border-b border-border/50 last:border-b-0"
            >
              <div
                className="sticky left-0 z-20 shrink-0 border-r border-border/70 bg-card px-3 py-2"
                style={{ width: NAME_W }}
              >
                <p className="truncate text-sm font-medium">{emp.name}</p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {emp.position || emp.department || "—"}
                </p>
              </div>
              <Track
                pct={pct}
                hours={hours}
                opening={holiday ? null : opening}
                holiday={holiday}
                height={rowHeight}
              >
                {/* Boş zemin: sürüklenerek yeni vardiya çizilir. */}
                <div
                  className={cn("absolute inset-0", !readOnly && "cursor-crosshair")}
                  onPointerDown={(e) => beginDraw(e, emp.id)}
                />

                {leave && (
                  <div className="pointer-events-none absolute inset-y-1 left-0 right-0 flex items-center justify-center rounded-md bg-amber-500/10 text-[11px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-500/30 dark:text-amber-400">
                    {leave.label}
                  </div>
                )}

                {rowShifts.map((s) => {
                  // Sürüklenen bar taslak konumundan çizilir; kaydedilmiş değeri
                  // ekranda bırakmak barın imleçten geride kalmasına yol açardı.
                  const isDragging = active?.id === s.id && draft != null
                  // Başka satıra taşınıyorsa burada değil, hedef satırda çizilir.
                  if (isDragging && draft.employeeId !== emp.id) return null
                  const start = isDragging ? draft.start : s.plannedStart
                  const end = isDragging ? draft.end : s.plannedEnd
                  // Devamsızlık barı soluklaştırır — takvimdeki TEK istisna durumu.
                  // Fiilî giriş/çıkış katmanı yok: personelin planına uyduğu varsayılır.
                  const absent = s.status === "ABSENT"
                  return (
                    <ShiftBar
                      key={s.id}
                      color={absent ? softBarClass(s.color, i) : barClass(s.color, i)}
                      left={pct(start)}
                      width={pct(end) - pct(start)}
                      label={
                        absent
                          ? `${minuteToHHMM(start)} – ${minuteToHHMM(end)} · Gelmedi`
                          : shiftLabel(start, end, s.breakMinutes)
                      }
                      // Ekran okuyucu barın görsel etiketini değil, KİMİN hangi
                      // saatte çalıştığını okumalı: satırın kime ait olduğu
                      // görsel bağlamdan geliyor ve seste karşılığı yok.
                      ariaLabel={`${emp.name}, ${minuteToHHMM(start)} – ${minuteToHHMM(end)}${
                        absent ? ", gelmedi" : ""
                      }${s.templateName ? `, ${s.templateName}` : ""}`}
                      overnight={crossesMidnight(end)}
                      readOnly={readOnly}
                      muted={absent}
                      onBodyDown={(e) => beginMove(e, s)}
                      onEdgeDown={(e, edge) => beginResize(e, s, edge)}
                      onKeyDown={(e) => onBarKeyDown(e, s)}
                    />
                  )
                })}

                {/* Yeni çizilen ya da başka satırdan taşınan bar. */}
                {draftHere && (drawing || (active != null && active.employeeId !== emp.id)) && (
                  <div
                    className={cn(
                      "pointer-events-none absolute inset-y-1.5 flex items-center justify-center overflow-hidden rounded-md text-[11px] font-semibold opacity-80 ring-2 ring-inset ring-white/40",
                      // Taşınan barın rengi korunur; yeni çizimde personel rengi.
                      active ? barClass(active.color, i) : rowColor,
                    )}
                    style={{
                      left: `${pct(draftHere.start)}%`,
                      width: `${Math.max(0, pct(draftHere.end) - pct(draftHere.start))}%`,
                    }}
                  >
                    <span className="truncate px-1">
                      {minuteToHHMM(draftHere.start)} – {minuteToHHMM(draftHere.end)}
                    </span>
                  </div>
                )}
              </Track>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Bir satırın saat alanı: saat çizgileri + açılış saati gölgesi + içerik. */
function Track({
  pct,
  hours,
  opening,
  holiday,
  height,
  children,
}: {
  pct: (m: number) => number
  hours: number[]
  opening?: OpeningDay | null
  holiday?: { halfDayFrom: number | null } | null
  /** Personel satırlarında esnek; başlık ve açılış satırında sabit. */
  height?: number
  children: React.ReactNode
}) {
  return (
    <div className="relative flex-1" style={{ minHeight: height ?? 46 }}>
      {/* Tatil zemini: yarım günde yalnız tatile düşen KISIM boyanır, sabah
          çalışılan bölüm normal kalsın. */}
      {holiday && (
        <div
          className="pointer-events-none absolute inset-y-0 bg-rose-500/[0.07] dark:bg-rose-400/10"
          style={
            holiday.halfDayFrom != null
              ? { left: `${pct(holiday.halfDayFrom)}%`, right: 0 }
              : { left: 0, right: 0 }
          }
        />
      )}
      {/* Açılış saati gölgesi: "işletme açık ama bu saatte kimse yok" boşluğunu
          görünür kılan şey bu bant — boş satır tek başına bir şey söylemiyor. */}
      {opening && (
        <div
          className="pointer-events-none absolute inset-y-0 bg-kobipo-blue/[0.06] dark:bg-primary/10"
          style={{ left: `${pct(opening.start)}%`, width: `${pct(opening.end) - pct(opening.start)}%` }}
        />
      )}
      {hours.map((m, idx) => (
        <div
          key={m}
          className={cn(
            "pointer-events-none absolute inset-y-0 w-px",
            m % DAY_MINUTES === 0 ? "bg-border" : "bg-border/40",
          )}
          // Son çizgi SAĞA yaslanır: `left:100%` 1px genişliğindeki çizgiyi tamamen
          // dışarı atıp yatay kaydırma çubuğu doğuruyordu.
          style={idx === hours.length - 1 ? { right: 0 } : { left: `${pct(m)}%` }}
        />
      ))}
      {children}
    </div>
  )
}

/** Vardiya barı — gövdesi taşır, iki kenarındaki tutamaç mesai saatini değiştirir. */
function ShiftBar({
  color,
  left,
  width,
  label,
  ariaLabel,
  overnight,
  readOnly,
  muted,
  onBodyDown,
  onEdgeDown,
  onKeyDown,
}: {
  color: string
  left: number
  width: number
  label: string
  ariaLabel: string
  overnight: boolean
  readOnly?: boolean
  /** Devamsızlık: bar soluklaşır, "çalışılmadı" okunur olur. */
  muted?: boolean
  onBodyDown: (e: React.PointerEvent) => void
  onEdgeDown: (e: React.PointerEvent, edge: "start" | "end") => void
  onKeyDown: (e: React.KeyboardEvent) => void
}) {
  return (
    <div
      onPointerDown={onBodyDown}
      onKeyDown={onKeyDown}
      // Odaklanabilir ve düğme rolünde: bar bir `div` olarak kaldığı sürece
      // klavye kullanıcısı takvimi hiç çalıştıramıyordu. `tabIndex` salt okunur
      // görünümde de duruyor — okumak da erişilebilirliğin parçası.
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      className={cn(
        "absolute inset-y-1.5 flex items-center justify-center overflow-hidden rounded-md px-2 shadow-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-1",
        !readOnly && "cursor-grab active:cursor-grabbing",
        muted && "opacity-60 saturate-50",
        color,
      )}
      style={{ left: `${left}%`, width: `${Math.max(0, width)}%` }}
    >
      <span className="truncate text-[11px] font-semibold">
        {label}
        {overnight && <span className="ml-1 opacity-80">+1 gün</span>}
      </span>
      {!readOnly && (
        <>
          <span
            role="presentation"
            onPointerDown={(e) => onEdgeDown(e, "start")}
            className="absolute inset-y-0 left-0 w-2 cursor-ew-resize rounded-l-md bg-black/15 hover:bg-black/30"
          />
          <span
            role="presentation"
            onPointerDown={(e) => onEdgeDown(e, "end")}
            className="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r-md bg-black/15 hover:bg-black/30"
          />
        </>
      )}
    </div>
  )
}

/** Tek tıkla açılan vardiyanın uzunluğu: işletmenin günlük açık süresi, yoksa 8 saat. */
function defaultLength(opening: OpeningDay | null) {
  if (!opening) return 8 * 60
  return Math.max(MIN_SHIFT_MINUTES, netMinutes(opening.start, opening.end))
}
