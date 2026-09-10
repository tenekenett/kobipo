import { describe, expect, it } from "vitest"
import {
  DEVAM_STATUS,
  deductionDaysFor,
  effectiveDayStatus,
  emptyCounts,
  summarize,
  type DevamCell,
} from "@/lib/personel/devam"
import { DEFAULT_OPENING_HOURS } from "@/lib/personel/opening-hours"

const employee = { id: "e1" }

const holiday = {
  id: "h1",
  name: "Yılbaşı",
  date: "2026-01-01",
  recurring: true,
  halfDayFrom: null,
}

describe("effectiveDayStatus", () => {
  it("kayıt yoksa olağan hâl çalıştıdır", () => {
    // 2026-09-10 perşembe; varsayılan açılış saatlerinde açık.
    const cell = effectiveDayStatus({
      day: "2026-09-10",
      employee,
      openingHours: DEFAULT_OPENING_HOURS,
    })
    expect(cell).toMatchObject({ status: "WORKED", source: "default" })
  })

  it("elle işaretlenen kayıt her türetmeyi yener", () => {
    const cell = effectiveDayStatus({
      day: "2026-01-01",
      employee,
      record: { status: "WORKED", note: "bayramda açıktık" },
      holidays: [holiday],
      openingHours: DEFAULT_OPENING_HOURS,
    })
    expect(cell.status).toBe("WORKED")
    expect(cell.source).toBe("record")
  })

  it("onaylı izin tatilden ÖNCE gelir — izin bakiyesinden düşen gün kaybolmasın", () => {
    const cell = effectiveDayStatus({
      day: "2026-01-01",
      employee,
      leaves: [{ employeeId: "e1", type: "ANNUAL", startDay: "2025-12-28", endDay: "2026-01-03" }],
      holidays: [holiday],
      openingHours: DEFAULT_OPENING_HOURS,
    })
    expect(cell).toMatchObject({ status: "PAID_LEAVE", source: "leave" })
  })

  it("ücretsiz izin ve rapor kendi durumlarına eşlenir", () => {
    const unpaid = effectiveDayStatus({
      day: "2026-09-10",
      employee,
      leaves: [{ employeeId: "e1", type: "UNPAID", startDay: "2026-09-10", endDay: "2026-09-10" }],
    })
    const sick = effectiveDayStatus({
      day: "2026-09-10",
      employee,
      leaves: [{ employeeId: "e1", type: "SICK", startDay: "2026-09-10", endDay: "2026-09-10" }],
    })
    expect(unpaid.status).toBe("UNPAID_LEAVE")
    expect(sick.status).toBe("SICK")
  })

  it("başka personelin izni bu personeli etkilemez", () => {
    const cell = effectiveDayStatus({
      day: "2026-09-10",
      employee,
      leaves: [{ employeeId: "e2", type: "ANNUAL", startDay: "2026-09-10", endDay: "2026-09-10" }],
    })
    expect(cell.status).toBe("WORKED")
  })

  it("kapalı gün hafta tatilidir; açılış saati tanımsızsa türetilmez", () => {
    // Varsayılan tabloda pazar kapalı: 2026-09-13 pazar.
    const kapali = effectiveDayStatus({
      day: "2026-09-13",
      employee,
      openingHours: DEFAULT_OPENING_HOURS,
    })
    expect(kapali).toMatchObject({ status: "WEEKLY_OFF", source: "closed" })
    const tanimsiz = effectiveDayStatus({ day: "2026-09-13", employee, openingHours: null })
    expect(tanimsiz.status).toBe("WORKED")
  })

  it("işe girişten önceki ve çıkıştan sonraki gün hiçbir sayıma girmez", () => {
    const emp = { id: "e1", hireDay: "2026-09-05", terminationDay: "2026-09-20" }
    expect(effectiveDayStatus({ day: "2026-09-04", employee: emp }).status).toBeNull()
    expect(effectiveDayStatus({ day: "2026-09-21", employee: emp }).status).toBeNull()
    expect(effectiveDayStatus({ day: "2026-09-10", employee: emp }).status).toBe("WORKED")
  })
})

describe("summarize", () => {
  it("çalışılan ve kesilecek günleri ayrı sayar", () => {
    const cells: DevamCell[] = [
      { status: "WORKED", source: "default" },
      { status: "WORKED", source: "default" },
      { status: "HALF_DAY", source: "record" },
      { status: "PAID_LEAVE", source: "leave" },
      { status: "UNPAID_LEAVE", source: "record" },
      { status: "ABSENT", source: "record" },
      { status: "WEEKLY_OFF", source: "closed" },
      { status: null, source: "employment" },
    ]
    const ozet = summarize(cells)
    expect(ozet.workedDays).toBe(2.5)
    expect(ozet.deductionDays).toBe(2.5)
    expect(ozet.counts.WORKED).toBe(2)
    // İstihdam dışı gün hiçbir kovaya girmez.
    expect(Object.values(ozet.counts).reduce((a, b) => a + b, 0)).toBe(7)
  })
})

describe("deductionDaysFor", () => {
  it("raporlu gün varsayılan olarak kesilmez, istenirse eklenir", () => {
    const counts = { ...emptyCounts(), ABSENT: 1, UNPAID_LEAVE: 2, SICK: 3 }
    expect(deductionDaysFor(counts)).toBe(3)
    expect(deductionDaysFor(counts, { countSick: true })).toBe(6)
    expect(deductionDaysFor(counts, { countUnpaid: false })).toBe(1)
  })

  it("yarım gün yarım kesinti üretir", () => {
    const counts = { ...emptyCounts(), HALF_DAY: 3 }
    expect(deductionDaysFor(counts)).toBe(1.5)
    expect(DEVAM_STATUS.HALF_DAY.workedDays).toBe(0.5)
  })
})
