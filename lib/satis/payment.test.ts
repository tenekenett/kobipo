import { describe, expect, it } from "vitest"
import { buildPaymentParts, defaultPaymentAccounts, emptyPaymentState, withMethodChannel } from "./payment"

const accounts = [
  { id: "kasa", type: "CASH" },
  { id: "pos", type: "POS" },
  { id: "banka", type: "BANK" },
]
const ids = defaultPaymentAccounts(accounts)

describe("withMethodChannel — tek yöntemli tahsilatın hesabı yöntemi izler", () => {
  it("kart seçilince POS hesabına, havalede bankaya, nakitte kasaya geçer", () => {
    expect(withMethodChannel({ method: "CREDIT_CARD" }, ids).accountId).toBe("pos")
    expect(withMethodChannel({ method: "BANK_TRANSFER" }, ids).accountId).toBe("banka")
    expect(withMethodChannel({ method: "CASH" }, ids).accountId).toBe("kasa")
  })

  it("kart kanalı yoksa banka; hiç kanal yoksa mevcut seçime dokunmaz", () => {
    const yalnizBanka = defaultPaymentAccounts([{ id: "kasa", type: "CASH" }, { id: "banka", type: "BANK" }])
    expect(withMethodChannel({ method: "CREDIT_CARD" }, yalnizBanka).accountId).toBe("banka")

    const yalnizKasa = defaultPaymentAccounts([{ id: "kasa", type: "CASH" }])
    expect(withMethodChannel({ method: "CREDIT_CARD" }, yalnizKasa)).not.toHaveProperty("accountId")
  })

  it("hesabı açıkça veren ya da yöntem içermeyen değişikliğe dokunmaz", () => {
    expect(withMethodChannel({ method: "CREDIT_CARD", accountId: "kasa" }, ids).accountId).toBe("kasa")
    expect(withMethodChannel({ isCredit: true }, ids)).toEqual({ isCredit: true })
  })

  it("kartla tek yöntemli satış artık kasaya yazılmaz", () => {
    // Eskiden: hesap varsayılan kasada kalıyor, kart tahsilatı kasaya düşüyordu.
    const state = { ...emptyPaymentState("kasa"), ...withMethodChannel({ method: "CREDIT_CARD" }, ids) }
    const parts = buildPaymentParts(state, { total: 100, ...ids })
    expect(parts).toEqual([{ method: "CREDIT_CARD", amount: 100, provider: undefined, accountId: "pos" }])
  })
})
