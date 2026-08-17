/**
 * GİDEN fatura: satır açıklaması (InvoiceItem.note) Mysoft payload'ında
 * invoiceDetail[].note olarak gider ve productName'i KİRLETMEZ.
 *
 * Mysoft'a gerçek istek atılmaz: fetch stub'lanır, POST gövdesi yakalanır.
 * (Swagger InvoiceOutboxDetailModel.note — "Fatura kalemi için girmek
 * istediğiniz not bilgisidir. Tek satır açıklama girilecek ise bu alan
 * kullanılabilir.")
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { MysoftEInvoiceProvider } from "./mysoft-provider"

function stubMysoft() {
  const captured: any[] = []
  const fetchMock = vi.fn(async (url: unknown, init?: any) => {
    const u = String(url)
    if (u.includes("/oauth/token")) {
      return { ok: true, json: async () => ({ access_token: "test-token", expires_in: 600 }) } as any
    }
    if (u.includes("/api/InvoiceOutbox/invoiceOutbox")) {
      const body = JSON.parse(String(init?.body || "{}"))
      captured.push(body)
      return {
        ok: true,
        json: async () => ({ succeed: true, data: { invoiceETTN: body.ettn, docNo: "TST2026000001" } }),
      } as any
    }
    throw new Error(`Stub'da tanımsız istek: ${u}`)
  })
  vi.stubGlobal("fetch", fetchMock)
  // Provider payload'ı loglar; test çıktısını boğmasın.
  vi.spyOn(console, "log").mockImplementation(() => {})
  return { captured }
}

const baseInvoice = {
  invoiceType: "E_ARCHIVE" as const,
  prefix: "TST", // verilirse numaratör sorgusu yapılmaz
  date: new Date("2026-08-17T00:00:00Z"),
  sender: { name: "Test Firma A.Ş.", taxNumber: "1234567890" },
  customer: {
    name: "Deneme Müşteri Ltd.",
    taxNumber: "1234567801",
    taxOffice: "Merkez",
    city: "İZMİR",
    district: "Bornova",
    address: "Test Mah. 1. Sok. No 5",
  },
}

describe("Mysoft giden fatura — satır açıklaması", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("note'u invoiceDetail.note olarak gönderir, productName'e eklemez", async () => {
    const { captured } = stubMysoft()
    const provider = new MysoftEInvoiceProvider({
      username: "u",
      passwordText: "p",
      baseUrl: "https://mysoft.test.invalid",
    })

    const res = await provider.sendInvoice({
      ...baseInvoice,
      items: [
        {
          description: "Klima montaj hizmeti",
          note: "3 metre bakır boru ve montaj işçiliği dahil",
          quantity: 1,
          unitPrice: 1000,
          vatRate: 20,
        },
        { description: "Filtre", quantity: 2, unitPrice: 50, vatRate: 20 },
      ],
    })

    expect(res.success).toBe(true)
    expect(captured).toHaveLength(1)
    const detail = captured[0].invoiceDetail
    expect(detail).toHaveLength(2)

    // 1. satır: ad temiz, açıklama ayrı alanda.
    expect(detail[0].productName).toBe("Klima montaj hizmeti")
    expect(detail[0].note).toBe("3 metre bakır boru ve montaj işçiliği dahil")

    // 2. satır: açıklama yok → alan HİÇ gönderilmez (nullable alanı boş yazmayalım).
    expect(detail[1].productName).toBe("Filtre")
    expect("note" in detail[1]).toBe(false)

    // Tutarlar açıklamadan etkilenmez.
    expect(detail[0].amtTra).toBe(1000)
    expect(detail[0].amtVatTra).toBe(200)
  })

  it("yalnız boşluktan oluşan açıklama gönderilmez", async () => {
    const { captured } = stubMysoft()
    const provider = new MysoftEInvoiceProvider({
      username: "u",
      passwordText: "p",
      baseUrl: "https://mysoft.test.invalid",
    })

    await provider.sendInvoice({
      ...baseInvoice,
      items: [{ description: "Danışmanlık", note: "   ", quantity: 1, unitPrice: 500, vatRate: 20 }],
    })

    expect("note" in captured[0].invoiceDetail[0]).toBe(false)
  })
})
