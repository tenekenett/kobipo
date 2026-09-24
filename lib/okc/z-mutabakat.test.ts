import { describe, expect, it } from "vitest"
import {
  compareZ,
  istanbulDayStart,
  kobipoMethodToZ,
  receiptGrossByRate,
  receiptPaymentsByMethod,
  resolveZWindow,
  zBusinessRange,
  type MutabakatReceipt,
} from "@/lib/okc/z-mutabakat"

const at = (iso: string) => new Date(iso)

function receipt(partial: Partial<MutabakatReceipt> & Pick<MutabakatReceipt, "total" | "lines">): MutabakatReceipt {
  return {
    id: partial.id ?? "r1",
    invoiceNo: partial.invoiceNo ?? "FIS-1",
    date: partial.date ?? at("2026-09-24T10:00:00+03:00"),
    globalDiscount: 0,
    globalCharge: 0,
    payments: [],
    ...partial,
  }
}

describe("istanbulDayStart / resolveZWindow", () => {
  it("İstanbul gününün başını UTC olarak verir", () => {
    // 24 Eylül 01:30 İstanbul = 23 Eylül 22:30 UTC → gün başı 24 Eylül 00:00 +03
    expect(istanbulDayStart(at("2026-09-23T22:30:00Z")).toISOString()).toBe("2026-09-23T21:00:00.000Z")
  })

  it("önceki Z varsa pencere onun anından başlar (gece yarısını aşan gün tek parça)", () => {
    const w = resolveZWindow(at("2026-09-25T02:10:00+03:00"), at("2026-09-24T02:05:00+03:00"))
    expect(w.first).toBe(false)
    expect(w.start.toISOString()).toBe(at("2026-09-24T02:05:00+03:00").toISOString())
  })

  it("ilk Z'de pencere o günün başından açılır", () => {
    const w = resolveZWindow(at("2026-09-24T23:00:00+03:00"), null)
    expect(w.first).toBe(true)
    expect(w.start.toISOString()).toBe(at("2026-09-24T00:00:00+03:00").toISOString())
  })

  it("gün sonu listesinde 06:00'dan önce alınan Z önceki güne sayılır", () => {
    const r = zBusinessRange(at("2026-09-24T00:00:00+03:00"), at("2026-09-24T23:59:59+03:00"))
    const z0200 = at("2026-09-25T02:00:00+03:00")
    const z0700 = at("2026-09-25T07:00:00+03:00")
    expect(z0200 >= r.start && z0200 <= r.end).toBe(true)
    expect(z0700 >= r.start && z0700 <= r.end).toBe(false)
  })

  it("önceki Z bu Z'den sonra görünüyorsa (bozuk veri) ilk Z gibi davranır", () => {
    const w = resolveZWindow(at("2026-09-24T23:00:00+03:00"), at("2026-09-25T01:00:00+03:00"))
    expect(w.first).toBe(true)
  })
})

describe("receiptGrossByRate", () => {
  it("iskontosuz fişte oran başına brüt = net × (1 + oran)", () => {
    const r = receipt({
      total: 130,
      lines: [
        { vatRate: 10, net: 100 },
        { vatRate: 20, net: 16.6666666667 },
      ],
    })
    const g = receiptGrossByRate(r)
    expect(g.get(10)).toBeCloseTo(110, 6)
    expect(g.get(20)).toBeCloseTo(20, 6)
  })

  it("genel iskonto oranlara orantılı dağılır ve toplam fiş tutarını verir", () => {
    // 100 net %10 + 100 net %20, %10 genel iskonto → net 90 + 90 → brüt 99 + 108 = 207
    const r = receipt({
      total: 207,
      globalDiscount: 20,
      lines: [
        { vatRate: 10, net: 100 },
        { vatRate: 20, net: 100 },
      ],
    })
    const g = receiptGrossByRate(r)
    expect(g.get(10)).toBeCloseTo(99, 6)
    expect(g.get(20)).toBeCloseTo(108, 6)
    expect([...g.values()].reduce((s, v) => s + v, 0)).toBeCloseTo(207, 6)
  })

  it("kuruş yuvarlaması oranlara emilir, toplam fişi tutar", () => {
    const r = receipt({ total: 33.34, lines: [{ vatRate: 20, net: 27.7777 }] })
    expect(receiptGrossByRate(r).get(20)).toBeCloseTo(33.34, 6)
  })
})

