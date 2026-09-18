import { describe, expect, it } from "vitest"
import {
  BadRequestError,
  parseDateParam,
  parseDateValue,
  parseIntParam,
  parseMonthParam,
  parseYearParam,
} from "./query-params"

describe("parseDateParam", () => {
  it("boş/yok → null", () => {
    expect(parseDateParam(null, "startDate")).toBeNull()
    expect(parseDateParam(undefined, "startDate")).toBeNull()
    expect(parseDateParam("   ", "startDate")).toBeNull()
  })
  it("geçerli tarihi olduğu gibi döndürür", () => {
    expect(parseDateParam("2026-01-31", "startDate")).toBe("2026-01-31")
    expect(parseDateParam(" 2026-09-18T13:47:24.354Z ", "endDate")).toBe("2026-09-18T13:47:24.354Z")
  })
  it("geçersiz tarihte BadRequestError — 500 DEĞİL", () => {
    // "-1"/"0" JS'te GEÇERLİ Date üretir (2000/1999) ama tarih süzgeci ISO ister →
    // reddedilmeli; downstream `${endDate}T23:59:59.999` bunlarda patlıyordu.
    for (const bad of ["abc", "2026-13-45", "'", "<script>", "999999999999", "../../etc/passwd", "-1", "0", "5", "2000"]) {
      expect(() => parseDateParam(bad, "startDate"), bad).toThrow(BadRequestError)
    }
  })
  it("parseDateValue geçerliyi Date'e çevirir, yoksa null", () => {
    expect(parseDateValue(null, "x")).toBeNull()
    expect(parseDateValue("2026-01-31", "x")?.getUTCFullYear()).toBe(2026)
  })
})

describe("parseIntParam / year / month", () => {
  it("boş → null", () => {
    expect(parseIntParam(null, "year")).toBeNull()
    expect(parseYearParam("")).toBeNull()
    expect(parseMonthParam(undefined)).toBeNull()
  })
  it("geçerli değerler", () => {
    expect(parseYearParam("2026")).toBe(2026)
    expect(parseMonthParam("12")).toBe(12)
    expect(parseIntParam("42", "n")).toBe(42)
  })
  it("sayı olmayan → 400", () => {
    expect(() => parseIntParam("abc", "year")).toThrow(BadRequestError)
    expect(() => parseYearParam("2026-13")).toThrow(BadRequestError)
  })
  it("aralık dışı → 400 (eski hâlde 500 veren değerler)", () => {
    expect(() => parseYearParam("999999999999")).toThrow(BadRequestError)
    expect(() => parseYearParam("-1")).toThrow(BadRequestError)
    expect(() => parseYearParam("1999")).toThrow(BadRequestError)
    expect(() => parseMonthParam("0")).toThrow(BadRequestError)
    expect(() => parseMonthParam("13")).toThrow(BadRequestError)
  })
})
