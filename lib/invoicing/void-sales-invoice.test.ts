/**
 * Satış faturasının nasıl geri alınacağı kararının testleri.
 *
 * Bu kararın iki yönlü maliyeti var: GİB'e gitmiş bir e-Faturayı "iptal edilebilir"
 * sanmak sağlayıcı hatasıyla döner ve sipariş yarım kalır; elde duran 24 saatlik
 * e-Arşiv penceresini kaçırmak ise iade faturası zorunluluğu doğurur — karşı tarafın
 * defterini de ilgilendiren bir işlem. Testler dört yolun sınırlarını kilitler.
 */

import { describe, expect, it } from "vitest"
import { EARCHIVE_CANCEL_WINDOW_HOURS, planInvoiceVoid } from "./void-sales-invoice"

const NOW = new Date("2026-08-24T12:00:00.000Z")
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000)

const inv = (over: Partial<{ status: string; invoiceType: string; issuedAt: Date }> = {}) => ({
  status: "SENT",
  invoiceType: "E_ARCHIVE",
  issuedAt: hoursAgo(1),
  ...over,
})

describe("planInvoiceVoid", () => {
  it("fatura yoksa yapılacak bir şey yoktur", () => {
    expect(planInvoiceVoid(null, NOW)).toEqual({ kind: "none" })
  })

  it("zaten iptal edilmiş belgeye tekrar dokunmaz", () => {
    expect(planInvoiceVoid(inv({ status: "CANCELLED" }), NOW)).toEqual({ kind: "none" })
  })

  it("yerel taslağı siler — hiçbir yere gitmemiştir", () => {
    expect(planInvoiceVoid(inv({ status: "DRAFT" }), NOW)).toEqual({ kind: "delete-draft" })
  })

  it("Mysoft taslağını geri alır — GİB'e gitmemiştir", () => {
    expect(planInvoiceVoid(inv({ status: "GIB_DRAFT" }), NOW)).toEqual({
      kind: "discard-gib-draft",
    })
  })

  it("süresi içindeki e-Arşiv'i iptal eder", () => {
    expect(planInvoiceVoid(inv({ issuedAt: hoursAgo(23) }), NOW)).toEqual({ kind: "cancel" })
  })

  it("24 saati geçmiş e-Arşiv'de iade faturası ister", () => {
    expect(planInvoiceVoid(inv({ issuedAt: hoursAgo(25) }), NOW)).toEqual({
      kind: "manual",
      why: "window-expired",
    })
  })

  it("pencere sınırında (tam 24 saat) hâlâ iptal edilebilir", () => {
    expect(planInvoiceVoid(inv({ issuedAt: hoursAgo(EARCHIVE_CANCEL_WINDOW_HOURS) }), NOW)).toEqual({
      kind: "cancel",
    })
  })

  it("e-Fatura iptal edilemez — süresi içinde olsa bile iade faturası ister", () => {
    expect(
      planInvoiceVoid(inv({ invoiceType: "E_INVOICE", issuedAt: hoursAgo(1) }), NOW),
    ).toEqual({ kind: "manual", why: "e-invoice" })
  })

  it("taslak hâlindeki e-Fatura yine de geri alınabilir (GİB'e gitmedi)", () => {
    // Belge tipi değil, DURUM belirleyicidir: taslak e-Fatura henüz GİB'de yoktur.
    expect(planInvoiceVoid(inv({ invoiceType: "E_INVOICE", status: "GIB_DRAFT" }), NOW)).toEqual({
      kind: "discard-gib-draft",
    })
  })
})
