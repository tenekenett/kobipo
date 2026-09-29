import { describe, expect, it } from "vitest"
import fs from "node:fs"
import path from "node:path"
import {
  CALISAN_ODEMESI_METHOD,
  isCalisanOdemesi,
  ledgerBalance,
  parsePurchasePayment,
  purchasePaymentBlocker,
} from "./calisan-odemesi"
import {
  EMPLOYEE_REIMBURSEMENT_PREFIX,
  NOT_TRANSFER_OR_SETTLEMENT_WHERE,
  isEmployeeReimbursement,
} from "@/lib/finans/nakit-hareket"

describe("parsePurchasePayment", () => {
  it("alan yoksa ya da Ödenecek ise ödeme yazılmaz", () => {
    expect(parsePurchasePayment(undefined)).toEqual({ ok: true, value: null })
    expect(parsePurchasePayment(null)).toEqual({ ok: true, value: null })
    expect(parsePurchasePayment({ status: "UNPAID" })).toEqual({ ok: true, value: null })
  })

  it("Ödendi: hesap isteğe bağlı (boşsa sunucu Kasa'ya yazar)", () => {
    expect(parsePurchasePayment({ status: "PAID", paymentDate: "2026-09-29" })).toEqual({
      ok: true,
      value: { status: "PAID", accountId: null, paymentDate: "2026-09-29" },
    })
    expect(parsePurchasePayment({ status: "paid", accountId: " acc1 " })).toEqual({
      ok: true,
      value: { status: "PAID", accountId: "acc1", paymentDate: null },
    })
  })

  it("Çalışan cebinden: çalışan ZORUNLU", () => {
    expect(parsePurchasePayment({ status: "EMPLOYEE" })).toEqual({
      ok: false,
      error: "Ödemeyi yapan çalışanı seçin",
    })
    expect(parsePurchasePayment({ status: "EMPLOYEE", employeeId: "e1" })).toEqual({
      ok: true,
      value: { status: "EMPLOYEE", employeeId: "e1", paymentDate: null },
    })
  })

  it("bilinmeyen durum ve geçersiz tarih reddedilir", () => {
    expect(parsePurchasePayment({ status: "HALF" }).ok).toBe(false)
    expect(parsePurchasePayment({ status: "PAID", paymentDate: "yarın" }).ok).toBe(false)
    expect(parsePurchasePayment("PAID").ok).toBe(false)
  })
})

describe("purchasePaymentBlocker", () => {
  const paid = { status: "PAID" as const, accountId: null, paymentDate: null }
  const employee = { status: "EMPLOYEE" as const, employeeId: "e1", paymentDate: null }

  it("yalnız alış faturasında (fiş ve satış değil)", () => {
    expect(purchasePaymentBlocker(paid, { type: "PURCHASE" })).toBeNull()
    expect(purchasePaymentBlocker(paid, { type: "SALES" })).not.toBeNull()
    expect(purchasePaymentBlocker(paid, { type: "PURCHASE", isReceipt: true })).not.toBeNull()
  })

  it("çalışan borcu TL tutulur: döviz faturası çalışan cebinden işaretlenemez", () => {
    expect(purchasePaymentBlocker(employee, { type: "PURCHASE", currency: "TRY" })).toBeNull()
    expect(purchasePaymentBlocker(employee, { type: "PURCHASE", currency: "USD" })).toMatch(/Döviz/)
    // "Ödendi" dövizde serbest — kasa hareketi faturanın dövizini taşır.
    expect(purchasePaymentBlocker(paid, { type: "PURCHASE", currency: "USD" })).toBeNull()
  })
})

describe("ledgerBalance", () => {
  it("gider + , geri ödeme − ; işaret kırpılmaz", () => {
    expect(
      ledgerBalance([
        { kind: "EXPENSE", amount: 1000 },
        { kind: "EXPENSE", amount: 250.5 },
        { kind: "REIMBURSEMENT", amount: 600 },
      ]),
    ).toBe(650.5)
    expect(ledgerBalance([{ kind: "REIMBURSEMENT", amount: 100 }])).toBe(-100)
    expect(ledgerBalance([])).toBe(0)
  })

  it("kuruş toplamı ikilik tabanda kaymaz", () => {
    expect(
      ledgerBalance([
        { kind: "EXPENSE", amount: 0.1 },
        { kind: "EXPENSE", amount: 0.2 },
      ]),
    ).toBe(0.3)
  })
})

describe("yöntem sabiti", () => {
  it("büyük/küçük harf duyarsız", () => {
    expect(isCalisanOdemesi(CALISAN_ODEMESI_METHOD)).toBe(true)
    expect(isCalisanOdemesi("employee")).toBe(true)
    expect(isCalisanOdemesi("CASH")).toBe(false)
    expect(isCalisanOdemesi(null)).toBe(false)
  })
})

/**
 * GİDER BİR KEZ SAYILIR: çalışana geri ödeme kasadan çıkar ama gider faturada
 * zaten sayıldı. Kârı kuran her rapor öneki dışlamalı; biri unutursa aynı masraf
 * kâr/zararda iki kez görünür.
 */
describe("masraf iadesi kâr raporlarında gider sayılmaz", () => {
  const ROOT = process.cwd()
  const oku = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8")

  it("önek tanımı", () => {
    expect(EMPLOYEE_REIMBURSEMENT_PREFIX).toBe("CALISAN:")
    expect(isEmployeeReimbursement({ reference: "CALISAN:emp1" })).toBe(true)
    expect(isEmployeeReimbursement({ reference: null })).toBe(false)
  })

  it("Prisma süzgeci (kâr/zarar, harcamalar) öneki dışlar — NULL referans geçer", () => {
    expect(NOT_TRANSFER_OR_SETTLEMENT_WHERE.AND).toContainEqual({
      OR: [{ reference: null }, { NOT: { reference: { startsWith: EMPLOYEE_REIMBURSEMENT_PREFIX } } }],
    })
  })

  it.each(["lib/raporlar/gelir-gider.ts", "lib/raporlar/finansal-ozet.ts"])(
    "%s ham SQL'i öneki dışlar",
    (dosya) => {
      const kaynak = oku(dosya)
      const cekSayisi = (kaynak.match(/NOT LIKE 'CEK:%'/g) || []).length
      const calisanSayisi = (kaynak.match(/NOT LIKE 'CALISAN:%'/g) || []).length
      expect(cekSayisi).toBeGreaterThan(0)
      expect(calisanSayisi).toBe(cekSayisi)
    },
  )

  it("nakit akışı iadeyi FATURA ÖDEMESİ sayar, serbest giderden düşer", () => {
    const kaynak = oku("lib/raporlar/nakit-akisi.ts")
    expect(kaynak).toMatch(/\.\.\.EMPLOYEE_REIMBURSEMENT_WHERE/)
    expect(kaynak).toMatch(/NOT_EMPLOYEE_REIMBURSEMENT_WHERE/)
  })
})
