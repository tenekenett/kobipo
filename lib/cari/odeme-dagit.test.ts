// TAHSİLAT/ÖDEME DAĞITIMI — tek tutar, birden çok fatura, eskiden yeniye.
//
// Kural sunucu ve istemcide ortak; burada kuruş aritmetiği ve artan tutar
// (avans) davranışı sabitlenir.

import { describe, expect, it } from "vitest"
import { acikToplam, odemeDagit } from "./odeme-dagit"

const faturalar = [
  { id: "a", openAmount: 100 },
  { id: "b", openAmount: 250.5 },
  { id: "c", openAmount: 49.5 },
]

describe("odemeDagit", () => {
  it("tutar verilen sırayla dağıtılır, artan kalmaz", () => {
    const r = odemeDagit(400, faturalar)
    expect(r.allocations).toEqual([
      { invoiceId: "a", amount: 100 },
      { invoiceId: "b", amount: 250.5 },
      { invoiceId: "c", amount: 49.5 },
    ])
    expect(r.allocated).toBe(400)
    expect(r.remainder).toBe(0)
  })

  it("yetmeyen tutar ilk faturaları kapatır, sonuncuyu kısmen öder", () => {
    const r = odemeDagit(300, faturalar)
    expect(r.allocations).toEqual([
      { invoiceId: "a", amount: 100 },
      { invoiceId: "b", amount: 200 },
    ])
    expect(r.remainder).toBe(0)
  })

  it("fazla tutar avans olarak artar", () => {
    const r = odemeDagit(450.25, faturalar)
    expect(r.allocated).toBe(400)
    expect(r.remainder).toBe(50.25)
  })

  it("kuruş toplamı ikilik sapmaya uğramaz", () => {
    // 0,1 + 0,2 = 0,30000000000000004 — kuruş tam sayı olduğu için tam tutar.
    const r = odemeDagit(0.3, [
      { id: "x", openAmount: 0.1 },
      { id: "y", openAmount: 0.2 },
    ])
    expect(r.allocations.map((a) => a.amount)).toEqual([0.1, 0.2])
    expect(r.remainder).toBe(0)
  })

  it("açık tutarı olmayan fatura atlanır, sıfır/negatif tutar hiçbir şey yazmaz", () => {
    expect(odemeDagit(10, [{ id: "z", openAmount: 0 }, { id: "a", openAmount: 5 }]).allocations).toEqual([
      { invoiceId: "a", amount: 5 },
    ])
    expect(odemeDagit(0, faturalar).allocations).toEqual([])
    expect(odemeDagit(-5, faturalar).remainder).toBe(0)
  })

  it("acikToplam seçili faturaların açık toplamını kuruşla verir", () => {
    expect(acikToplam(faturalar)).toBe(400)
    expect(acikToplam([{ id: "x", openAmount: 0.1 }, { id: "y", openAmount: 0.2 }])).toBe(0.3)
  })
})
