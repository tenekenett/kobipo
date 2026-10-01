import { describe, expect, it } from "vitest"
import {
  invoiceLineToRow,
  invoiceStatusTag,
  invoiceTypeLabel,
  mergeTransactions,
  paymentLabelOf,
  waybillLineToRow,
  type InvoiceLineSource,
} from "./urun-islemleri-kural"

const invoiceLine = (over: Partial<InvoiceLineSource["invoice"]> = {}, line: Partial<InvoiceLineSource> = {}): InvoiceLineSource => ({
  id: "k1",
  quantity: 10,
  unit: "ADET",
  totalAmount: 1193.75,
  ...line,
  invoice: {
    id: "f1",
    invoiceNo: "SAT-2026-0001",
    eDocumentNo: null,
    date: new Date("2026-09-30T00:00:00.000Z"),
    type: "SALES",
    returnKind: null,
    invoiceType: "E_ARCHIVE",
    isReceipt: false,
    status: "SENT",
    currency: "TRY",
    totalAmount: 1193.75,
    customer: { id: "c1", slug: "acme", name: "ACME Ltd." },
    supplier: null,
    payments: [],
    waybills: [],
    ...over,
  },
})

describe("belge türü ve yön", () => {
  it("satış, alış, iki yönde iade ve fiş ayrı adlanır", () => {
    expect(invoiceTypeLabel({ type: "SALES", returnKind: null, isReceipt: false })).toBe("Satış Faturası")
    expect(invoiceTypeLabel({ type: "PURCHASE", returnKind: null, isReceipt: false })).toBe("Alış Faturası")
    expect(invoiceTypeLabel({ type: "RETURN", returnKind: "SALES", isReceipt: false })).toBe("Satış İadesi")
    expect(invoiceTypeLabel({ type: "RETURN", returnKind: "PURCHASE", isReceipt: false })).toBe("Alış İadesi")
    expect(invoiceTypeLabel({ type: "SALES", returnKind: null, isReceipt: true })).toBe("Satış Fişi")
  })

  it("alış ve satış iadesi malı içeri alır", () => {
    expect(invoiceLineToRow(invoiceLine({ type: "PURCHASE" })).direction).toBe("IN")
    expect(invoiceLineToRow(invoiceLine({ type: "RETURN", returnKind: "SALES" })).direction).toBe("IN")
    expect(invoiceLineToRow(invoiceLine()).direction).toBe("OUT")
  })
})

describe("ödeme tipi", () => {
  it("ödemesiz belge açık hesaptır", () => {
    expect(paymentLabelOf(100, [])).toBe("Açık Hesap")
  })
  it("tam ödenmişse yöntem(ler), eksikse kısmi", () => {
    expect(paymentLabelOf(100, [{ amount: 100, paymentMethod: "CASH" }])).toBe("Nakit")
    expect(
      paymentLabelOf(100, [
        { amount: 60, paymentMethod: "CASH" },
        { amount: 40, paymentMethod: "CREDIT_CARD" },
      ]),
    ).toBe("Nakit, Kredi Kartı / POS")
    expect(paymentLabelOf(100, [{ amount: 30, paymentMethod: "BANK_TRANSFER" }])).toBe("Kısmi · Havale / EFT")
  })
})

describe("durum etiketi", () => {
  it("iptal ve kesilmemiş e-belge işaretlenir; kayıtlı alış ve manuel satış işaretlenmez", () => {
    expect(invoiceStatusTag({ status: "CANCELLED", type: "SALES", invoiceType: "E_ARCHIVE" })).toBe("İptal")
    expect(invoiceStatusTag({ status: "DRAFT", type: "SALES", invoiceType: "E_ARCHIVE" })).toBe("Taslak")
    expect(invoiceStatusTag({ status: "DRAFT", type: "PURCHASE", invoiceType: "MANUAL" })).toBe("")
    expect(invoiceStatusTag({ status: "DRAFT", type: "SALES", invoiceType: "MANUAL" })).toBe("")
    expect(invoiceStatusTag({ status: "SENT", type: "SALES", invoiceType: "E_INVOICE" })).toBe("")
  })
})

describe("satır", () => {
  it("KDV dahil birim = satır toplamı ÷ miktar", () => {
    const row = invoiceLineToRow(invoiceLine())
    expect(row.unitPriceGross).toBe(119.375)
    expect(row.totalGross).toBe(1193.75)
  })

  it("bağlı irsaliyelerin numarası yazılır, sevk tarihi en geç teslimdir", () => {
    const row = invoiceLineToRow(
      invoiceLine({
        waybills: [
          { waybillNo: "İRS-1", date: new Date("2026-09-20T00:00:00Z"), deliveryDate: new Date("2026-09-22T00:00:00Z") },
          { waybillNo: "İRS-2", date: new Date("2026-09-21T00:00:00Z"), deliveryDate: null },
        ],
      }),
    )
    expect(row.waybillNos).toBe("İRS-1, İRS-2")
    expect(row.shipmentDate).toBe("2026-09-22T00:00:00.000Z")
  })

  it("irsaliyesiz faturada sevk tarihi UYDURULMAZ", () => {
    expect(invoiceLineToRow(invoiceLine()).shipmentDate).toBeNull()
  })

  it("e-belge no fatura no ile aynıysa tekrar basılmaz", () => {
    expect(invoiceLineToRow(invoiceLine({ eDocumentNo: "SAT-2026-0001" })).eDocumentNo).toBe("")
    expect(invoiceLineToRow(invoiceLine({ eDocumentNo: "KBP2026000000012" })).eDocumentNo).toBe("KBP2026000000012")
  })

  it("irsaliye satırında fiyat ve ödeme yoktur", () => {
    const row = waybillLineToRow({
      id: "w1",
      quantity: 4,
      unit: "ADET",
      waybill: {
        id: "irs",
        waybillNo: "A-12",
        type: "PURCHASE",
        status: "DELIVERED",
        date: new Date("2026-09-01T00:00:00Z"),
        deliveryDate: null,
        customer: null,
        supplier: { id: "s1", slug: null, name: "Tedarikçi" },
      },
    })
    expect(row).toMatchObject({ typeLabel: "Alış İrsaliyesi", direction: "IN", unitPriceGross: null, paymentLabel: "" })
    expect(row.counterpartyRef).toBe("s1")
  })
})

describe("birleştirme", () => {
  it("tarihe göre yeniden eskiye sıralanır ve kesilir", () => {
    const a = invoiceLineToRow(invoiceLine({ date: new Date("2026-09-01T00:00:00Z") }, { id: "a" }))
    const b = invoiceLineToRow(invoiceLine({ date: new Date("2026-09-15T00:00:00Z") }, { id: "b" }))
    const c = invoiceLineToRow(invoiceLine({ date: new Date("2026-09-10T00:00:00Z") }, { id: "c" }))
    expect(mergeTransactions([a, b, c], 2).map((r) => r.key)).toEqual(["fatura:b", "fatura:c"])
  })
})
