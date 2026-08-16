import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { MysoftEInvoiceProvider } from "./mysoft-provider"

/**
 * GELEN fatura satırındaki cac:AllowanceCharge okuması.
 *
 * Regresyon: eskiden iskonto `allowances.find(chargeIndicator===false) || allowances[0]`
 * ile seçiliyordu. Satırdaki tek girdi bir MASRAF ise (chargeIndicator=true — GEKAP
 * tam olarak böyle gelir) fallback onu İSKONTO sanıp tutarı düşürüyordu.
 */
const lineWith = (allowanceChargeList: any[]) => ({
  succeed: true,
  data: {
    uuid: "test-ettn",
    invoiceNumber: "ABC2026000000001",
    detailList: [
      {
        detailItem: { itemName: "Plastik ambalajlı ürün" },
        invoicedQuantity: 100,
        unitPrice: 10,
        lineExtensionAmount: 1000,
        allowanceChargeList,
        taxTotal: { taxSubtotalList: [{ taxTypeCode: "0015", percent: 20, taxAmount: 212 }] },
      },
    ],
  },
})

let provider: MysoftEInvoiceProvider

beforeEach(() => {
  provider = new MysoftEInvoiceProvider({
    username: "u", passwordText: "p", baseUrl: "https://example.invalid", vknTckn: "1111111114",
  })
  // Token + tenant keşfini atla.
  vi.spyOn(provider as any, "getToken").mockResolvedValue("tok")
  vi.spyOn(provider as any, "resolveTenantVkn").mockResolvedValue("1111111114")
  vi.spyOn(provider as any, "discoverTenantFromToken").mockResolvedValue({ success: false })
})
afterEach(() => vi.restoreAllMocks())

const fetchReturning = (payload: any) =>
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => payload })))

describe("gelen fatura — satır masrafı (AllowanceCharge)", () => {
  it("GEKAP masrafını iskonto SANMAZ; maktu alana taşır", async () => {
    fetchReturning(lineWith([
      { chargeIndicator: true, amount: 60, baseAmount: 1000, allowanceChargeReason: "Geri Kazanım Katılım Payı" },
    ]))
    const r: any = await provider.getIncomingInvoiceModel("test-ettn")
    expect(r.success).toBe(true)
    const line = r.data.lines[0]
    expect(line.discountAmount ?? 0).toBe(0)   // REGRESYON: eskiden 60 çıkıyordu
    expect(line.gekapAmount).toBe(60)
    expect(line.gekapUnitAmount).toBeCloseTo(0.6, 6) // 60 / 100 adet
  })

  it("GEKAP kısaltmasını da tanır", async () => {
    fetchReturning(lineWith([
      { chargeIndicator: true, amount: 25, allowanceChargeReason: "GEKAP" },
    ]))
    const r: any = await provider.getIncomingInvoiceModel("test-ettn")
    expect(r.data.lines[0].gekapAmount).toBe(25)
    expect(r.data.lines[0].discountAmount ?? 0).toBe(0)
  })

  it("gerçek iskonto hâlâ iskonto olarak okunur", async () => {
    fetchReturning(lineWith([
      { chargeIndicator: false, amount: 100, baseAmount: 1000, multiplierFactorNumeric: 0.1, allowanceChargeReason: "Satır İskontosu" },
    ]))
    const line: any = (await provider.getIncomingInvoiceModel("test-ettn") as any).data.lines[0]
    expect(line.discountAmount).toBe(100)
    expect(line.discountRate).toBeCloseTo(10, 6)
    expect(line.gekapAmount).toBeNull()
  })

  it("iskonto + GEKAP masrafı bir arada doğru ayrışır", async () => {
    fetchReturning(lineWith([
      { chargeIndicator: false, amount: 100, baseAmount: 1000, multiplierFactorNumeric: 0.1 },
      { chargeIndicator: true, amount: 60, allowanceChargeReason: "GEKAP payı" },
    ]))
    const line: any = (await provider.getIncomingInvoiceModel("test-ettn") as any).data.lines[0]
    expect(line.discountAmount).toBe(100)
    expect(line.gekapAmount).toBe(60)
  })

  it("GEKAP olmayan masraf maktu alana YAZILMAZ (başlık reconciliation'ına bırakılır)", async () => {
    fetchReturning(lineWith([
      { chargeIndicator: true, amount: 40, allowanceChargeReason: "Nakliye Bedeli" },
    ]))
    const line: any = (await provider.getIncomingInvoiceModel("test-ettn") as any).data.lines[0]
    expect(line.gekapAmount).toBeNull()
    expect(line.discountAmount ?? 0).toBe(0)   // masraf iskonto sayılmamalı
  })
})
