import { describe, expect, it } from "vitest"
import { formatPlanMonth, resolvePlanMonth } from "./cari-yaslandirma-plan"
import {
  bucketOf,
  buildPaymentPlan,
  dueWindowOf,
  summarize,
  type AgingAccount,
  type AgingInvoice,
} from "./cari-yaslandirma"

/**
 * Ay içi ödeme planı. Dilim sınırları müşterinin istediği takvimdir (1-10 / 11-20 /
 * 21-ay sonu) ve satırdaki tutarların TOPLAMI toplam açığı tutmak zorundadır —
 * tutmazsa tablo borcun bir kısmını yutar.
 */

function invoice(dueDate: Date, openAmount: number): AgingInvoice {
  return {
    id: `inv-${dueDate.toISOString()}-${openAmount}`,
    invoiceNo: "F-1",
    documentKind: "INVOICE",
    date: dueDate,
    effectiveDueDate: dueDate,
    totalAmount: openAmount,
    paidAmount: 0,
    openAmount,
    lastPaymentDate: null,
    overdueDays: 0,
    daysUntilDue: 0,
    bucket: "not_due",
    dueWindow: "w0_30",
    performanceDays: 0,
    hasDueDate: true,
    openPerformanceDays: 0,
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
      d1_30: 0,
      d31_60: 0,
      d61_90: 0,
      d90_plus: 0,
      no_due: 0,
      w0_30: total,
      w31_60: 0,
      w61_90: 0,
      w90_plus: 0,
      overdue: 0,
      overdueAvgDays: 0,
      performanceAvgDays: 0,
      performanceScore: 0,
      performanceLabel: "Zamanında",
      total,
      offsetCredit: 0,
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

/**
 * Yaşlandırma kovaları. Rapor eskiden "vadesi gelmemiş / geçmiş" diye ikiye
 * ayırıyordu; 1 gün geciken fatura ile 400 gün gecikeni aynı kutuda topluyordu.
 * Vade TANIMSIZ belge ise sessizce "gecikmiş" sayılıyordu.
 */
describe("yaşlandırma kovaları", () => {
  it("gecikme gününü doğru kovaya yazar", () => {
    expect(bucketOf(0, true)).toBe("not_due")
    expect(bucketOf(-5, true)).toBe("not_due")
    expect(bucketOf(1, true)).toBe("d1_30")
    expect(bucketOf(30, true)).toBe("d1_30")
    expect(bucketOf(31, true)).toBe("d31_60")
    expect(bucketOf(60, true)).toBe("d31_60")
    expect(bucketOf(61, true)).toBe("d61_90")
    expect(bucketOf(90, true)).toBe("d61_90")
    expect(bucketOf(91, true)).toBe("d90_plus")
    expect(bucketOf(400, true)).toBe("d90_plus")
  })

  it("vade tanımsızsa gecikme ölçülmez", () => {
    // Vadesi olmayan 400 günlük belge bile "gecikmiş" sayılmaz; ayrı durur.
    expect(bucketOf(400, false)).toBe("no_due")
    expect(bucketOf(0, false)).toBe("no_due")
  })
})

function item(partial: Partial<AgingInvoice>): AgingInvoice {
  const merged: AgingInvoice = {
    id: "x",
    invoiceNo: "F-1",
    documentKind: "INVOICE",
    date: new Date(2026, 0, 1),
    effectiveDueDate: new Date(2026, 0, 31),
    hasDueDate: true,
    totalAmount: 1000,
    paidAmount: 0,
    openAmount: 1000,
    lastPaymentDate: null,
    overdueDays: 0,
    daysUntilDue: 0,
    bucket: "not_due",
    dueWindow: null,
    performanceDays: 0,
    openPerformanceDays: 0,
    ...partial,
  }
  // Pencere kovadan TÜRER: gecikmiş kaleme elle pencere yazılırsa fikstür,
  // üretimde imkânsız bir durumu ölçer (pencerelerin toplamı = not_due bozulur).
  if ("dueWindow" in partial) return merged
  return { ...merged, dueWindow: merged.bucket === "not_due" ? "w0_30" : null }
}

describe("hesap toplamı", () => {
  it("kovalar ayrı, 'Vadesi Geçmiş' bunların toplamı", () => {
    const totals = summarize([
      item({ openAmount: 100, bucket: "not_due" }),
      item({ openAmount: 200, bucket: "d1_30", overdueDays: 10 }),
      item({ openAmount: 300, bucket: "d31_60", overdueDays: 45 }),
      item({ openAmount: 400, bucket: "d90_plus", overdueDays: 120 }),
      item({ openAmount: 500, bucket: "no_due", hasDueDate: false }),
    ])
    expect(totals.not_due).toBe(100)
    expect(totals.d1_30).toBe(200)
    expect(totals.d31_60).toBe(300)
    expect(totals.d90_plus).toBe(400)
    expect(totals.no_due).toBe(500)
    expect(totals.overdue).toBe(900)
    expect(totals.total).toBe(1500)
  })

  it("vadesi tanımsız belgeler performansa girmez", () => {
    const totals = summarize([item({ openAmount: 1000, bucket: "no_due", hasDueDate: false, openPerformanceDays: 400 })])
    expect(totals.performanceLabel).toBe("Veri yok")
    expect(totals.performanceScore).toBe(0)
  })

  it("kısmi ödemede açık kalan kısım BUGÜNE göre puanlanır", () => {
    // 1000 TL'lik faturanın 100'ü vadesinde ödendi, 900'ü 200 gündür açık.
    const totals = summarize([
      item({
        totalAmount: 1000,
        paidAmount: 100,
        openAmount: 900,
        bucket: "d90_plus",
        overdueDays: 200,
        performanceDays: 0,
        openPerformanceDays: 200,
      }),
    ])
    // (0×100 + 200×900) / 1000 = 180 gün → "Riskli"
    expect(totals.performanceAvgDays).toBe(180)
    expect(totals.performanceLabel).toBe("Riskli")
  })
})

describe("ödeme planı — vadesi tanımsız belgeler", () => {
  it("dilimlere değil kendi sütununa yazılır", () => {
    // Vadesi olmayan belgede `effectiveDueDate` fatura tarihine düşer; eskiden
    // hepsi "Geçmiş Aylar"a yığılıp planı boş gösteriyordu.
    const vadesiz = item({
      openAmount: 5000,
      hasDueDate: false,
      bucket: "no_due",
      date: new Date(2026, 5, 3),
      effectiveDueDate: new Date(2026, 5, 3),
    })
    const vadeli = item({ openAmount: 1000, effectiveDueDate: new Date(2026, 8, 15) })
    const plan = buildPaymentPlan([account([vadesiz, vadeli])], new Date(2026, 8, 15))
    const row = plan.rows[0]
    expect(row.noDue).toBe(5000)
    expect(row.pastMonths).toBe(0)
    expect(row.period2).toBe(1000)
    // Kimlik: hiçbir kuruş kaybolmamalı.
    expect(row.noDue + row.pastMonths + row.monthTotal + row.nextMonths).toBe(row.total)
  })
})

describe("performans skoru — vadesi gelmemiş borç", () => {
  it("hiç ödeme yapmamış ama vadesi gelmemiş hesap 'erken ödeyen' sayılmaz", () => {
    // Ölçülen gerçek durum: 283.599,73 TL açık, tek kuruş ödeme yok, vade ileri
    // tarihli → rapor "Erken ödeyen 100/100" diyordu.
    const totals = summarize([
      item({ openAmount: 283599.73, bucket: "not_due", overdueDays: 0, openPerformanceDays: -20 }),
    ])
    expect(totals.performanceLabel).toBe("Veri yok")
    expect(totals.performanceScore).toBe(0)
  })

  it("gecikmiş açık tutar skora girer", () => {
    const totals = summarize([
      item({ openAmount: 1000, bucket: "d31_60", overdueDays: 45, openPerformanceDays: 45 }),
    ])
    expect(totals.performanceAvgDays).toBe(45)
    expect(totals.performanceLabel).toBe("Riskli")
  })

  it("erken ÖDENMİŞ fatura hâlâ erken ödeyen sayılır", () => {
    const totals = summarize([
      item({ totalAmount: 1000, paidAmount: 1000, openAmount: 0, performanceDays: -10, bucket: "not_due" }),
    ])
    expect(totals.performanceAvgDays).toBe(-10)
    expect(totals.performanceLabel).toBe("Erken ödeyen")
  })
})

describe("plan ayı çözümü", () => {
  it("YYYY-MM ayın 1'ine düşer", () => {
    const d = resolvePlanMonth("2026-10")
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(9)
    expect(d.getDate()).toBe(1)
  })

  it("geçersiz/boş değer bugünün ayına düşer", () => {
    const bugun = new Date(2026, 8, 17)
    for (const kotu of [null, undefined, "", "2026", "2026-13", "abc", "2026-10-05"]) {
      const d = resolvePlanMonth(kotu as any, bugun)
      expect([d.getFullYear(), d.getMonth(), d.getDate()], String(kotu)).toEqual([2026, 8, 1])
    }
  })

  it("gidiş-dönüş biçimi korunur", () => {
    expect(formatPlanMonth(new Date(2026, 0, 15))).toBe("2026-01")
    expect(formatPlanMonth(resolvePlanMonth("2027-12"))).toBe("2027-12")
  })

  it("başka bir ay seçilince dilimler o aya göre kurulur", () => {
    // Eylül vadeli fatura, EKİM planında "geçmiş aylar"a düşer.
    const eylul = invoice(new Date(2026, 8, 15), 500)
    const ekim = invoice(new Date(2026, 9, 5), 300)
    const plan = buildPaymentPlan([account([eylul, ekim])], resolvePlanMonth("2026-10"))
    expect(plan.labels.period1).toBe("1-10 Ekim")
    expect(plan.rows[0].pastMonths).toBe(500)
    expect(plan.rows[0].period1).toBe(300)
    expect(plan.rows[0].monthTotal).toBe(300)
  })
})

/**
 * "Vadesi 10 Ekim" diyen fatura Eylül planında üç dilimin hiçbirinde çıkmaz —
 * doğru davranış, ama ekranın bunu SÖYLEYEBİLMESİ için parayı taşıyan ayı
 * bilmesi gerekir; bilmezse tablo tutarı yutmuş görünür.
 */
describe("ödeme planı — aydan taşan vadenin ayı", () => {
  const ekim10 = invoice(new Date(2026, 9, 10), 5400)

  it("sonraki aya düşen en YAKIN vadenin ayını verir", () => {
    const plan = buildPaymentPlan(
      [account([ekim10, invoice(new Date(2026, 11, 5), 100)])],
      reference
    )
    expect(plan.rows[0].monthTotal).toBe(0)
    expect(plan.rows[0].nextMonths).toBe(5500)
    expect(plan.nextDueMonth).toBe("2026-10")
    expect(plan.prevDueMonth).toBeNull()
  })

  it("geçmiş aya düşen en GEÇ vadenin ayını verir", () => {
    const plan = buildPaymentPlan(
      [account([invoice(new Date(2026, 5, 3), 200), invoice(new Date(2026, 7, 20), 300)])],
      reference
    )
    expect(plan.prevDueMonth).toBe("2026-08")
    expect(plan.nextDueMonth).toBeNull()
  })

  it("o aya geçilince tutar ilk dilime düşer", () => {
    const plan = buildPaymentPlan([account([ekim10])], resolvePlanMonth("2026-10"))
    expect(plan.rows[0].period1).toBe(5400)
    expect(plan.nextDueMonth).toBeNull()
  })

  it("vadesi tanımsız belge ay yönlendirmesine girmez", () => {
    const vadesiz = { ...invoice(new Date(2026, 9, 10), 900), hasDueDate: false }
    const plan = buildPaymentPlan([account([vadesiz])], reference)
    expect(plan.rows[0].noDue).toBe(900)
    expect(plan.nextDueMonth).toBeNull()
  })
})

/**
 * İLERİ YÖNLÜ EKSEN. Tablo kolonları vadesi gelmemiş parayı "kaç gün SONRA
 * dolacak" diye ayırır; gecikme kovalarının tam tersi yöne bakar. Kimlik:
 * pencerelerin toplamı = `not_due`.
 */
describe("vade penceresi", () => {
  it("kalan güne göre pencereye yazar", () => {
    expect(dueWindowOf(0)).toBe("w0_30")
    expect(dueWindowOf(30)).toBe("w0_30")
    expect(dueWindowOf(31)).toBe("w31_60")
    expect(dueWindowOf(60)).toBe("w31_60")
    expect(dueWindowOf(61)).toBe("w61_90")
    expect(dueWindowOf(90)).toBe("w61_90")
    expect(dueWindowOf(91)).toBe("w90_plus")
  })

  it("pencerelerin toplamı 'Vadesi Gelmemiş'i kapatır", () => {
    const totals = summarize([
      item({ openAmount: 3231, bucket: "not_due", daysUntilDue: 2, dueWindow: "w0_30" }),
      item({ openAmount: 3231, bucket: "not_due", daysUntilDue: 26, dueWindow: "w0_30" }),
      item({ openAmount: 1000, bucket: "not_due", daysUntilDue: 37, dueWindow: "w31_60" }),
      item({ openAmount: 500, bucket: "not_due", daysUntilDue: 120, dueWindow: "w90_plus" }),
    ])
    expect(totals.w0_30).toBe(6462)
    expect(totals.w31_60).toBe(1000)
    expect(totals.w61_90).toBe(0)
    expect(totals.w90_plus).toBe(500)
    expect(totals.w0_30 + totals.w31_60 + totals.w61_90 + totals.w90_plus).toBe(totals.not_due)
  })

  it("gecikmiş ve vadesiz kalem pencereye girmez", () => {
    const totals = summarize([
      item({ openAmount: 3231, bucket: "d1_30", overdueDays: 13 }),
      item({ openAmount: 900, bucket: "no_due", hasDueDate: false }),
    ])
    expect(totals.w0_30 + totals.w31_60 + totals.w61_90 + totals.w90_plus).toBe(0)
    expect(totals.overdue).toBe(3231)
    expect(totals.no_due).toBe(900)
  })
})

/**
 * EKRAN KİMLİĞİ. Tablo satırı şu kolonları basıyor:
 *   Toplam Açık | Vadesi Geçmiş | 4 pencere | Vade Tanımsız
 * Bu beş grubun toplamı "Toplam Açık"ı KAPATMAK zorunda; kapatmazsa tablo
 * borcun bir kısmını yutmuş görünür (kullanıcının ilk şikâyeti tam buydu).
 */
describe("yaşlandırma tablosu — kolonların toplamı", () => {
  it("vadesi geçmiş + pencereler + vade tanımsız = toplam açık", () => {
    const totals = summarize([
      item({ openAmount: 3231, bucket: "d1_30", overdueDays: 13 }),
      item({ openAmount: 1500, bucket: "d90_plus", overdueDays: 120 }),
      item({ openAmount: 3231, bucket: "not_due", daysUntilDue: 2, dueWindow: "w0_30" }),
      item({ openAmount: 3231, bucket: "not_due", daysUntilDue: 37, dueWindow: "w31_60" }),
      item({ openAmount: 900, bucket: "no_due", hasDueDate: false }),
    ])
    const pencereler = totals.w0_30 + totals.w31_60 + totals.w61_90 + totals.w90_plus
    expect(totals.overdue + pencereler + totals.no_due).toBe(totals.total)
    expect(totals.total).toBe(12093)
    // Pencereler "Vadesi Gelmemiş"i tam böler — Excel'de ikisi yan yana
    // durmasın diye (aynı para iki kez sayılırdı) buna güveniliyor.
    expect(pencereler).toBe(totals.not_due)
  })

  it("bugün vadesi dolan kalem gecikmiş DEĞİL, ilk pencerededir", () => {
    // bucketOf(0) = not_due: bir tam gün geçmeden gecikme sayılmaz.
    expect(bucketOf(0, true)).toBe("not_due")
    expect(dueWindowOf(0)).toBe("w0_30")
    // İlk gecikme günü 1'dir; ekranda "0 gün gecikti" diye bir hal yoktur.
    expect(bucketOf(1, true)).toBe("d1_30")
  })
})
