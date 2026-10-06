/**
 * KAMU FATURASI — provider payload'ı (public-invoice.ts kararının Mysoft karşılığı).
 *
 * Mysoft'a gerçek istek atılmaz: fetch stub'lanır, POST gövdesi yakalanır. Alanların
 * belgede neye dönüştüğü 2026-10-06'da önizleme XML'iyle ölçüldü (paymentMeans →
 * cac:PaymentMeans, publicServicePayee* → cac:BuyerCustomerParty); bu test yalnız
 * alanların GÖNDERİLDİĞİNİ sabitler.
 */
import { MYSOFT_TEST_URL } from "./constants"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MysoftEInvoiceProvider } from "./mysoft-provider"
import type { PublicInvoiceData } from "./public-invoice"

function stubMysoft() {
  const captured: any[] = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: any) => {
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
    }),
  )
  vi.spyOn(console, "log").mockImplementation(() => {})
  return { captured }
}

const IBAN = "TR330006100519786457841326"
const PAYEE = { vkn: "1234567890", name: "YAPI İŞLERİ DAİ. BŞK.", city: "DENİZLİ", district: "PAMUKKALE" }

const send = (patch: Record<string, unknown>) =>
  new MysoftEInvoiceProvider({ username: "u", passwordText: "p", baseUrl: MYSOFT_TEST_URL }).sendInvoice({
    invoiceType: "E_INVOICE",
    prefix: "TST",
    date: new Date("2026-10-06T00:00:00Z"),
    invoiceNo: "SAT-1",
    customer: { name: "PAMUKKALE ÜNİVERSİTESİ", taxNumber: "7210019412", city: "Denizli", district: "Pamukkale" },
    items: [{ description: "Hidrolik silindir", quantity: 1, unitPrice: 100, vatRate: 20 }],
    ...patch,
  } as any)

describe("Mysoft kamu faturası payload'ı", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("kamu değilse paymentMeans ve harcama birimi hiç gönderilmez", async () => {
    const { captured } = stubMysoft()
    await send({})
    expect(captured[0].profile).toBe("TICARIFATURA")
    expect(captured[0].paymentMeans).toBeUndefined()
    expect(captured[0].publicServicePayeeVKN).toBeUndefined()
  })

  it("harcama birimsiz kamu: kullanıcının profili kalır, IBAN eklenir", async () => {
    const { captured } = stubMysoft()
    const publicInvoice: PublicInvoiceData = { iban: IBAN, accountName: "A", payee: null }
    await send({ publicInvoice, eInvoiceProfile: "TEMELFATURA" })
    expect(captured[0].profile).toBe("TEMELFATURA")
    expect(captured[0].paymentMeans).toEqual([
      { paymentMeansCode: "42", payeeFinancialAccount: { iD: IBAN, currencyCode: "TRY" } },
    ])
    expect(captured[0].publicServicePayeeVKN).toBeUndefined()
  })

  it("harcama birimli kamu: profil KAMU + IBAN + harcama birimi", async () => {
    const { captured } = stubMysoft()
    await send({ publicInvoice: { iban: IBAN, accountName: "A", payee: PAYEE } })
    expect(captured[0].profile).toBe("KAMU")
    expect(captured[0].paymentMeans[0].payeeFinancialAccount.iD).toBe(IBAN)
    expect(captured[0]).toMatchObject({
      publicServicePayeeVKN: PAYEE.vkn,
      publicServicePayeePartyName: PAYEE.name,
      publicServicePayeeCountry: "TÜRKİYE",
      publicServicePayeeCity: PAYEE.city,
      publicServicePayeeCitysubdivision: PAYEE.district,
    })
  })

  it("kamuya iade: profil TEMELFATURA kalır, IBAN yine gider", async () => {
    const { captured } = stubMysoft()
    await send({
      publicInvoice: { iban: IBAN, accountName: "A", payee: PAYEE },
      isReturn: true,
      returnRef: { invoiceNo: "TST2026000000001", date: new Date("2026-10-01T00:00:00Z") },
    })
    expect(captured[0].invoiceType).toBe("IADE")
    expect(captured[0].profile).toBe("TEMELFATURA")
    expect(captured[0].paymentMeans).toHaveLength(1)
  })

  it("e-Arşiv'de kamu alanları yok sayılır", async () => {
    const { captured } = stubMysoft()
    await send({ invoiceType: "E_ARCHIVE", publicInvoice: { iban: IBAN, accountName: "A", payee: PAYEE } })
    expect(captured[0].profile).toBe("EARSIVFATURA")
    expect(captured[0].paymentMeans).toBeUndefined()
  })
})
