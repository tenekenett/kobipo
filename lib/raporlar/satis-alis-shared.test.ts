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
  const temiz = { roundingTotal: 0, mismatch: { count: 0, amount: 0 } }

  it("fark yoksa uyarı da yok", () => {
    expect(describeLineTotalGap({ totalAmount: 1000, linesTotal: 1000, ...temiz })).toBeNull()
    // Kuruş altı sapma gürültüdür.
    expect(describeLineTotalGap({ totalAmount: 1000, linesTotal: 1000.004, ...temiz })).toBeNull()
  })

  it("farkın tamamı belge yuvarlamasıysa yalnız onu söyler", () => {
    // Ölçülen gerçek durum (Reypo Medya alış, 2026-10-02): fark 122.227 TL, tamamı yuvarlama.
    const gap = describeLineTotalGap({
      totalAmount: 930214.9, linesTotal: 807987.9, roundingTotal: 122227, mismatch: { count: 0, amount: 0 },
    })!
    expect(gap.kurus).toBeCloseTo(0, 2)
    expect(gap.text).toContain("₺122.227,00 belge yuvarlamasıdır")
    expect(gap.text).not.toContain("uyuşmayan")
    expect(gap.text).not.toContain("kuruş")
  })

  it("uyuşmayan belgeleri adediyle, kuruş kalanını ayrıca söyler", () => {
    const gap = describeLineTotalGap({
      totalAmount: 10500.03, linesTotal: 10000, roundingTotal: 0, mismatch: { count: 2, amount: 500 },
    })!
    expect(gap.text).toContain("₺500,00 kayıtlı toplamı kalemleriyle uyuşmayan 2 belgeden gelir")
    expect(gap.kurus).toBeCloseTo(0.03, 2)
    expect(gap.text).toContain("₺0,03 satır başı kuruş yuvarlamasıdır")
  })

  it("fatura altı iskonto artık fark sebebi olarak YAZILMAZ (kalemler belgedeki tutarla gelir)", () => {
    const gap = describeLineTotalGap({ totalAmount: 944182.04, linesTotal: 944182, ...temiz })!
    expect(gap.text).not.toContain("iskonto")
    expect(gap.text).toContain("₺0,04 satır başı kuruş yuvarlamasıdır")
  })
})
