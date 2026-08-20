"use client"

/**
 * Vardiya Takvimi — gün ve hafta görünümü.
 *
 * Veri katmanı burada, etkileşim components/personel/* altında. Sürükleme
 * sonuçları ÖNCE yerel duruma yazılır, sonra API'ye gider: ağ gecikmesi boyunca
 * barın imleçten geri sıçraması jesti kullanılamaz hale getiriyordu. İstek
 * başarısızsa önceki liste geri yüklenir ve sebep toast ile söylenir.
 *
 * Gün ve hafta AYNI veriyi çeker (her iki görünümde de haftanın tamamı),
 * böylece görünüm değiştirmek yeniden yükleme beklemeden çalışır.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { WriteAction, useWriteGuard } from "@/components/dashboard/write-guard"
import { cn } from "@/lib/utils"
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CopyPlus,
  Eraser,
  LayoutGrid,
  Loader2,
  PartyPopper,
  Send,
  Undo2,
  Users,
  Wand2,
} from "lucide-react"
import { CompanyLink } from "@/components/dashboard/company-link"
import { ExportButton } from "@/components/export/export-button"
import {
  TIMELINE_NAME_WIDTH,
  VardiyaTimeline,
  type TimelineLeave,
} from "@/components/personel/vardiya-timeline"
import { VardiyaKapsama, type DemandHour } from "@/components/personel/vardiya-kapsama"
import { VardiyaMobil } from "@/components/personel/vardiya-mobil"
import { VardiyaHafta, type WeekShift } from "@/components/personel/vardiya-hafta"
import { VardiyaDialog, type ShiftDraft } from "@/components/personel/vardiya-dialog"
import { AcilisSaatiDialog } from "@/components/personel/acilis-saati-dialog"
import { SablonDialog, type ShiftTemplate } from "@/components/personel/sablon-dialog"
import { TopluDoldurDialog } from "@/components/personel/toplu-doldur-dialog"
import { TatilDialog } from "@/components/personel/tatil-dialog"
import { YayinlaDialog } from "@/components/personel/yayinla-dialog"
import {
  durationLabel,
  dayTitle,
  minuteToHHMM,
  netMinutes,
  shiftDayIso,
  todayIso,
  weekDaysIso,
  weekRangeLabel,
  weekStartIso,
  weekdayOf,
} from "@/lib/personel/vardiya"
import { gridWindow, openingOfDay, type OpeningHours } from "@/lib/personel/opening-hours"
import { holidayMap, holidayOn, type Holiday } from "@/lib/personel/tatil"
import { laborWarnings, type LaborWarning } from "@/lib/personel/is-kanunu"
import { HOURLY_BASIS_LABEL, laborCost } from "@/lib/personel/maliyet"
import {
  useCompanyHolidays,
  useOpeningHours,
  useShiftTemplates,
} from "@/lib/swr/use-company-data"
import { money } from "@/lib/format"

type Employee = {
  id: string
  firstName: string
  lastName: string
  department?: string | null
  position?: string | null
  status: string
  /** Yayın penceresi "kime ulaşılamayacak"ı buradan sayar. */
  email?: string | null
  /** Prisma Decimal JSON'da string gelir; maliyet hesabından önce sayıya çevrilir. */
  grossSalary?: number | string | null
}

/** Haftanın yayın kaydı; hiç yayınlanmadıysa null. */
type Publication = { publishedAt: string; notifiedCount: number; shiftCount: number }

/**
 * Geri alınabilir bir işlem.
 *
 * `move` barın eski konumunu taşır; `create` geri alınırken kayıt silinir;
 * `delete` geri alınırken YENİDEN OLUŞTURULUR — id değişir, çünkü silinen satır
 * gerçekten gitmiştir. Kullanıcı açısından fark yok: aynı personelin aynı
 * saatteki vardiyası geri gelir.
 */
type UndoEntry =
  | { kind: "move"; id: string; employeeId: string; start: number; end: number; label: string }
  | { kind: "create"; id: string; label: string }
  | {
      kind: "delete"
      shift: {
        employeeId: string
        workDate: string
        plannedStart: number
        plannedEnd: number
        breakMinutes: number
        note: string | null
      }
      label: string
    }

/** Yığın derinliği. Yirmi adım, bir planlama oturumunun tamamını kapsar. */
const UNDO_LIMIT = 20

