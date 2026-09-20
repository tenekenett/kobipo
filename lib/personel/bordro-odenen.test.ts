// BORDRODA ÖDENEN TUTAR — net ile ödenen ayrışabilir.
//
// paidAmount 2026-09-20'de eklendi; öncesinde ödenen her kayıt net kadar
// sayılmalı (kolon NULL). Ödenmemiş bordronun "ödenen"i yoktur: özet kart
// "Ödenen" toplamına PENDING net girseydi kasadan çıkmamış para ödendi görünürdü.

import { describe, expect, it } from "vitest"
import { odenenNettenFarkli, odenenTutar } from "./bordro-odenen"

describe("bordro ödenen tutar", () => {
  it("PAID ve paidAmount dolu → paidAmount", () => {
    expect(odenenTutar({ status: "PAID", netSalary: 30_000, paidAmount: 28_500 })).toBe(28_500)
  })

  it("PAID ve paidAmount NULL (eski kayıt) → net", () => {
    expect(odenenTutar({ status: "PAID", netSalary: "30000.00", paidAmount: null })).toBe(30_000)
    expect(odenenTutar({ status: "PAID", netSalary: 30_000 })).toBe(30_000)
  })

  it("PENDING → 0, paidAmount yazılı olsa bile", () => {
    expect(odenenTutar({ status: "PENDING", netSalary: 30_000, paidAmount: 30_000 })).toBe(0)
  })

  it("netten sapma yalnız PAID kayıtta ve kuruş üstünde raporlanır", () => {
    expect(odenenNettenFarkli({ status: "PAID", netSalary: 30_000, paidAmount: 28_500 })).toBe(true)
    expect(odenenNettenFarkli({ status: "PAID", netSalary: 30_000, paidAmount: "30000.004" })).toBe(false)
    expect(odenenNettenFarkli({ status: "PAID", netSalary: 30_000, paidAmount: null })).toBe(false)
    expect(odenenNettenFarkli({ status: "PENDING", netSalary: 30_000, paidAmount: 1 })).toBe(false)
  })
})
