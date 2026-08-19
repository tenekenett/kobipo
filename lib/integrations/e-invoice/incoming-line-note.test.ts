import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { MysoftEInvoiceProvider } from "./mysoft-provider"

/**
 * GELEN fatura: kalem notu / "Stok Açıklaması" korunuyor mu?
 *
 * Regresyon: ayrıştırıcı ad ile açıklamadan BİRİNİ seçip diğerini atıyordu.
 * Gönderici ölçü/teslim bilgisini "Stok Açıklaması"na yazdığında o bilgi alış
 * faturasına hiç geçmiyordu. Artık ad temiz kalır, kalan metin `note` alanına
 * düşer (InvoiceItem.note → belge PDF'i → giden e-belgede cbc:Note).
 */

const modelWith = (detailItem: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  succeed: true,
  data: {
    uuid: "test-ettn",
    invoiceNumber: "ABC2026000000001",
    detailList: [
      {
        detailItem,
        invoicedQuantity: 2,
        unitPrice: 100,
        lineExtensionAmount: 200,
        taxTotal: { taxSubtotalList: [{ taxTypeCode: "0015", percent: 20, taxAmount: 40 }] },
        ...extra,
      },
    ],
  },
})

let provider: MysoftEInvoiceProvider

beforeEach(() => {
  provider = new MysoftEInvoiceProvider({
    username: "u",
    passwordText: "p",
    baseUrl: "https://example.invalid",
    vknTckn: "1111111114",
  })
  vi.spyOn(provider as any, "getToken").mockResolvedValue("tok")
  vi.spyOn(provider as any, "resolveTenantVkn").mockResolvedValue("1111111114")
  vi.spyOn(provider as any, "discoverTenantFromToken").mockResolvedValue({ success: false })
})
afterEach(() => vi.restoreAllMocks())

const fetchReturning = (payload: any) =>
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => payload })))

async function firstLine() {
  const r: any = await provider.getIncomingInvoiceModel("test-ettn")
  return r.data.lines[0]
}

describe("gelen fatura — kalem notu", () => {
  it("ad olarak seçilmeyen Stok Açıklaması nota düşer", async () => {
    fetchReturning(
      modelWith({
        itemName: "FİNLUX FIN 12000 A++ İNVERTER KLİMA",
        itemDescription: "3 metre bakır boru ve montaj dahil",
        sellersItemIdentificationId: "153 43KLM",
      }),
    )
    const line = await firstLine()
    expect(line.description).toBe("FİNLUX FIN 12000 A++ İNVERTER KLİMA")
    expect(line.note).toBe("3 metre bakır boru ve montaj dahil")
  })

  it("belgedeki kalem notu (note alanı) önceliklidir", async () => {
    fetchReturning(
      modelWith({
        itemName: "Danışmanlık",
        itemDescription: "Stok açıklaması",
        note: "Sözleşme no 2026/14 kapsamında",
      }),
    )
    const line = await firstLine()
    expect(line.description).toBe("Danışmanlık")
    expect(line.note).toBe("Sözleşme no 2026/14 kapsamında")
  })

  it("çoklu not listesi birleştirilir", async () => {
    fetchReturning(
      modelWith({
        itemName: "Kablo",
        noteList: ["3x2.5 mm²", "TSE belgeli"],
      }),
    )
    const line = await firstLine()
    expect(line.note).toBe("3x2.5 mm² · TSE belgeli")
  })

  it("ad KOD ile aynıysa açıklama ADA yükselir ve not boş kalır", async () => {
    // Bazı göndericiler stok kodunu hem koda hem ada yazıp gerçek adı
    // açıklamaya koyuyor; o durumda açıklama ad olur, geriye not kalmaz
    // (kod zaten kendi kolonunda görünür).
    fetchReturning(
      modelWith({
        itemName: "153 43KLM FIN 0120",
        itemDescription: "FİNLUX FIN 12000 A++ İNVERTER KLİMA",
        sellersItemIdentificationId: "153 43KLM FIN 0120",
      }),
    )
    const line = await firstLine()
    expect(line.description).toBe("FİNLUX FIN 12000 A++ İNVERTER KLİMA")
    expect(line.note).toBeNull()
  })

  it("açıklama adın AYNISIYSA not üretilmez (tekrar basılmaz)", async () => {
    fetchReturning(
      modelWith({ itemName: "Montaj hizmeti", itemDescription: "montaj  HİZMETİ" }),
    )
    const line = await firstLine()
    expect(line.description).toBe("Montaj hizmeti")
    expect(line.note).toBeNull()
  })

  it("açıklama yoksa not null'dır", async () => {
    fetchReturning(modelWith({ itemName: "Ürün" }))
    const line = await firstLine()
    expect(line.note).toBeNull()
  })
})
