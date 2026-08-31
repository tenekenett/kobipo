import { describe, expect, it } from "vitest"
import { buildPaymentPlan, type AgingAccount, type AgingInvoice } from "./cari-yaslandirma"

/**
 * Ay içi ödeme planı. Dilim sınırları müşterinin istediği takvimdir (1-10 / 11-20 /
 * 21-ay sonu) ve satırdaki tutarların TOPLAMI toplam açığı tutmak zorundadır —
 * tutmazsa tablo borcun bir kısmını yutar.
 */

function invoice(dueDate: Date, openAmount: number): AgingInvoice {
  return {
    id: `inv-${dueDate.toISOString()}-${openAmount}`,
    invoiceNo: "F-1",
    date: dueDate,
    effectiveDueDate: dueDate,
    totalAmount: openAmount,
    paidAmount: 0,
    openAmount,
    lastPaymentDate: null,
    overdueDays: 0,
    bucket: "not_due",
    performanceDays: 0,
  }
}

function account(invoices: AgingInvoice[], name = "ACME"): AgingAccount {
  const total = invoices.reduce((sum, inv) => sum + inv.openAmount, 0)
  return {
    id: "acc-1",
    name,
    code: "120.01",
    paymentDueDays: null,
    taxNumber: null,
    class1: "Bayi",
    class2: "İstanbul",
    totals: {
      not_due: total,
      overdue: 0,
      overdueAvgDays: 0,
      performanceAvgDays: 0,
      performanceScore: 0,
      performanceLabel: "Zamanında",
      total,
    },
    invoices,
  }
}

// 15 Eylül 2026: ay 30 günlük, üçüncü dilim 21-30.
const reference = new Date(2026, 8, 15)

describe("ay içi ödeme planı — dilimler", () => {
  it("vadeyi ayın 1-10 / 11-20 / 21-son dilimine yazar", () => {
    const plan = buildPaymentPlan(
      [
        account([
          invoice(new Date(2026, 8, 1), 100),
          invoice(new Date(2026, 8, 10), 200),
          invoice(new Date(2026, 8, 11), 400),
          invoice(new Date(2026, 8, 20), 800),
          invoice(new Date(2026, 8, 21), 1600),
          invoice(new Date(2026, 8, 30), 3200),
        ]),
      ],
      reference,
    )

    const [row] = plan.rows
    // Sınırlar dilimin İLK gününe aittir: 10'u birinci, 11'i ikinci dilimde.
    expect(row.period1).toBe(300)
    expect(row.period2).toBe(1200)
    expect(row.period3).toBe(4800)
    expect(row.monthTotal).toBe(6300)
  })

  it("geçmiş ve sonraki ayları ayrı sütunda tutar, toplam açığı bozmadan", () => {
    const plan = buildPaymentPlan(
      [
        account([
          invoice(new Date(2026, 7, 25), 500), // geçen ay
          invoice(new Date(2026, 8, 5), 150), // bu ay, 1. dilim
          invoice(new Date(2026, 9, 3), 250), // gelecek ay
          invoice(new Date(2027, 0, 3), 100), // gelecek yıl
        ]),
      ],
      reference,
    )

    const [row] = plan.rows
    expect(row.pastMonths).toBe(500)
    expect(row.monthTotal).toBe(150)
    expect(row.nextMonths).toBe(350)
    expect(row.total).toBe(1000)
    // Üç kova toplam açığı TAM kapatmalı.
    expect(row.pastMonths + row.monthTotal + row.nextMonths).toBe(row.total)
  })

  it("vadesi bu ayın geçmiş gününde olanı dilimde bırakır (ölçü ayın 1'i)", () => {
    // Bugün 15 Eylül; 5 Eylül vadeli fatura GECİKMİŞTİR ama plan sütunu vade
    // tarihine göre bölündüğü için "1-10 Eylül"de görünür. Yaşlandırma
    // sayfasındaki "Vadesi Geçmiş" ile aynı sayı olmaması bu yüzden normaldir.
    const plan = buildPaymentPlan([account([invoice(new Date(2026, 8, 5), 700)])], reference)
    const [row] = plan.rows
    expect(row.pastMonths).toBe(0)
    expect(row.period1).toBe(700)
  })

  it("cari kimliğini ve tanımlarını satıra taşır", () => {
    const plan = buildPaymentPlan([account([invoice(new Date(2026, 8, 5), 10)], "Beta Ltd.")], reference)
    expect(plan.rows[0]).toMatchObject({
      code: "120.01",
      name: "Beta Ltd.",
      class1: "Bayi",
      class2: "İstanbul",
    })
  })

  it("hesap yoksa boş satır listesi döner", () => {
    expect(buildPaymentPlan([], reference).rows).toEqual([])
  })
})

describe("ay içi ödeme planı — sütun başlıkları", () => {
  it("ay adını ve ayın son gününü basar", () => {
    const plan = buildPaymentPlan([], reference)
    expect(plan.labels.period1).toBe("1-10 Eylül")
    expect(plan.labels.period2).toBe("11-20 Eylül")
    expect(plan.labels.period3).toBe("21-30 Eylül")
  })

  it("kısa ayda son günü doğru bulur (Şubat)", () => {
    // 2026 artık yıl değil → 28. Sabit "21-30" yazılsaydı başlık yalan olurdu.
    expect(buildPaymentPlan([], new Date(2026, 1, 3)).labels.period3).toBe("21-28 Şubat")
    expect(buildPaymentPlan([], new Date(2028, 1, 3)).labels.period3).toBe("21-29 Şubat")
  })
})