describe("kobipoMethodToZ / receiptPaymentsByMethod", () => {
  it("yöntemleri eşler; bakiye kapama tahsilat sayılmaz", () => {
    expect(kobipoMethodToZ("CASH")).toBe("CASH")
    expect(kobipoMethodToZ("MEAL_CARD")).toBe("MEAL_CARD")
    expect(kobipoMethodToZ("BANK_TRANSFER")).toBe("OTHER")
    expect(kobipoMethodToZ("WRITE_OFF")).toBeNull()
  })

  it("ödenmeyen kalan ve Z'den sonraki tahsilat açık hesaptır", () => {
    const z = at("2026-09-24T23:00:00+03:00")
    const r = receipt({
      total: 300,
      lines: [{ vatRate: 10, net: 272.73 }],
      payments: [
        { method: "CREDIT_CARD", amount: 100, date: at("2026-09-24T12:00:00+03:00") },
        { method: "CASH", amount: 50, date: at("2026-09-25T09:00:00+03:00") },
      ],
    })
    const p = receiptPaymentsByMethod(r, z)
    expect(p.get("CREDIT_CARD")).toBe(100)
    expect(p.get("CASH")).toBeUndefined()
    expect(p.get("OPEN_ACCOUNT")).toBe(200)
  })
})

describe("compareZ", () => {
  const until = at("2026-09-24T23:00:00+03:00")
  const receipts = [
    receipt({
      id: "a",
      total: 110,
      lines: [{ vatRate: 10, net: 100 }],
      payments: [{ method: "CASH", amount: 110, date: at("2026-09-24T12:00:00+03:00") }],
    }),
    receipt({
      id: "b",
      total: 120,
      lines: [{ vatRate: 20, net: 100 }],
      payments: [{ method: "CREDIT_CARD", amount: 120, date: at("2026-09-24T13:00:00+03:00") }],
    }),
  ]

  it("birebir tutan Z'de her eksen yeşil", () => {
    const m = compareZ(
      {
        grossTotal: 230,
        receiptCount: 2,
        vatLines: [
          { rate: 10, base: 100, vat: 10 },
          { rate: 20, base: 100, vat: 20 },
        ],
        paymentLines: [
          { method: "CASH", amount: 110 },
          { method: "CREDIT_CARD", amount: 120 },
        ],
      },
      receipts,
      until,
    )
    expect(m.ok).toBe(true)
    expect(m.total.diff).toBe(0)
    expect(m.vat.map((r) => r.diff)).toEqual([0, 0])
    expect(m.payments.map((r) => r.key)).toEqual(["pay:CASH", "pay:CREDIT_CARD"])
  })

  it("1 kuruşluk fark bile yakalanır ve doğru eksende görünür", () => {
    const m = compareZ(
      {
        grossTotal: 230.01,
        receiptCount: 2,
        vatLines: [
          { rate: 10, base: 100, vat: 10.01 },
          { rate: 20, base: 100, vat: 20 },
        ],
        paymentLines: [
          { method: "CASH", amount: 110.01 },
          { method: "CREDIT_CARD", amount: 120 },
        ],
      },
      receipts,
      until,
    )
    expect(m.ok).toBe(false)
    expect(m.total.diff).toBe(0.01)
    expect(m.vat.find((r) => r.key === "vat:10")?.ok).toBe(false)
    expect(m.vat.find((r) => r.key === "vat:20")?.ok).toBe(true)
    expect(m.payments.find((r) => r.key === "pay:CASH")?.diff).toBe(0.01)
  })

  it("Z'de girilmeyen eksen karşılaştırılmaz ama Kobipo kırılımı görünür", () => {
    const m = compareZ({ grossTotal: 230, receiptCount: null, vatLines: [], paymentLines: [] }, receipts, until)
    expect(m.ok).toBe(true)
    expect(m.vat.every((r) => r.z === null && r.diff === null)).toBe(true)
    expect(m.vat.map((r) => r.kobipo)).toEqual([110, 120])
    expect(m.receiptCount.diff).toBeNull()
  })

  it("Z'de olmayan oran, eksen girildiyse 0 sayılır ve fark verir", () => {
    const m = compareZ(
      { grossTotal: 230, receiptCount: 2, vatLines: [{ rate: 10, base: 209.09, vat: 20.91 }], paymentLines: [] },
      receipts,
      until,
    )
    const r20 = m.vat.find((r) => r.key === "vat:20")!
    expect(r20.z).toBe(0)
    expect(r20.diff).toBe(-120)
    expect(m.ok).toBe(false)
  })

  it("fiş adedi farkı genel sonucu kırmızıya çevirir", () => {
    const m = compareZ({ grossTotal: 230, receiptCount: 3, vatLines: [], paymentLines: [] }, receipts, until)
    expect(m.receiptCount.diff).toBe(1)
    expect(m.ok).toBe(false)
  })

  it("genel iskontolu fiş varsa bayrak kalkar", () => {
    const m = compareZ(
      { grossTotal: 99, receiptCount: 1, vatLines: [], paymentLines: [] },
      [receipt({ total: 99, globalDiscount: 10, lines: [{ vatRate: 10, net: 100 }] })],
      until,
    )
    expect(m.hasAllocatedDiscount).toBe(true)
  })
})
