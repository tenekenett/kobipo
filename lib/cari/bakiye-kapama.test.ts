// BAKİYE KAPAMA / İSKONTO — kasaya girmeden kapatılan fatura tutarı.
//
// Kayıt bir InvoicePayment'tır (paymentMethod=WRITE_OFF, accountId=null,
// transactionId=null). Ekstre satırı ödemeyle AYNI YÖNDE düşer ama AYRI TÜRDÜR:
// para gelmedi, alacaktan vazgeçildi. Tür ayrımı kaybolursa ekran ve dosya
// "Fatura ödemesi" der ve rapor kayıtları bulamaz.

import { describe, expect, it } from "vitest"
import { BAKIYE_KAPAMA_METHOD, isBakiyeKapama } from "./bakiye-kapama"
import { faturaOdemesiSatirlari } from "./ekstre-query"

const odeme = (over: Partial<{ paymentMethod: string; transactionId: string | null }> = {}) => ({
  id: "p1",
  amount: 50,
  paymentDate: new Date("2026-09-20T00:00:00.000Z"),
  transactionId: null as string | null,
  reference: null as string | null,
  paymentMethod: "CASH",
  ...over,
})

const satisFaturasi = (payments: ReturnType<typeof odeme>[]) => ({
  type: "SALES",
  returnKind: null,
  invoiceNo: "SAT-2026-0001",
  eDocumentNo: null,
  payments,
})

describe("bakiye kapama / iskonto", () => {
  it("yöntem sabiti büyük/küçük harften bağımsız tanınır", () => {
    expect(isBakiyeKapama(BAKIYE_KAPAMA_METHOD)).toBe(true)
    expect(isBakiyeKapama("write_off")).toBe(true)
    expect(isBakiyeKapama("CASH")).toBe(false)
    expect(isBakiyeKapama(null)).toBe(false)
  })

  it("ekstrede ödemeyle aynı yönde düşer ama WRITE_OFF türüyle etiketlenir", () => {
    const [satir] = faturaOdemesiSatirlari(
      satisFaturasi([odeme({ paymentMethod: BAKIYE_KAPAMA_METHOD })]),
    )
    expect(satir.type).toBe("WRITE_OFF")
    // Satış faturası BORÇ yazılır; kapaması ALACAK sütununa düşer (ödeme gibi).
    expect(satir.credit).toBe(50)
    expect(satir.debit).toBe(0)
    expect(satir.description).toBe("Bakiye kapama / iskonto SAT-2026-0001")
  })

  it("kasasız sıradan ödeme INVOICE_PAYMENT olarak kalır", () => {
    const [satir] = faturaOdemesiSatirlari(satisFaturasi([odeme()]))
    expect(satir.type).toBe("INVOICE_PAYMENT")
    expect(satir.description).toBe("Fatura ödemesi SAT-2026-0001")
  })

  it("kasa hareketine bağlı ödeme satır üretmez (Transaction zaten ayrı satır)", () => {
    expect(
      faturaOdemesiSatirlari(satisFaturasi([odeme({ transactionId: "t1" })])),
    ).toHaveLength(0)
  })
})
