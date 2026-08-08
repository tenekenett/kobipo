/**
 * Tatil eşleşmesinin testleri.
 *
 * `recurring` bayrağı burada asıl risk: yanlış çalışırsa kayan bir bayram
 * (Ramazan/Kurban) gelecek yıl YANLIŞ GÜNE düşer ve o güne vardiya yazan
 * kullanıcı hiçbir uyarı almaz. Ekranda görünen tek şey doğru gibi duran bir
 * takvimdir; bu yüzden kural testle sabitleniyor.
 */

import { describe, expect, it } from "vitest"
import { fixedHolidaysForYear, holidayMap, holidayOn, type Holiday } from "./tatil"

const holiday = (over: Partial<Holiday>): Holiday => ({
  id: "h1",
  name: "Tatil",
  date: "2026-01-01",
  recurring: false,
  halfDayFrom: null,
  ...over,
})

describe("holidayOn", () => {
  it("tekrar etmeyen tatil yalnız kendi gününde eşleşir", () => {
    const list = [holiday({ date: "2026-03-20", name: "Ramazan Bayramı" })]
    expect(holidayOn(list, "2026-03-20")?.name).toBe("Ramazan Bayramı")
    expect(holidayOn(list, "2026-03-21")).toBeNull()
    // Kayan bayram: gelecek yıl aynı güne DÜŞMEZ, eşleşmemeli.
    expect(holidayOn(list, "2027-03-20")).toBeNull()
  })

  it("tekrar eden tatilde yıl yok sayılır", () => {
    const list = [holiday({ date: "2026-01-01", recurring: true, name: "Yılbaşı" })]
    expect(holidayOn(list, "2030-01-01")?.name).toBe("Yılbaşı")
    expect(holidayOn(list, "2030-01-02")).toBeNull()
  })

  it("hiç tatil yoksa null döner", () => {
    expect(holidayOn([], "2026-08-07")).toBeNull()
  })

  it("yarım gün bilgisini taşır", () => {
    const list = [holiday({ date: "2026-10-28", recurring: true, halfDayFrom: 780 })]
    expect(holidayOn(list, "2026-10-28")?.halfDayFrom).toBe(780)
  })
})

describe("holidayMap", () => {
  it("yalnız tatil olan günleri haritalar", () => {
    const list = [holiday({ date: "2026-08-30", recurring: true, name: "Zafer Bayramı" })]
    const map = holidayMap(list, ["2026-08-29", "2026-08-30", "2026-08-31"])
    expect(map.size).toBe(1)
    expect(map.get("2026-08-30")?.name).toBe("Zafer Bayramı")
  })
})

describe("fixedHolidaysForYear", () => {
  it("verilen yılın sabit tatillerini üretir", () => {
    const list = fixedHolidaysForYear(2026)
    expect(list.every((h) => h.date.startsWith("2026-"))).toBe(true)
    expect(list.every((h) => h.recurring)).toBe(true)
    expect(list.map((h) => h.date)).toContain("2026-01-01")
    expect(list.map((h) => h.date)).toContain("2026-10-29")
  })

  it("arife yarım gün olarak gelir", () => {
    const arife = fixedHolidaysForYear(2026).find((h) => h.date === "2026-10-28")
    expect(arife?.halfDayFrom).toBe(13 * 60)
  })

  it("kayan bayramları İÇERMEZ", () => {
    // Ramazan/Kurban ay takvimine göre kaydığı için sabit listeden üretilemez;
    // listeye eklenmeleri sessizce yanlış tarih üretirdi.
    const names = fixedHolidaysForYear(2026).map((h) => h.name.toLowerCase())
    expect(names.some((n) => n.includes("ramazan") || n.includes("kurban"))).toBe(false)
  })
})
