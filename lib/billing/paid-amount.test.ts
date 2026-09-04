import { describe, expect, it } from "vitest"
import { checkPaidAmount, toKurus } from "./paid-amount"

describe("toKurus", () => {
  it("TL'yi kuruşa çevirir (PayTR'a giden yuvarlamanın aynısı)", () => {
    expect(toKurus(495)).toBe(49500)
    expect(toKurus("10.50")).toBe(1050)
    // 0.1 + 0.2 tipi kayan nokta artığı kuruşa taşınmamalı.
    expect(toKurus(19.99)).toBe(1999)
  })
  it("sayı olmayanda null", () => {
    expect(toKurus("abc")).toBeNull()
    expect(toKurus(null)).toBeNull()
    expect(toKurus(undefined)).toBeNull()
  })
})

describe("checkPaidAmount", () => {
  it("tam tutar ödenmişse geçer", () => {
    const r = checkPaidAmount({ totalAmount: "49500", expected: 495 })
    expect(r).toEqual({ ok: true, paidKurus: 49500, expectedKurus: 49500, overpaid: false })
  })

  it("Decimal'in string hâlini de okur (Prisma JSON'a string basar)", () => {
    expect(checkPaidAmount({ totalAmount: "1050", expected: "10.50" }).ok).toBe(true)
  })

  it("EKSİK ödemede reddeder — yetkiyi açan tek bildirim budur", () => {
    const r = checkPaidAmount({ totalAmount: "100", expected: 495 })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toBe("short")
    expect(r.ok === false && r.paidKurus).toBe(100)
  })

  it("bir kuruş eksik bile reddedilir", () => {
    expect(checkPaidAmount({ totalAmount: "49499", expected: 495 }).ok).toBe(false)
  })

  it("FAZLA ödeme geçer ama işaretlenir (taksit komisyonu bu şekilde gelir)", () => {
    const r = checkPaidAmount({ totalAmount: "52000", expected: 495 })
    expect(r.ok).toBe(true)
    expect(r.ok === true && r.overpaid).toBe(true)
  })

  it("okunamayan tutarda fail-closed", () => {
    for (const bad of ["", "  ", "abc", "0", "-5", null, undefined]) {
      const r = checkPaidAmount({ totalAmount: bad, expected: 495 })
      expect(r.ok, `total_amount=${String(bad)}`).toBe(false)
      expect(r.ok === false && r.reason).toBe("unreadable")
    }
  })

  it("beklenen tutar okunamıyorsa/sıfırsa da fail-closed", () => {
    // Ücretsiz sipariş PayTR'a hiç gitmez; buraya düşmesi anormaldir, modül açılmamalı.
    expect(checkPaidAmount({ totalAmount: "49500", expected: 0 }).ok).toBe(false)
    expect(checkPaidAmount({ totalAmount: "49500", expected: null }).ok).toBe(false)
    expect(checkPaidAmount({ totalAmount: "49500", expected: "abc" }).ok).toBe(false)
  })

  it("ondalıklı gelen kuruş biçimini de kabul eder", () => {
    expect(checkPaidAmount({ totalAmount: "49500.00", expected: 495 }).ok).toBe(true)
  })
})
