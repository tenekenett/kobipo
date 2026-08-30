import { describe, expect, it } from "vitest"
import { parseMovementDate, toDateInputValue } from "./movement-date"

const NOW = new Date(2026, 7, 30, 14, 35, 12) // 30 Ağustos 2026, 14:35 (yerel)

describe("parseMovementDate", () => {
  it("boş girdide tarih yazılmaz (createdAt varsayılanına düşsün)", () => {
    expect(parseMovementDate(undefined, NOW)).toEqual({ ok: true, date: null })
    expect(parseMovementDate(null, NOW)).toEqual({ ok: true, date: null })
    expect(parseMovementDate("", NOW)).toEqual({ ok: true, date: null })
    expect(parseMovementDate("   ", NOW)).toEqual({ ok: true, date: null })
  })

  it("geçmiş gün YEREL gün ortasına sabitlenir — saat dilimi günü kaydırmasın", () => {
    const result = parseMovementDate("2026-08-29", NOW)
    expect(result.ok).toBe(true)
    const date = (result as { date: Date }).date
    expect(date.getFullYear()).toBe(2026)
    expect(date.getMonth()).toBe(7)
    expect(date.getDate()).toBe(29)
    expect(date.getHours()).toBe(12)
  })

  it("bugün seçilirse saat ŞİMDİ olur (defterdeki sıra giriş sırası kalsın)", () => {
    const result = parseMovementDate("2026-08-30", NOW)
    expect(result).toEqual({ ok: true, date: NOW })
  })

  it("ileri tarih reddedilir", () => {
    expect(parseMovementDate("2026-08-31", NOW)).toEqual({
      ok: false,
      error: "İleri tarihli stok hareketi yazılamaz",
    })
  })

  it("takvimde olmayan gün ve çöp metin reddedilir", () => {
    expect(parseMovementDate("2026-02-31", NOW).ok).toBe(false)
    expect(parseMovementDate("dün", NOW).ok).toBe(false)
    expect(parseMovementDate(42, NOW).ok).toBe(false)
  })

  it("çok eski tarih reddedilir (yazım hatası)", () => {
    expect(parseMovementDate("0202-08-29", NOW).ok).toBe(false)
  })

  it("tam ISO damgası da kabul edilir", () => {
    const iso = new Date(2026, 7, 29, 9, 15).toISOString()
    const result = parseMovementDate(iso, NOW)
    expect(result.ok).toBe(true)
    expect((result as { date: Date }).date.getDate()).toBe(29)
  })
})

describe("toDateInputValue", () => {
  it("yerel günü verir (toISOString UTC'ye kaydırırdı)", () => {
    expect(toDateInputValue(new Date(2026, 0, 5, 1, 30))).toBe("2026-01-05")
    expect(toDateInputValue(null)).toBe("")
    expect(toDateInputValue("çöp")).toBe("")
  })
})
