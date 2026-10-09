// Kasa/banka hareketinin türü (hareket-turu.ts): yazma kuralı ve kâra girmeyen türler.

import { describe, expect, it } from "vitest"
import { KARA_GIREN_TUR_SQL, hareketTuruAdi, hareketTuruHatasi } from "./hareket-turu"

const g = (x: Partial<Parameters<typeof hareketTuruHatasi>[0]>) =>
  hareketTuruHatasi({ purpose: null, tip: "EXPENSE", employeeId: null, cariBagli: false, faturaBagli: false, ...x })

describe("hareket türü", () => {
  it("türsüz hareket serbest; çalışan yalnız avansta", () => {
    expect(g({})).toBe(null)
    expect(g({ employeeId: "e1" })).toMatch(/avans/)
  })
  it("yön kuralı: SGK yalnız çıkış, kredi iki yön", () => {
    expect(g({ purpose: "SGK", tip: "INCOME" })).toMatch(/para girişi/)
    expect(g({ purpose: "LOAN", tip: "INCOME" })).toBe(null)
    expect(g({ purpose: "LOAN", tip: "EXPENSE" })).toBe(null)
  })
  it("türlü hareket cariye ya da faturaya bağlanamaz", () => {
    expect(g({ purpose: "TAX", cariBagli: true })).toMatch(/bağlanamaz/)
    expect(g({ purpose: "KDV", faturaBagli: true })).toMatch(/bağlanamaz/)
  })
  it("avans çalışan ister", () => {
    expect(g({ purpose: "ADVANCE" })).toMatch(/çalışanı seçin/)
    expect(g({ purpose: "ADVANCE", employeeId: "e1" })).toBe(null)
  })
  it("bilinmeyen tür reddedilir", () => {
    expect(g({ purpose: "XYZ" })).toMatch(/Geçersiz/)
  })
  it("ad yöne göre", () => {
    expect(hareketTuruAdi("LOAN", "INCOME")).toBe("Kredi kullanımı")
    expect(hareketTuruAdi("LOAN", "EXPENSE")).toBe("Kredi anapara ödemesi")
    expect(hareketTuruAdi(null, "EXPENSE")).toBe(null)
  })
  it("kâra girmeyen türlerin SQL süzgeci", () => {
    expect(KARA_GIREN_TUR_SQL("t")).toBe(`(t."purpose" IS NULL OR t."purpose" NOT IN ('KDV', 'LOAN', 'PARTNER'))`)
  })
})
