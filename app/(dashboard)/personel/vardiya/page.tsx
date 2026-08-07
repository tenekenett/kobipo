"use client"

/**
 * Vardiya Takvimi — gün ve hafta görünümü.
 *
 * Veri katmanı burada, etkileşim components/personel/* altında. Sürükleme
 * sonuçları ÖNCE yerel duruma yazılır, sonra API'ye gider: ağ gecikmesi boyunca
 * barın imleçten geri sıçraması jesti kullanılamaz hale getiriyordu. İstek
 * başarısızsa önceki liste geri yüklenir ve sebep toast ile söylenir.
 *
 * Gün ve hafta AYNI veriyi çeker (hafta görünümünde aralık yedi güne açılır),
 * böylece görünüm değiştirmek yeniden yükleme beklemeden çalışır.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { cn } from "@/lib/utils"
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CopyPlus,
  LayoutGrid,
  Loader2,
  PartyPopper,
  Users,
  Wand2,
} from "lucide-react"
import { VardiyaTimeline, type TimelineLeave } from "@/components/personel/vardiya-timeline"
import { VardiyaHafta, type WeekShift } from "@/components/personel/vardiya-hafta"
import { VardiyaDialog, type ShiftDraft } from "@/components/personel/vardiya-dialog"
import { AcilisSaatiDialog } from "@/components/personel/acilis-saati-dialog"
import { SablonDialog, type ShiftTemplate } from "@/components/personel/sablon-dialog"
import { TopluDoldurDialog } from "@/components/personel/toplu-doldur-dialog"
import { TatilDialog } from "@/components/personel/tatil-dialog"
import {
  actualNetMinutes,
  durationLabel,
  dayTitle,
  netMinutes,
  shiftDayIso,
  todayIso,
  weekDaysIso,
  weekStartIso,
  weekdayOf,
} from "@/lib/personel/vardiya"
import { gridWindow, openingOfDay, type OpeningHours } from "@/lib/personel/opening-hours"
import { holidayMap, holidayOn, type Holiday } from "@/lib/personel/tatil"

type Employee = {
  id: string
  firstName: string
  lastName: string
  department?: string | null
  position?: string | null
  status: string
}

type Shift = WeekShift & {
  note?: string | null
  actualStart?: number | null
  actualEnd?: number | null
  status?: string
}

type Leave = {
  employee: { id: string }
  type: string
  startDate: string
  endDate: string
  status: string
}

type View = "gun" | "hafta"

const LEAVE_LABELS: Record<string, string> = {
  ANNUAL: "Yıllık izinli",
  EXCUSE: "Mazeret izni",
  SICK: "Raporlu",
  UNPAID: "Ücretsiz izinli",
}

export default function VardiyaPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const { confirm } = useConfirm()

  const [view, setView] = useState<View>("gun")
  const [day, setDay] = useState(todayIso())
  const [employees, setEmployees] = useState<Employee[]>([])
  const [shifts, setShifts] = useState<Shift[]>([])
  const [leaves, setLeaves] = useState<Leave[]>([])
  const [opening, setOpening] = useState<OpeningHours | null>(null)
  const [templates, setTemplates] = useState<ShiftTemplate[]>([])
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [draft, setDraft] = useState<ShiftDraft | null>(null)
  const [openingOpen, setOpeningOpen] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [fillOpen, setFillOpen] = useState(false)
  const [tatilOpen, setTatilOpen] = useState(false)

  const weekStart = useMemo(() => weekStartIso(day), [day])
  const weekDays = useMemo(() => weekDaysIso(weekStart), [weekStart])
  // Hafta görünümünde tüm hafta çekilir; gün görünümünde de aynı aralık kullanılır
  // ki görünüm değiştirince veri hazır olsun (yedi günlük sorgu zaten ucuz).
  const range = { from: weekDays[0], to: weekDays[6] }

  const fail = useCallback(
    async (res: Response, fallback: string) => {
      const data = await res.json().catch(() => ({}))
      toast({ title: fallback, description: data.error || undefined, variant: "destructive" })
    },
    [toast],
  )

  const loadShifts = useCallback(async () => {
    if (!companyId) return
    const res = await fetch(
      `/api/personel/shifts?companyId=${companyId}&from=${range.from}&to=${range.to}`,
    )
    if (res.ok) setShifts(await res.json())
  }, [companyId, range.from, range.to])

  const load = useCallback(async () => {
    if (!companyId) return
    setIsLoading(true)
    try {
      const [empRes, shiftRes, leaveRes, openRes, tplRes, holRes] = await Promise.all([
        fetch(`/api/personel/employees?companyId=${companyId}&status=ACTIVE`),
        fetch(`/api/personel/shifts?companyId=${companyId}&from=${range.from}&to=${range.to}`),
        fetch(`/api/personel/leaves?companyId=${companyId}&status=APPROVED`),
        fetch(`/api/personel/opening-hours?companyId=${companyId}`),
        fetch(`/api/personel/shift-templates?companyId=${companyId}`),
        fetch(`/api/personel/holidays?companyId=${companyId}`),
      ])
      if (empRes.ok) setEmployees(await empRes.json())
      if (shiftRes.ok) setShifts(await shiftRes.json())
      if (leaveRes.ok) setLeaves(await leaveRes.json())
      if (openRes.ok) setOpening((await openRes.json()).openingHours)
      if (tplRes.ok) setTemplates(await tplRes.json())
      if (holRes.ok) setHolidays(await holRes.json())
    } finally {
      setIsLoading(false)
    }
  }, [companyId, range.from, range.to])

  useEffect(() => {
    load()
  }, [load])

  const dayShifts = useMemo(() => shifts.filter((s) => s.workDate === day), [shifts, day])
  const openingToday = useMemo(() => openingOfDay(opening, weekdayOf(day)), [opening, day])
  const holidayToday = useMemo(() => holidayOn(holidays, day), [holidays, day])
  const weekHolidays = useMemo(
    () => new Map([...holidayMap(holidays, weekDays)].map(([d, h]) => [d, h.name])),
    [holidays, weekDays],
  )
  const win = useMemo(() => gridWindow(opening, weekdayOf(day), dayShifts), [opening, day, dayShifts])

  const rows = useMemo(
    () =>
      employees.map((e) => ({
        id: e.id,
        name: `${e.firstName} ${e.lastName}`.trim(),
        department: e.department,
        position: e.position,
      })),
    [employees],
  )

  /** "employeeId|gün" → izin etiketi; iki görünüm de buradan okur. */
  const leaveMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const l of leaves) {
      const from = l.startDate.slice(0, 10)
      const to = l.endDate.slice(0, 10)
      for (const d of weekDays) {
        if (from <= d && d <= to) map.set(`${l.employee.id}|${d}`, LEAVE_LABELS[l.type] || "İzinli")
      }
    }
    return map
  }, [leaves, weekDays])

  const dayLeaves: TimelineLeave[] = useMemo(
    () =>
      rows
        .map((r) => ({ employeeId: r.id, label: leaveMap.get(`${r.id}|${day}`) ?? "" }))
        .filter((l) => l.label),
    [rows, leaveMap, day],
  )

  const visible = view === "gun" ? dayShifts : shifts
  const totalMinutes = visible.reduce(
    (sum, s) => sum + netMinutes(s.plannedStart, s.plannedEnd, s.breakMinutes),
    0,
  )
  // Fiilî toplam yalnız iki ucu da damgalanmış vardiyalardan gelir; yarım damgayı
  // saymak "eksik çalıştı" izlenimi verirdi.
  const actualMinutes = visible.reduce((sum, s) => sum + (actualNetMinutes(s) ?? 0), 0)
  const stampedCount = visible.filter((s) => actualNetMinutes(s) != null).length
  const absentCount = visible.filter((s) => s.status === "ABSENT").length

  // ---- Yazma ----------------------------------------------------------------

  async function createShift(
    next: { employeeId: string; start: number; end: number },
    workDate = day,
    breakMinutes = 0,
    note = "",
  ) {
    if (!companyId) return false
    const res = await fetch("/api/personel/shifts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId,
        employeeId: next.employeeId,
        workDate,
        plannedStart: next.start,
        plannedEnd: next.end,
        breakMinutes,
        note,
      }),
    })
    if (!res.ok) {
      await fail(res, "Vardiya eklenemedi")
      return false
    }
    const created = await res.json()
    setShifts((prev) => [...prev, created])
    return true
  }

  /** Sürükleme sonucu: önce yerel, sonra sunucu; hata olursa geri al. */
  async function moveShift(id: string, next: { employeeId: string; start: number; end: number }) {
    if (!companyId) return
    const before = shifts
    setShifts((prev) =>
      prev.map((s) =>
        s.id === id
          ? { ...s, employeeId: next.employeeId, plannedStart: next.start, plannedEnd: next.end }
          : s,
      ),
    )
    const res = await fetch(`/api/personel/shifts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId,
        employeeId: next.employeeId,
        plannedStart: next.start,
        plannedEnd: next.end,
      }),
    })
    if (!res.ok) {
      setShifts(before)
      await fail(res, "Vardiya güncellenemedi")
      return
    }
    const saved = await res.json()
    setShifts((prev) => prev.map((s) => (s.id === id ? saved : s)))
  }

  async function saveDraft(next: ShiftDraft) {
    if (!companyId) return
    setIsSaving(true)
    try {
      if (!next.id) {
        const ok = await createShift(
          { employeeId: next.employeeId, start: next.start, end: next.end },
          next.workDate ?? day,
          next.breakMinutes,
          next.note,
        )
        if (ok) setDraft(null)
        return
      }
      const res = await fetch(`/api/personel/shifts/${next.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          plannedStart: next.start,
          plannedEnd: next.end,
          actualStart: next.actualStart ?? null,
          actualEnd: next.actualEnd ?? null,
          absent: next.absent === true,
          breakMinutes: next.breakMinutes,
          note: next.note,
        }),
      })
      if (!res.ok) {
        await fail(res, "Vardiya güncellenemedi")
        return
      }
      const saved = await res.json()
      setShifts((prev) => prev.map((s) => (s.id === next.id ? saved : s)))
      setDraft(null)
    } finally {
      setIsSaving(false)
    }
  }

  /**
   * Anlık damga. Dakika İSTEMCİDEN gider: sunucu üretimde UTC'de çalışıyor,
   * "şimdi"yi orada okumak damgayı üç saat geri kaydırırdı.
   */
  async function clockShift(id: string, action: "in" | "out", minute: number) {
    if (!companyId) return
    setIsSaving(true)
    try {
      const res = await fetch(`/api/personel/shifts/${id}/clock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, action, minute }),
      })
      if (!res.ok) {
        await fail(res, "Damga kaydedilemedi")
        return
      }
      const saved: Shift = await res.json()
      setShifts((prev) => prev.map((x) => (x.id === id ? saved : x)))
      // Açık pencere de damgayı görsün; aksi halde Kaydet eski değeri geri yazar.
      setDraft((prev) =>
        prev && prev.id === id
          ? { ...prev, actualStart: saved.actualStart ?? null, actualEnd: saved.actualEnd ?? null }
          : prev,
      )
    } finally {
      setIsSaving(false)
    }
  }

  async function removeShift(id: string) {
    if (!companyId) return
    if (
      !(await confirm({
        title: "Vardiya silinsin mi?",
        description: "Bu personelin bu gündeki vardiyası takvimden kaldırılacak.",
        variant: "destructive",
      }))
    )
      return
    setIsSaving(true)
    try {
      const res = await fetch(`/api/personel/shifts/${id}?companyId=${companyId}`, { method: "DELETE" })
      if (!res.ok) {
        await fail(res, "Vardiya silinemedi")
        return
      }
      setShifts((prev) => prev.filter((s) => s.id !== id))
      setDraft(null)
    } finally {
      setIsSaving(false)
    }
  }

  async function saveOpening(next: OpeningHours) {
    if (!companyId) return
    setIsSaving(true)
    try {
      const res = await fetch("/api/personel/opening-hours", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, openingHours: next }),
      })
      if (!res.ok) {
        await fail(res, "Açılış saati kaydedilemedi")
        return
      }
      setOpening((await res.json()).openingHours)
      setOpeningOpen(false)
    } finally {
      setIsSaving(false)
    }
  }

  async function createTemplate(t: {
    name: string
    startMinute: number
    endMinute: number
    breakMinutes: number
    color: string
  }) {
    if (!companyId) return
    setIsSaving(true)
    try {
      const res = await fetch("/api/personel/shift-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...t, companyId }),
      })
      if (!res.ok) {
        await fail(res, "Şablon eklenemedi")
        return
      }
      const created = await res.json()
      setTemplates((prev) =>
        [...prev, created].sort((a, b) => a.startMinute - b.startMinute),
      )
    } finally {
      setIsSaving(false)
    }
  }

  async function removeTemplate(id: string) {
    if (!companyId) return
    setIsSaving(true)
    try {
      const res = await fetch(`/api/personel/shift-templates/${id}?companyId=${companyId}`, {
        method: "DELETE",
      })
      if (!res.ok) {
        await fail(res, "Şablon kaldırılamadı")
        return
      }
      setTemplates((prev) => prev.filter((t) => t.id !== id))
    } finally {
      setIsSaving(false)
    }
  }

  /** Toplu doldurma ve kopyalama aynı ucu kullanır; ikisi de sonucu sayıyla bildirir. */
  async function runBulk(body: Record<string, unknown>, emptyMessage: string) {
    if (!companyId) return
    setIsSaving(true)
    try {
      const res = await fetch("/api/personel/shifts/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, companyId }),
      })
      if (!res.ok) {
        await fail(res, "İşlem tamamlanamadı")
        return
      }
      const { created, skipped } = await res.json()
      await loadShifts()
      toast({
        title: created > 0 ? `${created} vardiya açıldı` : emptyMessage,
        description: skipped > 0 ? `${skipped} kayıt çakıştığı için atlandı.` : undefined,
      })
      setFillOpen(false)
    } finally {
      setIsSaving(false)
    }
  }

  async function createHoliday(h: {
    name: string
    date: string
    recurring: boolean
    halfDayFrom: number | null
  }) {
    if (!companyId) return
    setIsSaving(true)
    try {
      const res = await fetch("/api/personel/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...h, companyId }),
      })
      if (!res.ok) {
        await fail(res, "Tatil eklenemedi")
        return
      }
      const created = await res.json()
      setHolidays((prev) => [...prev, created])
    } finally {
      setIsSaving(false)
    }
  }

  async function removeHoliday(id: string) {
    if (!companyId) return
    setIsSaving(true)
    try {
      const res = await fetch(`/api/personel/holidays/${id}?companyId=${companyId}`, {
        method: "DELETE",
      })
      if (!res.ok) {
        await fail(res, "Tatil kaldırılamadı")
        return
      }
      setHolidays((prev) => prev.filter((h) => h.id !== id))
    } finally {
      setIsSaving(false)
    }
  }

  /** Sabit tarihli resmî tatilleri toplu ekler; kayan bayramlar elle girilir. */
  async function seedHolidays(seedYear: number) {
    if (!companyId) return
    setIsSaving(true)
    try {
      const res = await fetch("/api/personel/holidays", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, seedYear }),
      })
      if (!res.ok) {
        await fail(res, "Resmî tatiller eklenemedi")
        return
      }
      const { created, message } = await res.json()
      const list = await fetch(`/api/personel/holidays?companyId=${companyId}`)
      if (list.ok) setHolidays(await list.json())
      toast({ title: created > 0 ? `${created} tatil eklendi` : message || "Değişiklik yok" })
    } finally {
      setIsSaving(false)
    }
  }

  // ---- Ekran ----------------------------------------------------------------

  if (!companyId) {
    return <p className="p-4 text-muted-foreground">Firma seçili değil.</p>
  }

  const step = view === "gun" ? 1 : 7

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <CalendarClock className="h-6 w-6 text-muted-foreground" />
            Vardiya Takvimi
          </h1>
          <p className="text-sm text-muted-foreground">
            {view === "gun"
              ? "Boş satırda sürükleyerek vardiya çizin; barı taşıyın ya da kenarından tutup mesai saatini değiştirin."
              : "Haftanın kapsamı: boş hücrelere tıklayarak vardiya ekleyin, saat ayarı için gün görünümüne geçin."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-full bg-muted p-0.5">
            {(["gun", "hafta"] as View[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                  view === v
                    ? "bg-kobipo-blue text-white dark:bg-primary dark:text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {v === "gun" ? "Gün" : "Hafta"}
              </button>
            ))}
          </div>
          <Button variant="outline" size="icon" onClick={() => setDay((d) => shiftDayIso(d, -step))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Input
            type="date"
            value={day}
            onChange={(e) => e.target.value && setDay(e.target.value)}
            className="h-10 w-40"
          />
          <Button variant="outline" size="icon" onClick={() => setDay((d) => shiftDayIso(d, step))}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" onClick={() => setDay(todayIso())}>
            Bugün
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold">
          {view === "gun" ? dayTitle(day) : `${weekDays[0]} – ${weekDays[6]}`}
        </span>
        <span className="text-sm text-muted-foreground">
          {visible.length} vardiya · plan {durationLabel(totalMinutes)}
          {stampedCount > 0 && <> · fiilî {durationLabel(actualMinutes)}</>}
        </span>
        {absentCount > 0 && (
          <span className="text-sm text-red-600 dark:text-red-400">{absentCount} devamsızlık</span>
        )}
        {view === "gun" && holidayToday && (
          <span className="text-sm font-medium text-rose-600 dark:text-rose-400">
            {holidayToday.name}
          </span>
        )}
        {view === "gun" && !openingToday && !holidayToday && (
          <span className="text-sm text-amber-600 dark:text-amber-400">
            Bu gün için açılış saati tanımlı değil
          </span>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setFillOpen(true)}>
            <Wand2 className="mr-1 h-4 w-4" /> Şablondan doldur
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              runBulk(
                {
                  mode: "copy",
                  fromDay: shiftDayIso(weekStart, -7),
                  toDay: weekStart,
                  dayCount: 7,
                },
                "Geçen hafta boştu — kopyalanacak vardiya yok",
              )
            }
            disabled={isSaving}
          >
            <CopyPlus className="mr-1 h-4 w-4" /> Geçen haftayı kopyala
          </Button>
          <Button variant="outline" size="sm" onClick={() => setTemplatesOpen(true)}>
            <LayoutGrid className="mr-1 h-4 w-4" /> Şablonlar
          </Button>
          <Button variant="outline" size="sm" onClick={() => setTatilOpen(true)}>
            <PartyPopper className="mr-1 h-4 w-4" /> Tatiller
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center p-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Takvim yükleniyor...
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground">
          <Users className="h-8 w-8" />
          <p>Aktif personel yok. Önce Personeller ekranından personel ekleyin.</p>
        </div>
      ) : view === "gun" ? (
        <VardiyaTimeline
          employees={rows}
          shifts={dayShifts}
          leaves={dayLeaves}
          opening={openingToday}
          holiday={holidayToday}
          window={win}
          onCreate={(d) => createShift(d)}
          onUpdate={moveShift}
          onOpenShift={(s) => openEditor(s.id)}
          onOpenOpening={() => setOpeningOpen(true)}
        />
      ) : (
        <VardiyaHafta
          days={weekDays}
          employees={rows}
          shifts={shifts}
          leaveDays={leaveMap}
          holidays={weekHolidays}
          today={todayIso()}
          onOpenShift={(s) => openEditor(s.id)}
          onAddShift={(employeeId, d) => {
            const emp = rows.find((r) => r.id === employeeId)
            const t = templates[0]
            const open = openingOfDay(opening, weekdayOf(d))
            setDraft({
              employeeId,
              employeeName: emp?.name || "",
              workDate: d,
              // Varsayılan saat: ilk şablon → o günün açılış saati → 09:00-17:00.
              start: t?.startMinute ?? open?.start ?? 9 * 60,
              end: t?.endMinute ?? open?.end ?? 17 * 60,
              breakMinutes: t?.breakMinutes ?? 0,
              note: "",
            })
          }}
        />
      )}

      <VardiyaDialog
        draft={draft}
        isSaving={isSaving}
        onClose={() => setDraft(null)}
        onSave={saveDraft}
        onDelete={removeShift}
        onClock={clockShift}
      />
      <AcilisSaatiDialog
        open={openingOpen}
        value={opening}
        isSaving={isSaving}
        onClose={() => setOpeningOpen(false)}
        onSave={saveOpening}
      />
      <SablonDialog
        open={templatesOpen}
        templates={templates}
        isSaving={isSaving}
        onClose={() => setTemplatesOpen(false)}
        onCreate={createTemplate}
        onDelete={removeTemplate}
      />
      <TatilDialog
        open={tatilOpen}
        holidays={holidays}
        isSaving={isSaving}
        onClose={() => setTatilOpen(false)}
        onCreate={createHoliday}
        onDelete={removeHoliday}
        onSeed={seedHolidays}
      />
      <TopluDoldurDialog
        open={fillOpen}
        templates={templates}
        employees={rows.map((r) => ({ id: r.id, name: r.name }))}
        days={view === "gun" ? [day] : weekDays}
        isSaving={isSaving}
        onClose={() => setFillOpen(false)}
        onApply={({ templateId, employeeIds, days }) =>
          runBulk({ mode: "template", templateId, employeeIds, days }, "Tüm günlerde zaten vardiya var")
        }
        onManageTemplates={() => {
          setFillOpen(false)
          setTemplatesOpen(true)
        }}
      />
    </div>
  )

  /** İki görünüm de aynı düzenleyiciyi açar; kayıt listeden id ile bulunur. */
  function openEditor(id: string) {
    const s = shifts.find((x) => x.id === id)
    if (!s) return
    const emp = rows.find((r) => r.id === s.employeeId)
    setDraft({
      id: s.id,
      employeeId: s.employeeId,
      employeeName: emp?.name || "",
      workDate: s.workDate,
      start: s.plannedStart,
      end: s.plannedEnd,
      actualStart: s.actualStart ?? null,
      actualEnd: s.actualEnd ?? null,
      absent: s.status === "ABSENT",
      breakMinutes: s.breakMinutes,
      note: s.note || "",
    })
  }
}
