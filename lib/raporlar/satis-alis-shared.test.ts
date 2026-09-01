import { describe, expect, it } from "vitest"
import { describeLineTotalGap, resolveReportDateFilter } from "./satis-alis-shared"

describe("resolveReportDateFilter", () => {
  it("bitiş günü TAMAMEN kapsanır — saatli fatura düşmez", () => {
    const filter = resolveReportDateFilter("2026-08-01", "2026-08-29")!
    expect(filter.gte?.toISOString()).toBe("2026-08-01T00:00:00.000Z")
    // Ertesi günün başı (dışlayıcı): 29 Ağustos 16:14'teki fatura artık aralıkta.
    expect(filter.lt?.toISOString()).toBe("2026-08-30T00:00:00.000Z")
    expect(filter.lte).toBeUndefined()

    const saatliFatura = new Date("2026-08-29T16:14:58.774Z")
    expect(saatliFatura >= filter.gte!).toBe(true)
    expect(saatliFatura < filter.lt!).toBe(true)
  })

  it("ay sonu ve yıl sonu sınırını doğru taşır", () => {
    expect(resolveReportDateFilter(null, "2026-08-31")!.lt?.toISOString()).toBe("2026-09-01T00:00:00.000Z")
    expect(resolveReportDateFilter(null, "2026-12-31")!.lt?.toISOString()).toBe("2027-01-01T00:00:00.000Z")
    // Artık yıl: 29 Şubat.
    expect(resolveReportDateFilter(null, "2028-02-29")!.lt?.toISOString()).toBe("2028-03-01T00:00:00.000Z")
  })

  it("tek uçlu ve boş aralık", () => {
    expect(resolveReportDateFilter(null, null)).toBeUndefined()
    expect(resolveReportDateFilter("", "")).toBeUndefined()
    expect(resolveReportDateFilter("2026-01-01", null)!.lt).toBeUndefined()
    expect(resolveReportDateFilter(null, "2026-01-31")!.gte).toBeUndefined()
  })

  it("saat taşıyan değer olduğu gibi uygulanır", () => {
    const filter = resolveReportDateFilter(null, "2026-08-29T12:00:00.000Z")!
    expect(filter.lte?.toISOString()).toBe("2026-08-29T12:00:00.000Z")
    expect(filter.lt).toBeUndefined()
  })
})

describe("describeLineTotalGap", () => {
  it("fark yoksa uyarı da yok", () => {
    expect(
      describeLineTotalGap({ totalAmount: 1000, linesTotal: 1000, globalDiscountTotal: 0 })
    ).toBeNull()
    // Kuruş altı sapma gürültüdür.
    expect(
      describeLineTotalGap({ totalAmount: 1000, linesTotal: 1000.004, globalDiscountTotal: 0 })
    ).toBeNull()
  })

  it("farkın tamamı genel iskontoysa 'kalan' cümlesi yazılmaz", () => {
    const gap = describeLineTotalGap({
      totalAmount: 9000, linesTotal: 10000, globalDiscountTotal: 1000,
    })!
    expect(gap.unexplained).toBeCloseTo(0, 2)
    expect(gap.text).toContain("fatura geneline uygulanan iskontodur")
    expect(gap.text).not.toContain("kayıtlı toplamı kalemleriyle uyuşmayan")
  })

  it("iskontoyla açıklanamayan kalanı ayrıca söyler", () => {
    // Ölçülen gerçek durum (Reypo Medya): fark 10.938,79 — 8.956,60'ı genel iskonto.
    const gap = describeLineTotalGap({
      totalAmount: 827341.9, linesTotal: 838280.69, globalDiscountTotal: 8956.6,
    })!
    expect(gap.difference).toBeCloseTo(-10938.79, 2)
    expect(gap.unexplained).toBeCloseTo(-1982.19, 2)
    expect(gap.text).toContain("₺10.938,79")
    expect(gap.text).toContain("₺8.956,60")
    expect(gap.text).toContain("₺1.982,19")
  })
})
