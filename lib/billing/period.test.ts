import { describe, expect, it } from "vitest"
import { addDays, addMonths, addYears, resolveGrantWindow } from "@/lib/billing/period"

const NOW = new Date(2026, 7, 27, 12, 0, 0) // 27 Ağustos 2026, öğle
const at = (y: number, m: number, d: number) => new Date(y, m, d, 12, 0, 0)

describe("addMonths", () => {
  it("ay sonunda TAŞMAZ, ayın son gününe kırpar", () => {
    // Ham setMonth 31 Ocak + 1 ay = 3 Mart üretir; bu, ay sonunda ödeyen müşteriye
    // sessizce 2-3 gün fazla vermek demek.
    const end = addMonths(at(2026, 0, 31), 1)
    expect(end.getMonth()).toBe(1)
    expect(end.getDate()).toBe(28)
  })

  it("artık yılda 29 Şubat'a kırpar", () => {
    const end = addMonths(at(2028, 0, 31), 1)
    expect(end.getDate()).toBe(29)
  })

  it("normal ayda gün korunur", () => {
    const end = addMonths(at(2026, 7, 15), 1)
    expect(end.getMonth()).toBe(8)
    expect(end.getDate()).toBe(15)
  })

  it("yıl sınırını aşar", () => {
    const end = addMonths(at(2026, 11, 15), 2)
    expect(end.getFullYear()).toBe(2027)
    expect(end.getMonth()).toBe(1)
  })
})

describe("addYears", () => {
  it("29 Şubat artık olmayan yılda 28'e kırpılır", () => {
    const end = addYears(at(2028, 1, 29), 1)
    expect(end.getMonth()).toBe(1)
    expect(end.getDate()).toBe(28)
  })
})

describe("resolveGrantWindow", () => {
  const base = { now: NOW, currentStart: null as Date | null, currentEnd: null as Date | null }

  it("süre verilmezse reddeder", () => {
    const r = resolveGrantWindow({ ...base, mode: "extend", duration: {} })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.code).toBe("NO_DURATION")
  })

  it("iki süre birden verilirse reddeder", () => {
    const r = resolveGrantWindow({ ...base, mode: "extend", duration: { days: 5, months: 1 } })
    expect(r.ok === false && r.code).toBe("AMBIGUOUS_DURATION")
  })

  it("extend: dönem GELECEKTEYSE onun üstüne ekler", () => {
    const r = resolveGrantWindow({
      ...base,
      mode: "extend",
      currentEnd: at(2026, 9, 1), // 1 Ekim
      duration: { months: 1 },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.window.periodEnd.getMonth()).toBe(10) // Kasım
    expect(r.window.basedOn).toBe("period")
  })

  it("extend: dönem GEÇMİŞTE kalmışsa bugünden başlar", () => {
    // Geçmişten uzatmak, "1 ay verdim" denen hesaba fiilen birkaç gün vermek olurdu.
    const r = resolveGrantWindow({
      ...base,
      mode: "extend",
      currentEnd: at(2026, 5, 1), // 1 Haziran, geçmiş
      duration: { months: 1 },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.window.periodEnd.getMonth()).toBe(8) // Eylül
    expect(r.window.basedOn).toBe("now")
  })

  it("set: dönem gelecekte olsa bile bugünden yazar (kalan gün silinir)", () => {
    const r = resolveGrantWindow({
      ...base,
      mode: "set",
      currentEnd: at(2027, 0, 1),
      duration: { months: 1 },
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.window.periodEnd.getMonth()).toBe(8) // Eylül — Ocak'tan değil bugünden
    expect(r.window.periodStart.getTime()).toBe(NOW.getTime())
  })

  it("extend mevcut dönem başlangıcını KORUR", () => {
    const start = at(2026, 6, 1)
    const r = resolveGrantWindow({
      ...base,
      mode: "extend",
      currentStart: start,
      currentEnd: at(2026, 9, 1),
      duration: { days: 10 },
    })
    expect(r.ok && r.window.periodStart.getTime()).toBe(start.getTime())
  })

  it("untilDate mutlaktır — mode süreyi etkilemez", () => {
    const until = at(2027, 2, 15)
    for (const mode of ["extend", "set"] as const) {
      const r = resolveGrantWindow({ ...base, mode, duration: { untilDate: until } })
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.window.periodEnd.getTime()).toBe(until.getTime())
      expect(r.window.basedOn).toBe("date")
    }
  })

  it("geçmişe biten tarih reddedilir", () => {
    const r = resolveGrantWindow({
      ...base,
      mode: "set",
      duration: { untilDate: at(2026, 0, 1) },
    })
    expect(r.ok === false && r.code).toBe("PAST_END")
  })

  it("sınır dışı gün/ay reddedilir", () => {
    expect(resolveGrantWindow({ ...base, mode: "set", duration: { days: 0 } }).ok).toBe(false)
    expect(resolveGrantWindow({ ...base, mode: "set", duration: { days: 4000 } }).ok).toBe(false)
    expect(resolveGrantWindow({ ...base, mode: "set", duration: { months: 0 } }).ok).toBe(false)
    expect(resolveGrantWindow({ ...base, mode: "set", duration: { months: 200 } }).ok).toBe(false)
    expect(resolveGrantWindow({ ...base, mode: "set", duration: { days: 1.5 } }).ok).toBe(false)
  })

  it("addedDays bugünden itibaren sayılır", () => {
    const r = resolveGrantWindow({ ...base, mode: "set", duration: { days: 30 } })
    expect(r.ok && r.window.addedDays).toBe(30)
  })

  it("addDays gün ekler", () => {
    expect(addDays(at(2026, 7, 27), 5).getDate()).toBe(1)
  })
})
