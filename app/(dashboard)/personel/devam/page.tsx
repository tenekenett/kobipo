"use client"

/**
 * Devam Takvimi — vardiyasız (tek düze) çalışan işletmenin haftalık puantajı.
 *
 * Vardiya takviminin yerine geçer: orada soru "kim saat kaçta", burada "kim geldi,
 * kim izinli". Hangisinin menüde duracağını firma ayarı belirler
 * (`Company.usesShifts`, bkz. lib/nav/pages.ts `hiddenByShiftMode`).
 *
 * İŞARETLEME FIRÇAYLA: üstten bir durum seçilir, hücrelere tıklandıkça uygulanır.
 * Hücreyi sırayla dolaştıran bir tasarım sekiz durumda kullanılamaz hâle gelirdi;
 * fırça ayrıca "bütün haftayı izinli yap"ı tek jeste indirir (personel adına
 * tıklamak satırın çalışma günlerine uygular; hafta tatili ve işletme tatili
 * atlanır, yoksa "haftayı devamsız yap" 5 günlük kesintiyi 7'ye çıkarırdı).
 *
 * KAYIT = İSTİSNA: aynı durum ikinci kez uygulanınca satır SİLİNİR ve gün yeniden
 * türetilir (izin/tatil/kapalı gün/çalıştı). Böylece "çalıştı" işaretlemek için
 * 30 kişi × 30 gün tıklamak gerekmez; yalnız sapma yazılır.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/components/ui/use-toast"
import { WriteAction, useWriteGuard } from "@/components/dashboard/write-guard"
import { CompanyLink } from "@/components/dashboard/company-link"
import { cn } from "@/lib/utils"
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Loader2, PartyPopper, Wallet } from "lucide-react"
import { DevamHafta, type DevamRowData } from "@/components/personel/devam-hafta"
import { AcilisSaatiDialog } from "@/components/personel/acilis-saati-dialog"
import { TatilDialog } from "@/components/personel/tatil-dialog"
import { KipUyarisi } from "@/components/personel/kip-uyarisi"
import { PersonelKipDialog, type KipHedefi } from "@/components/personel/personel-kip-dialog"
import { DEVAM_DOT_CLASS } from "@/components/personel/devam-renkleri"
import {
  DEVAM_STATUS,
  effectiveDayStatus,
  summarize,
  type DevamCell,
  type DevamLeave,
  type DevamStatus,
} from "@/lib/personel/devam"
import { holidayMap } from "@/lib/personel/tatil"
import type { OpeningHours } from "@/lib/personel/opening-hours"
import { shiftDayIso, todayIso, weekDaysIso, weekRangeLabel, weekStartIso } from "@/lib/personel/vardiya"
import { useCompanyHolidays, useOpeningHours } from "@/lib/swr/use-company-data"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { flatEmployees, normalizeMode, shiftEmployees } from "@/lib/personel/kip"

type Employee = {
  id: string
  firstName: string
  lastName: string
  department?: string | null
  position?: string | null
  status: string
  hireDate?: string | null
  terminationDate?: string | null
  /** null = firmanın çalışma düzeni (bkz. lib/personel/kip.ts). */
  usesShifts?: boolean | null
}

type AttendanceRecord = {
  id: string
  employeeId: string
  workDate: string
  status: string
  note?: string | null
}

type LeaveRow = {
  employee: { id: string }
  type: string
  startDate: string
  endDate: string
}

/**
 * Fırçada gösterilen durumlar ve sırası.
 *
 * "Çalıştı" başta: en sık kullanılan işaretleme, türetilmiş bir izni/tatili
 * bozmak (bayramda açıktık, izinli gün çalışıldı) için gerekli.
 */
const BRUSH_ORDER: DevamStatus[] = [
  "WORKED",
  "HALF_DAY",
  "PAID_LEAVE",
  "SICK",
  "UNPAID_LEAVE",
  "ABSENT",
  "HOLIDAY",
  "WEEKLY_OFF",
]

