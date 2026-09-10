import { describe, expect, it } from "vitest"
import {
  attendanceCalendarEnabled,
  wrongCalendarScreen,
  defaultUsesShifts,
  employeeUsesShifts,
  flatEmployees,
  normalizeMode,
  shiftCalendarEnabled,
  shiftEmployees,
} from "@/lib/personel/kip"

const ekip = [
  { id: "vardiyali", usesShifts: true },
  { id: "sabit", usesShifts: false },
  { id: "secilmemis", usesShifts: null },
]

describe("employeeUsesShifts", () => {
  it("personel kartındaki seçim firmanın düzenini ezer", () => {
    expect(employeeUsesShifts({ usesShifts: false }, "SHIFT")).toBe(false)
    expect(employeeUsesShifts({ usesShifts: true }, "FLAT")).toBe(true)
  })

  it("seçim yoksa firmanın düzenine düşer", () => {
    expect(employeeUsesShifts({ usesShifts: null }, "SHIFT")).toBe(true)
    expect(employeeUsesShifts({ usesShifts: null }, "FLAT")).toBe(false)
  })

  it("karma firmada seçilmemiş personel VARDİYALI sayılır", () => {
    // Devam tarafında varsayılan "çalıştı"dır: yanlış tarafa düşen kişi sessizce
    // 22 gün çalışmış gibi bordroya girerdi. Güvenli taraf veri uydurmayan taraf.
    expect(employeeUsesShifts({ usesShifts: null }, "MIXED")).toBe(true)
    expect(defaultUsesShifts("MIXED")).toBe(true)
  })

  it("firma henüz cevap vermemişse vardiya varsayılandır", () => {
    expect(employeeUsesShifts({ usesShifts: null }, null)).toBe(true)
  })
})

describe("takvim listeleri", () => {
  it("bir çalışan aynı anda İKİ listede birden olamaz", () => {
    for (const mode of ["SHIFT", "FLAT", "MIXED", null] as const) {
      const vardiya = shiftEmployees(ekip, mode).map((e) => e.id)
      const devam = flatEmployees(ekip, mode).map((e) => e.id)
      expect(vardiya.filter((id) => devam.includes(id)), `kesişim (${mode})`).toEqual([])
      // Kimse de listelerin DIŞINDA kalmaz: kalsaydı o kişinin ayı hiçbir
      // özete girmez, bordrosu boş çıkardı.
      expect([...vardiya, ...devam].sort()).toEqual(ekip.map((e) => e.id).sort())
    }
  })

  it("karma firmada ekip iki takvime dağılır", () => {
    expect(shiftEmployees(ekip, "MIXED").map((e) => e.id)).toEqual(["vardiyali", "secilmemis"])
    expect(flatEmployees(ekip, "MIXED").map((e) => e.id)).toEqual(["sabit"])
  })

  it("vardiyalı firmada da personel bazlı istisna geçerlidir", () => {
    expect(flatEmployees(ekip, "SHIFT").map((e) => e.id)).toEqual(["sabit"])
  })
})

describe("takvim görünürlüğü", () => {
  it("SHIFT yalnız vardiya, FLAT yalnız devam, MIXED ikisini birden açar", () => {
    expect([shiftCalendarEnabled("SHIFT"), attendanceCalendarEnabled("SHIFT")]).toEqual([true, false])
    expect([shiftCalendarEnabled("FLAT"), attendanceCalendarEnabled("FLAT")]).toEqual([false, true])
    expect([shiftCalendarEnabled("MIXED"), attendanceCalendarEnabled("MIXED")]).toEqual([true, true])
  })

  it("cevap verilmemiş firmada bugünkü davranış korunur (yalnız vardiya)", () => {
    expect([shiftCalendarEnabled(null), attendanceCalendarEnabled(null)]).toEqual([true, false])
  })
})

describe("normalizeMode", () => {
  it("bozuk değeri 'henüz sorulmadı'ya indirger", () => {
    expect(normalizeMode("SHIFT")).toBe("SHIFT")
    expect(normalizeMode("shift")).toBeNull()
    expect(normalizeMode(true)).toBeNull()
    expect(normalizeMode(null)).toBeNull()
  })
})

describe("wrongCalendarScreen", () => {
  it("cevap verilmemiş firmada (ve liste yüklenmeden) uyarı ÇIKMAZ", () => {
    // Ekranda görülen hata buydu: devam ekranı için attendanceCalendarEnabled(null)
    // false döndüğü için null elenmeyince "firmanız vardiyalı" uyarısı çıkıyordu.
    expect(wrongCalendarScreen("devam", null)).toBe(false)
    expect(wrongCalendarScreen("vardiya", null)).toBe(false)
    expect(wrongCalendarScreen("devam", undefined)).toBe(false)
  })

  it("karma işletmede iki ekran da doğru ekrandır", () => {
    expect(wrongCalendarScreen("vardiya", "MIXED")).toBe(false)
    expect(wrongCalendarScreen("devam", "MIXED")).toBe(false)
  })

  it("kip dışında kalan ekranda uyarı çıkar", () => {
    expect(wrongCalendarScreen("devam", "SHIFT")).toBe(true)
    expect(wrongCalendarScreen("vardiya", "FLAT")).toBe(true)
  })
})
