import { describe, expect, it } from "vitest"
import { toDateInput } from "@/lib/format"
import { defaultReportRange, reportRangePresets } from "./date-range"

describe("varsayılan rapor dönemi", () => {
  it("başlangıç bitişten 30 gün geride", () => {
    const range = defaultReportRange(new Date(2026, 8, 2))
    expect(range.endDate).toBe("2026-09-02")
    expect(range.startDate).toBe("2026-08-03")
  })

  it("ay ve yıl sınırını aşar", () => {
    expect(defaultReportRange(new Date(2026, 0, 10)).startDate).toBe("2025-12-11")
    // Artık yıl: Mart başından 30 gün geri, 29 Şubat'ı sayar.
    expect(defaultReportRange(new Date(2028, 2, 5)).startDate).toBe("2028-02-04")
  })

  /**
   * `toISOString()` UTC'ye çevirdiği için yerel gece yarısı bir önceki güne
   * düşüyor ve 1 Ocak 2026 varsayılanı kutuda "2025-12-31" görünüyordu.
   * Ortak yardımcı (`toDateInput`) bunu yapmaz — varsayılan ona dayanıyor.
   */
  it("yerel günü verir, UTC'ye kaymaz", () => {
    expect(toDateInput(new Date(2026, 0, 1))).toBe("2026-01-01")
    expect(toDateInput(new Date(2026, 8, 2, 1, 30))).toBe("2026-09-02")
  })
})

describe("dönem kısayolları", () => {
  it("ilk kısayol açılış varsayılanıdır — ekran açılınca seçili görünür", () => {
    const today = new Date(2026, 9, 1)
    const [first] = reportRangePresets(today)
    expect(first.key).toBe("son-30")
    expect({ startDate: first.startDate, endDate: first.endDate }).toEqual(defaultReportRange(today))
  })

  it("takvim dönemleri ay/yıl sınırına oturur", () => {
    const byKey = Object.fromEntries(reportRangePresets(new Date(2026, 0, 15)).map((p) => [p.key, p]))
    expect(byKey["bu-ay"]).toMatchObject({ startDate: "2026-01-01", endDate: "2026-01-31" })
    // Ocak'ta "geçen ay" önceki yılın Aralık'ıdır.
    expect(byKey["gecen-ay"]).toMatchObject({ startDate: "2025-12-01", endDate: "2025-12-31" })
    expect(byKey["bu-yil"]).toMatchObject({ startDate: "2026-01-01", endDate: "2026-12-31" })
  })
})