export default function DevamPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const { canWrite, refuse } = useWriteGuard()
  const { selectedCompany, fetchCompanies } = useDashboardCompany()
  const mode = normalizeMode(selectedCompany?.workScheduleMode)

  const [weekStart, setWeekStart] = useState(() => weekStartIso(todayIso()))
  const [employees, setEmployees] = useState<Employee[]>([])
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [leaves, setLeaves] = useState<LeaveRow[]>([])
  const [brush, setBrush] = useState<DevamStatus>("PAID_LEAVE")
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  /**
   * Çalışma günleri ve tatiller BURADAN da düzenlenir.
   *
   * İkisi de vardiyaya özgü değil — devam takvimi kapalı günü "hafta tatili",
   * tatil gününü "tatil" diye türetiyor. Vardiya ekranı bu kipte menüde
   * olmadığı için tek düzenleme yolu burasıdır; olmasaydı tek düze çalışan
   * işletme hafta tatilini hiç tanımlayamaz ve pazar günleri de "çalıştı"
   * sayılırdı.
   */
  const { openingHours, mutate: mutateOpening } = useOpeningHours(companyId)
  const { holidays, mutate: mutateHolidays } = useCompanyHolidays(companyId)
  const [openingOpen, setOpeningOpen] = useState(false)
  const [tatilOpen, setTatilOpen] = useState(false)
  /** Ad sütununa tıklanan personel — çalışma düzeni penceresi. */
  const [kipHedefi, setKipHedefi] = useState<KipHedefi | null>(null)

  const days = useMemo(() => weekDaysIso(weekStart), [weekStart])

  const load = useCallback(async () => {
    if (!companyId) return
    setIsLoading(true)
    try {
      const [empRes, attRes, leaveRes] = await Promise.all([
        fetch(`/api/personel/employees?companyId=${companyId}`),
        fetch(
          `/api/personel/attendance?companyId=${companyId}&from=${days[0]}&to=${days[6]}`,
        ),
        // İzinler yalnız görünen aralıktan: süzgeçsiz istek firmanın bütün geçmiş
        // izinlerini getirir ve takvim yıllar içinde ağırlaşır.
        fetch(
          `/api/personel/leaves?companyId=${companyId}&status=APPROVED&from=${days[0]}&to=${days[6]}`,
        ),
      ])
      if (empRes.ok) setEmployees(await empRes.json())
      if (attRes.ok) setRecords(await attRes.json())
      if (leaveRes.ok) setLeaves(await leaveRes.json())
    } finally {
      setIsLoading(false)
    }
  }, [companyId, days])

  useEffect(() => {
    load()
  }, [load])

  const leaveDtos: DevamLeave[] = useMemo(
    () =>
      leaves.map((l) => ({
        employeeId: l.employee.id,
        type: l.type,
        startDay: l.startDate.slice(0, 10),
        endDay: l.endDate.slice(0, 10),
      })),
    [leaves],
  )

  const recordMap = useMemo(() => {
    const map = new Map<string, AttendanceRecord>()
    for (const r of records) map.set(`${r.employeeId}|${r.workDate}`, r)
    return map
  }, [records])

  const holidayNames = useMemo(() => {
    const map = new Map<string, string>()
    for (const [day, holiday] of holidayMap(holidays ?? [], days)) map.set(day, holiday.name)
    return map
  }, [holidays, days])

  /**
   * Ekrandaki personeller: aktifler + bu hafta kaydı olanlar. Ayrılmış personel
   * listede kalırsa ekip her ay biraz daha uzar; kaydı varken düşerse o kayıt
   * hiçbir yerde görünmez hâle gelir.
   */
  const visibleEmployees = useMemo(() => {
    const withRecord = new Set(records.map((r) => r.employeeId))
    // Bu takvim YALNIZ sabit mesaili personeli listeler: vardiyalılar vardiya
    // takvimindedir ve ikisinde birden görünen bir çalışanın ayı bordroya hem
    // saat hem gün olarak girerdi (bkz. lib/personel/kip.ts).
    return flatEmployees(employees, mode).filter(
      (e) => e.status !== "TERMINATED" || withRecord.has(e.id),
    )
  }, [employees, mode, records])

  /** Öteki takvimdeki aktif personel sayısı — "eksik" görünen ekran açıklansın. */
  const otekiTakvimSayisi = useMemo(
    () => shiftEmployees(employees, mode).filter((e) => e.status !== "TERMINATED").length,
    [employees, mode],
  )

  const rows: DevamRowData[] = useMemo(
    () =>
      visibleEmployees.map((e) => {
        const employee = {
          id: e.id,
          hireDay: e.hireDate ? e.hireDate.slice(0, 10) : null,
          terminationDay: e.terminationDate ? e.terminationDate.slice(0, 10) : null,
        }
        const cells: DevamCell[] = days.map((day) =>
          effectiveDayStatus({
            day,
            employee,
            record: recordMap.get(`${e.id}|${day}`) ?? null,
            leaves: leaveDtos,
            holidays: holidays ?? [],
            openingHours: openingHours ?? null,
          }),
        )
        const ozet = summarize(cells)
        return {
          employeeId: e.id,
          name: `${e.firstName} ${e.lastName}`.trim(),
          subtitle: e.position || e.department || null,
          cells,
          workedDays: ozet.workedDays,
          deductionDays: ozet.deductionDays,
        }
      }),
    [visibleEmployees, days, recordMap, leaveDtos, holidays, openingHours],
  )

  const haftaOzeti = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          worked: acc.worked + r.workedDays,
          deduction: acc.deduction + r.deductionDays,
        }),
        { worked: 0, deduction: 0 },
      ),
    [rows],
  )

  /** Uç hatasını kullanıcının diliyle söyler; sessiz başarısızlık en kötüsü. */
  const fail = useCallback(
    async (res: Response, fallback: string) => {
      const data = await res.json().catch(() => ({}))
      toast({ title: fallback, description: data?.error || undefined, variant: "destructive" })
    },
    [toast],
  )

  /** Vardiya takvimiyle aynı jest: isme tıklamak çalışma düzenini açar. */
  function acKipPenceresi(employeeId: string) {
    if (!canWrite) {
      refuse()
      return
    }
    const emp = employees.find((e) => e.id === employeeId)
    if (!emp) return
    setKipHedefi({
      id: emp.id,
      name: `${emp.firstName} ${emp.lastName}`.trim(),
      usesShifts: emp.usesShifts ?? null,
    })
  }

  async function kipKaydet(
    employeeId: string,
    usesShifts: boolean | null,
    karmaYap: boolean,
  ) {
    if (!companyId) return
    setIsSaving(true)
    try {
      const res = await fetch(`/api/personel/employees/${employeeId}?companyId=${companyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usesShifts }),
      })
      if (!res.ok) {
        await fail(res, "Çalışma düzeni değiştirilemedi")
        return
      }
      // Seçilen tarafın takvimi firmada kapalıysa firma karmaya alınır; yoksa
      // kişi menüde olmayan bir ekrana atanmış olur ve günleri işaretlenemez.
      if (karmaYap) {
        const modRes = await fetch("/api/personel/ayarlar", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, workScheduleMode: "MIXED" }),
        })
        if (!modRes.ok) {
          await fail(modRes, "Firma çalışma düzeni güncellenemedi")
          return
        }
        await fetchCompanies()
      }
      setKipHedefi(null)
      // Liste tazelenmeli: vardiyalıya alınan kişi bu takvimden düşer.
      await load()
      toast({
        title: "Çalışma düzeni güncellendi",
        description:
          usesShifts === true
            ? "Bu çalışan artık Vardiya Takvimi'nde planlanacak."
            : "Bu çalışan devam takviminde işaretlenecek.",
      })
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
        await fail(res, "Çalışma günleri kaydedilemedi")
        return
      }
      await mutateOpening()
      setOpeningOpen(false)
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

  /**
   * Hücreleri yaz. Yerel duruma ÖNCE yazılır: ağ gecikmesi boyunca hücrenin eski
   * rengi kalırsa kullanıcı ikinci kez tıklıyor ve işaretlemeyi geri alıyordu.
   * İstek başarısızsa önceki liste geri yüklenir ve sebep söylenir.
   */
  const applyCells = useCallback(
    async (cells: { employeeId: string; workDate: string; status: DevamStatus | null }[]) => {
      if (!companyId || cells.length === 0) return
      if (!canWrite) {
        refuse()
        return
      }
      const previous = records
      const next = new Map(records.map((r) => [`${r.employeeId}|${r.workDate}`, r]))
      for (const cell of cells) {
        const key = `${cell.employeeId}|${cell.workDate}`
        if (cell.status === null) next.delete(key)
        else {
          const existing = next.get(key)
          next.set(key, {
            id: existing?.id ?? `local-${key}`,
            employeeId: cell.employeeId,
            workDate: cell.workDate,
            status: cell.status,
            note: existing?.note ?? null,
          })
        }
      }
      setRecords([...next.values()])
      setIsSaving(true)
      try {
        const res = await fetch("/api/personel/attendance", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, cells }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          setRecords(previous)
          toast({
            title: "İşaretlenemedi",
            description: data?.error || "Kayıt yazılamadı.",
            variant: "destructive",
          })
          return
        }
        // Sunucudan gelen gerçek id'ler için tazele: yerel geçici id ile ikinci bir
        // yazma yapılırsa upsert yine doğru çalışır ama liste tutarsız kalırdı.
        load()
      } finally {
        setIsSaving(false)
      }
    },
    [canWrite, companyId, load, records, refuse, toast],
  )

  const onCellClick = useCallback(
    (employeeId: string, day: string, cell: DevamCell) => {
      // Aynı durumu ikinci kez uygulamak = işaretlemeyi kaldır. Yalnız ELLE
      // yazılmış hücrede geçerli: türetilmiş bir günde "temizle" hiçbir şey yapmaz
      // ve kullanıcı tıklamasının yutulduğunu sanırdı.
      const clear = cell.source === "record" && cell.status === brush
      applyCells([{ employeeId, workDate: day, status: clear ? null : brush }])
    },
    [applyCells, brush],
  )

  const onRowFill = useCallback(
    (employeeId: string) => {
      const row = rows.find((r) => r.employeeId === employeeId)
      if (!row) return
      // Toplu uygulama ÇALIŞMA GÜNLERİNE yapılır: hafta tatili ve işletme tatili
      // atlanır. Atlanmasaydı "haftayı devamsız yap" pazar gününü de kesintiye
      // sokar ve 5 günlük kesinti 7 güne çıkardı. İstisna, fırçanın kendisinin
      // tatil olması: o zaman kullanıcı bilerek tatil boyuyordur.
      const tatilBoyuyor = brush === "WEEKLY_OFF" || brush === "HOLIDAY"
      const cells = days
        // İstihdam dışı günler her hâlükârda atlanır: işe girmeden önceki güne
        // devam yazmak bordroda olmayan bir çalışanı sayardı.
        .filter((_, i) => {
          const status = row.cells[i].status
          if (status == null) return false
          if (tatilBoyuyor) return true
          return status !== "WEEKLY_OFF" && status !== "HOLIDAY"
        })
        .map((day) => ({ employeeId, workDate: day, status: brush }))
      applyCells(cells)
    },
    [applyCells, brush, days, rows],
  )

  if (!companyId) {
    return <div className="p-6 text-sm text-muted-foreground">Lütfen firma seçin.</div>
  }

  return (
    <div className="space-y-4">
      <KipUyarisi ekran="devam" />
      <Card>
        <CardHeader className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5" /> Devam Takvimi
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setWeekStart(shiftDayIso(weekStart, -7))}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => setWeekStart(weekStartIso(todayIso()))}>
                Bu hafta
              </Button>
              <Button variant="outline" size="sm" onClick={() => setWeekStart(shiftDayIso(weekStart, 7))}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <span className="text-sm font-medium">{weekRangeLabel(weekStart)}</span>
              {isSaving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              <WriteAction>
                <Button variant="outline" size="sm" onClick={() => setOpeningOpen(true)}>
                  <Clock className="mr-1 h-4 w-4" /> Çalışma günleri
                </Button>
              </WriteAction>
              <WriteAction>
                <Button variant="outline" size="sm" onClick={() => setTatilOpen(true)}>
                  <PartyPopper className="mr-1 h-4 w-4" /> Tatiller
                </Button>
              </WriteAction>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-xs font-medium text-muted-foreground">İşaretle:</span>
            {BRUSH_ORDER.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => setBrush(status)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition",
                  brush === status
                    ? "border-kobipo-blue bg-kobipo-blue/10 font-semibold text-kobipo-blue dark:border-primary dark:text-primary"
                    : "border-border text-muted-foreground hover:border-kobipo-blue/40",
                )}
              >
                <span className={cn("h-2.5 w-2.5 rounded-full", DEVAM_DOT_CLASS[status])} />
                {DEVAM_STATUS[status].label}
              </button>
            ))}
          </div>

          {otekiTakvimSayisi > 0 && (
            <p className="rounded-lg border border-dashed border-border p-2.5 text-xs text-muted-foreground">
              {otekiTakvimSayisi} personel vardiyalı olarak işaretli ve burada
              görünmüyor; onların planı{" "}
              <CompanyLink href="/personel/vardiya" className="underline underline-offset-4">
                Vardiya Takvimi
              </CompanyLink>{" "}
              ekranında. Bir çalışanın düzenini personel kartından değiştirebilirsiniz.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Hücreye tıklayınca seçili durum uygulanır; aynı durumu ikinci kez tıklamak
            işaretlemeyi kaldırır ve gün yeniden hesaplanır. Addaki fırça düğmesi seçili durumu
            haftanın çalışma günlerine uygular (tatil günleri atlanır). Personel adına
            tıklamak o kişinin çalışma düzenini değiştirir. <strong>Kesikli çerçeveli</strong> günler
            işaretlenmemiştir: izin kaydından, işletme tatilinden veya kapalı günden
            gelirler.
          </p>
        </CardHeader>

        <CardContent>
          {isLoading && <div className="text-sm text-muted-foreground">Yükleniyor…</div>}
          {!isLoading && rows.length === 0 && (
            <div className="text-sm text-muted-foreground">
              {otekiTakvimSayisi > 0 ? (
                <>
                  Sabit mesaili personel yok — firmadaki herkes vardiyalı işaretli.
                  Bir çalışanı bu takvime almak için{" "}
                  <CompanyLink href="/personel" className="underline underline-offset-4">
                    personel kartından
                  </CompanyLink>{" "}
                  çalışma düzenini &quot;Sabit mesai&quot; yapın.
                </>
              ) : (
                <>
                  Bu firmada aktif personel yok.{" "}
                  <CompanyLink href="/personel" className="underline underline-offset-4">
                    Personel ekleyin
                  </CompanyLink>
                  .
                </>
              )}
            </div>
          )}
          {!isLoading && rows.length > 0 && (
            <DevamHafta
              days={days}
              rows={rows}
              holidayNames={holidayNames}
              canWrite={canWrite}
              onCellClick={onCellClick}
              onRowFill={onRowFill}
              onEmployeeClick={acKipPenceresi}
            />
          )}
        </CardContent>
      </Card>

      {!isLoading && rows.length > 0 && (
        <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-muted/20 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span>
              <span className="text-muted-foreground">Bu hafta çalışılan: </span>
              <strong className="tabular-nums">{gunLabel(haftaOzeti.worked)}</strong>
            </span>
            <span>
              <span className="text-muted-foreground">Kesinti: </span>
              <strong
                className={cn(
                  "tabular-nums",
                  haftaOzeti.deduction > 0 && "text-rose-600 dark:text-rose-400",
                )}
              >
                {gunLabel(haftaOzeti.deduction)}
              </strong>
            </span>
          </div>
          <CompanyLink
            href="/personel/puantaj"
            className="flex items-center gap-1.5 font-medium text-kobipo-blue underline underline-offset-4 dark:text-primary"
          >
            <Wallet className="h-4 w-4" /> Aylık özet ve bordroya aktarım
          </CompanyLink>
        </div>
      )}

      <PersonelKipDialog
        hedef={kipHedefi}
        companyMode={selectedCompany?.workScheduleMode}
        isSaving={isSaving}
        onClose={() => setKipHedefi(null)}
        onSave={kipKaydet}
      />
      <AcilisSaatiDialog
        open={openingOpen}
        value={openingHours ?? null}
        isSaving={isSaving}
        onClose={() => setOpeningOpen(false)}
        onSave={saveOpening}
      />
      <TatilDialog
        open={tatilOpen}
        holidays={holidays ?? []}
        isSaving={isSaving}
        onClose={() => setTatilOpen(false)}
        onCreate={createHoliday}
        onDelete={removeHoliday}
        onSeed={seedHolidays}
      />
    </div>
  )
}

const gunLabel = (n: number) =>
  `${Number(n).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} gün`