type Shift = WeekShift & {
  note?: string | null
  status?: string
  updatedAt?: string | null
  updatedByName?: string | null
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
  // Bu ekranın yazma yolu çoğunlukla DÜĞME DEĞİL: ızgarada sürükleyerek vardiya
  // çizmek, barı taşımak, boş hücreye tıklamak. Kapı bu yüzden jestin bittiği
  // yerde, yazma fonksiyonlarının başında duruyor.
  const { canWrite, refuse } = useWriteGuard()

  const [view, setView] = useState<View>("gun")
  const [day, setDay] = useState(todayIso())
  const [employees, setEmployees] = useState<Employee[]>([])
  // Çekilen aralık haftadan bir gün geniş (aşağıya bkz.); ekrana çizilen liste
  // `shifts`, komşu günler yalnız dinlenme denetiminde kullanılıyor.
  const [allShifts, setAllShifts] = useState<Shift[]>([])
  const [leaves, setLeaves] = useState<Leave[]>([])
  /**
   * Referans veriler SWR'den: şablon/tatil/açılış saati haftalarca değişmez ama
   * takvim her hafta değişiminde üçünü de yeniden çekiyordu. `mutate` yazma
   * işlemlerinden sonra önbelleği tazeler.
   */
  const { openingHours: opening, isLoading: openingLoading, mutate: mutateOpening } =
    useOpeningHours(companyId)
  const { templates, isLoading: templatesLoading, mutate: mutateTemplates } =
    useShiftTemplates(companyId)
  const { holidays, isLoading: holidaysLoading, mutate: mutateHolidays } =
    useCompanyHolidays(companyId)
  const [isLoadingData, setIsLoadingData] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [draft, setDraft] = useState<ShiftDraft | null>(null)
  const [openingOpen, setOpeningOpen] = useState(false)
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [fillOpen, setFillOpen] = useState(false)
  const [tatilOpen, setTatilOpen] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [publication, setPublication] = useState<Publication | null>(null)
  const [demand, setDemand] = useState<{ hours: DemandHour[]; sampleDays: number } | null>(null)
  /**
   * Geri alma yığını — TERS İŞLEMLER olarak tutulur, durum anlık görüntüsü olarak değil.
   *
   * Anlık görüntü geri yüklemek yerel ekranı düzeltir ama SUNUCUYU düzeltmez:
   * kullanıcı Ctrl+Z'den sonra sayfayı yenilediğinde geri aldığı değişiklik geri
   * gelirdi. Ters işlem ise aynı uçlardan geçtiği için kalıcı — ve tek tek
   * uygulandığı için çakışma/izin denetimleri de aynı şekilde çalışır.
   */
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([])

  const weekStart = useMemo(() => weekStartIso(day), [day])
  const weekDays = useMemo(() => weekDaysIso(weekStart), [weekStart])
  // Hafta görünümünde tüm hafta çekilir; gün görünümünde de aynı aralık kullanılır
  // ki görünüm değiştirince veri hazır olsun (yedi günlük sorgu zaten ucuz).
  //
  // Aralık haftanın BİR GÜN ÖNCESİNDEN BİR GÜN SONRASINA kadar: iki vardiya arası
  // 11 saat dinlenme kuralı hafta sınırını aşıyor (Pazar 22:00–02:00'den sonra
  // Pazartesi 08:00 vardiyası bir sonraki haftadadır). Komşu günler ekrana
  // ÇİZİLMEZ, yalnız uyarı hesabına girer.
  const range = { from: shiftDayIso(weekDays[0], -1), to: shiftDayIso(weekDays[6], 1) }

  const fail = useCallback(
    async (res: Response, fallback: string) => {
      const data = await res.json().catch(() => ({}))
      toast({ title: fallback, description: data.error || undefined, variant: "destructive" })
    },
    [toast],
  )

  /**
   * İzin/tatil uyarısında kullanıcıya sorup isteği `force` ile tekrarlar.
   *
   * Sunucu izinli personele ya da tatile denk gelen vardiyayı 409 ile geri
   * çevirir; bunlar yasak değil "emin misin"dir (izinli personel çağrılabilir,
   * bayramda çalışan işletme çoktur). Çakışma — `code: "CONFLICT"` — sorulmaz,
   * o gerçekten aşılamaz. Yanıtı `clone()` ile okuyoruz ki hata yoluna düşerse
   * `fail` gövdeyi bir kez daha okuyabilsin.
   */
  const sendWithForce = useCallback(
    async (send: (force: boolean) => Promise<Response>, fallback: string): Promise<Response | null> => {
      let res = await send(false)
      if (res.status === 409) {
        const data = await res.clone().json().catch(() => ({}))
        if (data.code === "LEAVE" || data.code === "HOLIDAY") {
          const ok = await confirm({
            title: data.error || "Bu güne vardiya yazılacak",
            description: "Yine de bu vardiya açılsın mı?",
            confirmLabel: "Yine de aç",
          })
          if (!ok) return null
          res = await send(true)
        }
      }
      if (!res.ok) {
        await fail(res, fallback)
        return null
      }
      return res
    },
    [confirm, fail],
  )

  const loadShifts = useCallback(async () => {
    if (!companyId) return
    const res = await fetch(
      `/api/personel/shifts?companyId=${companyId}&from=${range.from}&to=${range.to}`,
    )
    if (res.ok) setAllShifts(await res.json())
  }, [companyId, range.from, range.to])

  const load = useCallback(async () => {
    if (!companyId) return
    setIsLoadingData(true)
    try {
      // Referans veriler (şablon/tatil/açılış) burada YOK — onlar SWR'de ve
      // hafta değişiminde yeniden çekilmiyor. Burada kalanlar aralığa bağlı.
      const [empRes, shiftRes, leaveRes, pubRes] = await Promise.all([
        fetch(`/api/personel/employees?companyId=${companyId}&status=ACTIVE`),
        fetch(`/api/personel/shifts?companyId=${companyId}&from=${range.from}&to=${range.to}`),
        // İzinler de yalnız görünen aralıktan: süzgeçsiz istek firmanın bütün
        // geçmiş izinlerini getiriyordu ve takvim yıllar içinde ağırlaşıyordu.
        fetch(
          `/api/personel/leaves?companyId=${companyId}&status=APPROVED&from=${range.from}&to=${range.to}`,
        ),
        fetch(`/api/personel/shifts/publish?companyId=${companyId}&weekStart=${weekStart}`),
      ])
      if (empRes.ok) setEmployees(await empRes.json())
      if (shiftRes.ok) setAllShifts(await shiftRes.json())
      if (leaveRes.ok) setLeaves(await leaveRes.json())
      if (pubRes.ok) setPublication(await pubRes.json())
    } finally {
      setIsLoadingData(false)
    }
  }, [companyId, range.from, range.to, weekStart])

  useEffect(() => {
    load()
  }, [load])

  /**
   * Talep profili GÜNE bağlı (her hafta gününün kendi yoğunluk eğrisi var), o
   * yüzden ana yüklemeden ayrı: gün değiştikçe yalnız bu istek tekrarlanır.
   * Restoran modülü kapalıysa uç boş döner ve şerit sessizce çizilmez.
   */
  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    fetch(`/api/personel/shifts/talep?companyId=${companyId}&weekday=${weekdayOf(day)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.enabled) return setDemand(null)
        setDemand({ hours: data.hours ?? [], sampleDays: data.sampleDays ?? 0 })
      })
      .catch(() => setDemand(null))
    return () => {
      cancelled = true
    }
  }, [companyId, day])

  /**
   * Ekranın gördüğü liste: yalnız haftanın kendi günleri.
   *
   * Toplamlar, maliyet ve hafta ızgarası bundan beslenir — komşu günler karışsaydı
   * "haftalık plan" bir gün fazlasını sayardı.
   */
  const shifts = useMemo(
    () => allShifts.filter((s) => s.workDate >= weekDays[0] && s.workDate <= weekDays[6]),
    [allShifts, weekDays],
  )
  /** Hafta dışındaki komşu günler — sadece dinlenme süresi denetimi için. */
  const adjacentShifts = useMemo(
    () => allShifts.filter((s) => s.workDate < weekDays[0] || s.workDate > weekDays[6]),
    [allShifts, weekDays],
  )

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

  /**
   * İş Kanunu uyarıları HAFTANIN tamamından türer, o yüzden gün görünümünde de
   * geçerlidir: 45 saati aşan bir planı yalnız hafta ızgarasına geçenler görseydi
   * uyarı çoğu kullanıcıya hiç ulaşmazdı.
   */
  const warningsByEmployee = useMemo(() => {
    const map = new Map<string, LaborWarning[]>()
    for (const r of rows) {
      const list = laborWarnings(
        shifts.filter((s) => s.employeeId === r.id),
        weekDays,
        adjacentShifts.filter((s) => s.employeeId === r.id),
      )
      if (list.length > 0) map.set(r.id, list)
    }
    return map
  }, [rows, shifts, adjacentShifts, weekDays])

  const warnedCount = warningsByEmployee.size

  const visible = view === "gun" ? dayShifts : shifts
  const totalMinutes = visible.reduce(
    (sum, s) => sum + netMinutes(s.plannedStart, s.plannedEnd, s.breakMinutes),
    0,
  )

  const absentCount = visible.filter((s) => s.status === "ABSENT").length


  /**
   * Yayından SONRA plan değişti mi?
   *
   * İki ölçü birlikte gerekiyor: değişen/eklenen vardiya `updatedAt` ile,
   * SİLİNEN vardiya ise sayı farkıyla yakalanır — silinen kayıt arkasında hiçbir
   * zaman damgası bırakmaz ve yalnız `updatedAt`e bakan bir denetim haftayı
   * "yayınlandığı gibi duruyor" sanırdı.
   */
  const changedAfterPublish = useMemo(() => {
    if (!publication) return false
    if (publication.shiftCount !== shifts.length) return true
    const published = new Date(publication.publishedAt).getTime()
    return shifts.some((s) => s.updatedAt && new Date(s.updatedAt).getTime() > published)
  }, [publication, shifts])

  /** Yayın penceresi: bu hafta vardiyası olup e-posta adresi olmayan personel. */
  const employeesWithoutEmail = useMemo(() => {
    const withShift = new Set(shifts.map((s) => s.employeeId))
    return employees.filter((e) => withShift.has(e.id) && !e.email).length
  }, [employees, shifts])

  const grossById = useMemo(
    () => new Map(employees.map((e) => [e.id, e.grossSalary == null ? null : Number(e.grossSalary)])),
    [employees],
  )

  /**
   * Görünen aralığın planlı brüt işçilik maliyeti.
   *
   * Maaşı girilmemiş personel toplama KATILMAZ ve sayısı ayrıca söylenir —
   * eksik maaşla hesaplanan bir toplam "ucuz hafta" izlenimi verirdi.
   */
  const plannedCost = useMemo(() => {
    let cost = 0
    const missing = new Set<string>()
    for (const s of visible) {
      const minutes = netMinutes(s.plannedStart, s.plannedEnd, s.breakMinutes)
      const value = laborCost(minutes, grossById.get(s.employeeId) ?? null)
      if (value == null) missing.add(s.employeeId)
      else cost += value
    }
    return { cost, missing: missing.size }
  }, [visible, grossById])

  // ---- Geri alma ------------------------------------------------------------

  const pushUndo = useCallback((entry: UndoEntry) => {
    setUndoStack((prev) => [...prev.slice(-(UNDO_LIMIT - 1)), entry])
  }, [])

  /**
   * Son işlemi geri alır. Ters istek `force: true` ile gider: geri alınan şey
   * kullanıcının zaten onayladığı bir durumdur, izin/tatil sorusunu ikinci kez
   * sormak Ctrl+Z'yi kullanılamaz hale getirirdi.
   */
  const undo = useCallback(async () => {
    if (!companyId) return
    // Ctrl+Z düğmeye bağlı değil: kapı burada da lazım.
    if (!canWrite) {
      refuse()
      return
    }
    const entry = undoStack[undoStack.length - 1]
    if (!entry) return
    setUndoStack((prev) => prev.slice(0, -1))
    setIsSaving(true)
    try {
      if (entry.kind === "move") {
        const res = await fetch(`/api/personel/shifts/${entry.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId,
            employeeId: entry.employeeId,
            plannedStart: entry.start,
            plannedEnd: entry.end,
            force: true,
          }),
        })
        if (!res.ok) return await fail(res, "Geri alınamadı")
        const saved = await res.json()
        setAllShifts((prev) => prev.map((s) => (s.id === entry.id ? saved : s)))
      } else if (entry.kind === "create") {
        const res = await fetch(`/api/personel/shifts/${entry.id}?companyId=${companyId}`, {
          method: "DELETE",
        })
        if (!res.ok) return await fail(res, "Geri alınamadı")
        setAllShifts((prev) => prev.filter((s) => s.id !== entry.id))
      } else {
        const res = await fetch("/api/personel/shifts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, ...entry.shift, force: true }),
        })
        if (!res.ok) return await fail(res, "Geri alınamadı")
        const restored = await res.json()
        setAllShifts((prev) => [...prev, restored])
      }
      toast({ title: "Geri alındı", description: entry.label })
    } finally {
      setIsSaving(false)
    }
  }, [companyId, undoStack, fail, toast])

  /**
   * Ctrl/Cmd+Z. Yazı alanındayken devreye GİRMEZ: pencerede not yazan kullanıcının
   * Ctrl+Z'si metnini geri almalı, takvimdeki barı değil.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || el?.isContentEditable) return
      e.preventDefault()
      undo()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [undo])

  // ---- Yazma ----------------------------------------------------------------

  async function createShift(
    next: { employeeId: string; start: number; end: number },
    workDate = day,
    breakMinutes = 0,
    note = "",
  ) {
    if (!companyId) return false
    if (!canWrite) {
      refuse()
      return false
    }
    const res = await sendWithForce(
      (force) =>
        fetch("/api/personel/shifts", {
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
            force,
          }),
        }),
      "Vardiya eklenemedi",
    )
    if (!res) return false
    const created = await res.json()
    setAllShifts((prev) => [...prev, created])
    pushUndo({ kind: "create", id: created.id, label: "Yeni vardiya kaldırıldı" })
    return true
  }

  /** Sürükleme sonucu: önce yerel, sonra sunucu; hata olursa geri al. */
  async function moveShift(id: string, next: { employeeId: string; start: number; end: number }) {
    if (!companyId) return
    if (!canWrite) {
      refuse()
      return
    }
    // Geri alma yedeği TAM listeden alınır (`shifts` haftaya kırpılmış türev):
    // kırpılmışı geri yazmak komşu gün vardiyalarını düşürür ve dinlenme uyarısı
    // sessizce kaybolurdu.
    const before = allShifts
    const previous = before.find((s) => s.id === id)
    setAllShifts((prev) =>
      prev.map((s) =>
        s.id === id
          ? { ...s, employeeId: next.employeeId, plannedStart: next.start, plannedEnd: next.end }
          : s,
      ),
    )
    const res = await sendWithForce(
      (force) =>
        fetch(`/api/personel/shifts/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId,
            employeeId: next.employeeId,
            plannedStart: next.start,
            plannedEnd: next.end,
            force,
          }),
        }),
      "Vardiya güncellenemedi",
    )
    if (!res) {
      setAllShifts(before)
      return
    }
    const saved = await res.json()
    setAllShifts((prev) => prev.map((s) => (s.id === id ? saved : s)))
    if (previous) {
      pushUndo({
        kind: "move",
        id,
        employeeId: previous.employeeId,
        start: previous.plannedStart,
        end: previous.plannedEnd,
        label: `${minuteToHHMM(previous.plannedStart)}–${minuteToHHMM(previous.plannedEnd)} konumuna döndü`,
      })
    }
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
      const res = await sendWithForce(
        (force) =>
          fetch(`/api/personel/shifts/${next.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              companyId,
              plannedStart: next.start,
              plannedEnd: next.end,
              absent: next.absent === true,
              breakMinutes: next.breakMinutes,
              note: next.note,
              force,
            }),
          }),
        "Vardiya güncellenemedi",
      )
      if (!res) return
      const saved = await res.json()
      setAllShifts((prev) => prev.map((s) => (s.id === next.id ? saved : s)))
      setDraft(null)
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
      const removed = allShifts.find((s) => s.id === id)
      const res = await fetch(`/api/personel/shifts/${id}?companyId=${companyId}`, { method: "DELETE" })
      if (!res.ok) {
        await fail(res, "Vardiya silinemedi")
        return
      }
      setAllShifts((prev) => prev.filter((s) => s.id !== id))
      setDraft(null)
      if (removed) {
        pushUndo({
          kind: "delete",
          shift: {
            employeeId: removed.employeeId,
            workDate: removed.workDate,
            plannedStart: removed.plannedStart,
            plannedEnd: removed.plannedEnd,
            breakMinutes: removed.breakMinutes,
            note: removed.note ?? null,
          },
          label: "Silinen vardiya geri geldi",
        })
      }
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
      await mutateOpening()
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
      await mutateTemplates()
    } finally {
      setIsSaving(false)
    }
  }

  /** Şablon güncelleme. Barlar kendi saatlerini taşır; burada ad/renk/kalıp değişir. */
  async function updateTemplate(
    id: string,
    t: { name: string; startMinute: number; endMinute: number; breakMinutes: number; color: string },
  ) {
    if (!companyId) return
    setIsSaving(true)
    try {
      const res = await fetch(`/api/personel/shift-templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...t, companyId }),
      })
      if (!res.ok) {
        await fail(res, "Şablon güncellenemedi")
        return
      }
      // Şablonun adı/rengi barlarda görünür: takvimi tazelemezsek eski ad kalır.
      await Promise.all([mutateTemplates(), loadShifts()])
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
      await mutateTemplates()
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
      const { created, skipped, skippedLeave, skippedHoliday } = await res.json()
      await loadShifts()
      // Atlananların SEBEBİ ayrı yazılır: "12 kayıt atlandı" tek başına, izinli
      // personelin planda görünmemesini "eksik doldurdu" sanmaya yol açıyordu.
      const reasons = [
        skipped > 0 ? `${skipped} kayıt mevcut vardiyayla çakıştı` : null,
        skippedLeave > 0 ? `${skippedLeave} kayıt izinli güne denk geldi` : null,
        skippedHoliday > 0 ? `${skippedHoliday} kayıt tatile denk geldi` : null,
      ].filter(Boolean)
      toast({
        title: created > 0 ? `${created} vardiya açıldı` : emptyMessage,
        description: reasons.length > 0 ? `${reasons.join(", ")}; atlandı.` : undefined,
      })
      setFillOpen(false)
    } finally {
      setIsSaving(false)
    }
  }

  /**
   * Haftayı yayınla. E-posta gönderimi yayını BLOKLAMAZ; sonuç kaç kişiye
   * ulaşıldığını ve kaçının adresi olmadığını ayrı ayrı söyler, çünkü "yayınlandı"
   * ile "personel haberdar oldu" aynı şey değil.
   */
  async function publish(notify: boolean) {
    if (!companyId) return
    setIsSaving(true)
    try {
      const res = await fetch("/api/personel/shifts/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, weekStart, notify }),
      })
      if (!res.ok) {
        await fail(res, "Plan yayınlanamadı")
        return
      }
      const result = await res.json()
      setPublication({
        publishedAt: result.publishedAt,
        notifiedCount: result.notified,
        shiftCount: result.shiftCount,
      })
      const parts = [
        notify ? `${result.notified} personele gönderildi` : null,
        result.missingEmail > 0 ? `${result.missingEmail} kişinin e-postası yok` : null,
        result.failed > 0 ? `${result.failed} gönderim başarısız` : null,
      ].filter(Boolean)
      toast({
        title: "Plan yayınlandı",
        description: parts.length > 0 ? parts.join(" · ") : undefined,
      })
      setPublishOpen(false)
    } finally {
      setIsSaving(false)
    }
  }

  /**
   * Haftayı temizle. Damgalı vardiyalar KORUNUR (sunucu da öyle davranıyor):
   * plan yeniden çizilebilir, fiilen çalışılmış saat geri gelmez.
   */
  async function clearWeek() {
    if (!companyId) return
    const stamped = shifts.filter(
      (s) => s.status !== "PLANNED",
    ).length
    const removable = shifts.length - stamped
    if (
      !(await confirm({
        title: `${removable} vardiya silinecek`,
        description:
          stamped > 0
            ? `${weekRangeLabel(weekStart)} haftasındaki planlı vardiyalar kaldırılacak. Damgalı ${stamped} vardiya korunur.`
            : `${weekRangeLabel(weekStart)} haftasındaki tüm vardiyalar kaldırılacak.`,
        confirmLabel: "Temizle",
        variant: "destructive",
      }))
    )
      return
    setIsSaving(true)
    try {
      const res = await fetch(
        `/api/personel/shifts/bulk?companyId=${companyId}&from=${weekDays[0]}&to=${weekDays[6]}`,
        { method: "DELETE" },
      )
      if (!res.ok) {
        await fail(res, "Hafta temizlenemedi")
        return
      }
      const { deleted, kept } = await res.json()
      await loadShifts()
      toast({
        title: `${deleted} vardiya silindi`,
        description: kept > 0 ? `${kept} damgalı vardiya korundu.` : undefined,
      })
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
      await mutateHolidays()
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
      await mutateHolidays()
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
      await mutateHolidays()
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
          <WriteAction>
            <Button
              variant="outline"
              size="icon"
              onClick={undo}
              disabled={undoStack.length === 0 || isSaving}
              title="Son değişikliği geri al (Ctrl+Z)"
            >
              <Undo2 className="h-4 w-4" />
            </Button>
          </WriteAction>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-semibold">
          {view === "gun" ? dayTitle(day) : `${weekDays[0]} – ${weekDays[6]}`}
        </span>
        <span className="text-sm text-muted-foreground">
          {visible.length} vardiya · plan {durationLabel(totalMinutes)}
        </span>
        {plannedCost.cost > 0 && (
          <span
            className="text-sm text-muted-foreground"
            title={`Brüt işçilik — ${HOURLY_BASIS_LABEL}${
              plannedCost.missing > 0
                ? `. ${plannedCost.missing} personelin maaşı girilmediği için toplama dahil değil.`
                : ""
            }`}
          >
            işçilik{" "}
            <span className="font-semibold text-foreground">{money(plannedCost.cost)}</span>
            {plannedCost.missing > 0 && <span className="text-amber-600 dark:text-amber-400"> *</span>}
          </span>
        )}
        {absentCount > 0 && (
          <span className="text-sm text-red-600 dark:text-red-400">{absentCount} devamsızlık</span>
        )}
        {warnedCount > 0 && (
          <span
            className="flex items-center gap-1 text-sm text-amber-600 dark:text-amber-400"
            title="Haftalık 45 saat, günlük 11 saat, iki vardiya arası 11 saat dinlenme ve hafta tatili denetlenir. Ayrıntı için hafta görünümündeki personel satırına bakın."
          >
            <AlertTriangle className="h-4 w-4" />
            {warnedCount} personelde mevzuat uyarısı
          </span>
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
        {/* Yayın durumu: hafta personele gitti mi, gittiyse o günden sonra
            değişti mi. "Yayınlandı" tek başına yeterli değil — sonradan oynanan
            bir plan personelin elindekiyle uyuşmuyor demektir. */}
        {publication ? (
          changedAfterPublish ? (
            <span
              className="flex items-center gap-1 text-sm text-amber-600 dark:text-amber-400"
              title={`${new Date(publication.publishedAt).toLocaleString("tr-TR")} tarihinde yayınlandı; o tarihten sonra plan değişti.`}
            >
              <AlertTriangle className="h-4 w-4" />
              Yayından sonra değişti
            </span>
          ) : (
            <span
              className="flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400"
              title={`${new Date(publication.publishedAt).toLocaleString("tr-TR")} · ${publication.notifiedCount} personele gönderildi`}
            >
              <CheckCircle2 className="h-4 w-4" />
              Yayında
            </span>
          )
        ) : (
          <span className="text-sm text-muted-foreground">Yayınlanmadı</span>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <WriteAction>
            <Button
              variant={publication && !changedAfterPublish ? "outline" : "default"}
              size="sm"
              onClick={() => setPublishOpen(true)}
              // Yayın HAFTAYA aittir: gün görünümündeyken bile ölçü haftanın
              // tamamıdır, o günün boş olması yayını engellemez.
              disabled={shifts.length === 0}
            >
              <Send className="mr-1 h-4 w-4" />
              {publication ? "Yeniden yayınla" : "Yayınla"}
            </Button>
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
          </WriteAction>
          {/* Çizelge çıktısı: mutfak duvarına asılan kâğıt. Dataset puantajla
              aynı katmandan geçer (lib/export), formatları oradan gelir. */}
          <ExportButton
            dataset="personel-vardiya"
            companyId={companyId}
            params={{ weekStart }}
            disabled={shifts.length === 0}
          />
          <WriteAction>
            <Button variant="outline" size="sm" onClick={() => setTemplatesOpen(true)}>
              <LayoutGrid className="mr-1 h-4 w-4" /> Şablonlar
            </Button>
            <Button variant="outline" size="sm" onClick={() => setTatilOpen(true)}>
              <PartyPopper className="mr-1 h-4 w-4" /> Tatiller
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={clearWeek}
              disabled={isSaving || shifts.length === 0}
              className="text-red-600 hover:text-red-700 dark:text-red-400"
            >
              <Eraser className="mr-1 h-4 w-4" /> Haftayı temizle
            </Button>
          </WriteAction>
        </div>
      </div>

      {/* Referans veriler de beklenir: açılış saati gelmeden ızgara varsayılan
          8–20 penceresiyle çizilip sonra sıçrıyordu. */}
      {isLoadingData || openingLoading || templatesLoading || holidaysLoading ? (
        <div className="flex items-center justify-center p-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Takvim yükleniyor...
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-12 text-center text-muted-foreground">
          <Users className="h-8 w-8" />
          <p>Aktif personel yok. Önce Personeller ekranından personel ekleyin.</p>
        </div>
      ) : (
        <>
          {/* Mobil liste ve ızgara AYNI ANDA render edilir, CSS ile ayrışır.
              Ekran genişliğini JS'te ölçüp birini seçmek, ilk çizimde yanlış
              görünümü gösterip sonra atlıyordu (hydration uyuşmazlığı). */}
          <div className="lg:hidden">
            <VardiyaMobil
              days={view === "gun" ? [day] : weekDays}
              employees={rows}
              shifts={view === "gun" ? dayShifts : shifts}
              leaveDays={leaveMap}
              holidays={weekHolidays}
              today={todayIso()}
              onOpenShift={(s) => openEditor(s.id)}
              onAddShift={openDraftFor}
            />
          </div>
          <div className="hidden lg:block lg:space-y-4">
            {view === "gun" ? (
              <>
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
                  onOpenOpening={() => (canWrite ? setOpeningOpen(true) : refuse())}
                />
                {/* Kapsama şeridi ızgaranın hemen ALTINDA ve aynı eksende: ayrı
                    bir sekmeye konsaydı planlama sırasında kimse bakmazdı. */}
                {dayShifts.length > 0 && (
                  <VardiyaKapsama
                    shifts={dayShifts}
                    window={win}
                    demand={demand?.hours}
                    sampleDays={demand?.sampleDays}
                    nameWidth={TIMELINE_NAME_WIDTH}
                  />
                )}
              </>
            ) : (
              <VardiyaHafta
                days={weekDays}
                employees={rows}
                shifts={shifts}
                leaveDays={leaveMap}
                holidays={weekHolidays}
                warningsByEmployee={warningsByEmployee}
                today={todayIso()}
                onOpenShift={(s) => openEditor(s.id)}
                onAddShift={openDraftFor}
              />
            )}
          </div>
        </>
      )}

      <VardiyaDialog
        draft={draft}
        employees={rows.map((r) => ({ id: r.id, name: r.name }))}
        isSaving={isSaving}
        onClose={() => setDraft(null)}
        onSave={saveDraft}
        onDelete={removeShift}
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
        onUpdate={updateTemplate}
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
      <YayinlaDialog
        open={publishOpen}
        weekLabel={weekRangeLabel(weekStart)}
        shiftCount={shifts.length}
        employeesWithoutEmail={employeesWithoutEmail}
        isPublished={publication != null}
        isSaving={isSaving}
        onClose={() => setPublishOpen(false)}
        onPublish={publish}
      />
      <TopluDoldurDialog
        open={fillOpen}
        templates={templates}
        employees={rows.map((r) => ({ id: r.id, name: r.name }))}
        days={view === "gun" ? [day] : weekDays}
        isSaving={isSaving}
        onClose={() => setFillOpen(false)}
        onApply={({ mode, templateId, employeeIds, days, cycle, stagger }) =>
          runBulk(
            mode === "rotation"
              ? { mode, employeeIds, days, cycle, stagger }
              : { mode: "template", templateId, employeeIds, days },
            "Tüm günlerde zaten vardiya var",
          )
        }
        onManageTemplates={() => {
          setFillOpen(false)
          setTemplatesOpen(true)
        }}
      />
    </div>
  )

  /**
   * Boş bir hücreden yeni vardiya taslağı açar.
   *
   * Hafta ızgarası ve mobil liste AYNI varsayılanı kullanmalı: saatler iki yerde
   * ayrı hesaplansaydı aynı boş güne masaüstünden ve telefondan eklenen vardiya
   * farklı saatte başlardı.
   */
  function openDraftFor(employeeId: string, d: string) {
    if (!canWrite) {
      refuse()
      return
    }
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
  }

  /** İki görünüm de aynı düzenleyiciyi açar; kayıt listeden id ile bulunur. */
  function openEditor(id: string) {
    const s = shifts.find((x) => x.id === id)
    if (!s) return
    // Düzenleyici SİLME de yapar; salt-okunurda açmak yerine sebebi söylenir.
    if (!canWrite) {
      refuse()
      return
    }
    const emp = rows.find((r) => r.id === s.employeeId)
    setDraft({
      id: s.id,
      employeeId: s.employeeId,
      employeeName: emp?.name || "",
      workDate: s.workDate,
      start: s.plannedStart,
      end: s.plannedEnd,
      absent: s.status === "ABSENT",
      breakMinutes: s.breakMinutes,
      note: s.note || "",
      updatedAt: s.updatedAt ?? null,
      updatedByName: s.updatedByName ?? null,
    })
  }
}
