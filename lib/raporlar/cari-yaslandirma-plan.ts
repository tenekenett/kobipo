/**
 * Ay içi ödeme planı — SAF hesap.
 *
 * Ayrı dosya çünkü ekran da çağırıyor: `cari-yaslandirma.ts` en üstte Prisma'yı
 * içe aktarıyor ve oradan bir FONKSİYON import eden istemci bileşeni Prisma'yı
 * tarayıcı paketine sürükler (aynı ayrım `satis-alis-shared.ts`te de var).
 */

/**
 * Girdi YAPISAL tanımlanır (`AgingAccount`e bağlanmaz): ekran aynı veriyi uçtan
 * JSON olarak alıyor ve orada tarihler string oluyor. Tipi kopyalamak yerine
 * ihtiyacı yazmak, ekranda `as any` gerektirmez.
 */
export type PaymentPlanInput = {
  id: string
  code: string | null
  name: string
  class1: string
  class2: string
  invoices: Array<{
    effectiveDueDate: Date | string
    openAmount: number
    hasDueDate: boolean
  }>
}

function round2(value: number) {
  return Number(value.toFixed(2))
}

const MONTH_ONLY = /^\d{4}-\d{2}$/

/**
 * Plan hangi AYI böler. Ekran ileri/geri gezinirken ve dosya aynı ayı üretirken
 * tek kural: `YYYY-MM` (ör. "2026-10"). Geçersiz/boş değer bugünün ayına düşer —
 * uçtan elle gelen bir çöp değer raporu patlatmasın.
 *
 * Ayın 1'i seçilir: `new Date(2026, 9, 31)` gibi bir referansla çalışılsaydı,
 * ayın son gününde "gelecek ay" hesabı bir gün kayardı.
 */
export function resolvePlanMonth(value?: string | null, fallback: Date = new Date()): Date {
  if (value && MONTH_ONLY.test(value)) {
    const [year, month] = value.split("-").map(Number)
    if (month >= 1 && month <= 12) return new Date(year, month - 1, 1)
  }
  return new Date(fallback.getFullYear(), fallback.getMonth(), 1)
}

/** `Date` → `YYYY-MM`. Uca/dosyaya giden değer bu biçimde taşınır. */
export function formatPlanMonth(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

/**
 * AY İÇİ ÖDEME PLANI — ayı üç on günlük dilime böler (1-10, 11-20, 21-ay sonu) ve
 * her cari için o dilime VADESİ DÜŞEN açık tutarı toplar.
 *
 * Geçmiş/sonraki aylara düşen ve vadesi HİÇ tanımlı olmayan tutarlar kendi
 * sütunlarında ayrı durur: yoksa satırdaki üç dilimin toplamı "toplam açık"ı
 * tutmaz ve tablo, borcun bir kısmını yutmuş gibi görünürdü. Kimlik:
 * `Vade Tanımsız + Geçmiş Aylar + Bu Ay Toplam + Sonraki Aylar = Toplam Açık`.
 *
 * `pastMonths`, yaşlandırmanın `totals.overdue`u DEĞİLDİR: buradaki ölçü ayın 1'i,
 * orada bugündür. Ayın 20'sinde, vadesi 5'inde olan fatura gecikmiştir ama planda
 * "1-10" diliminde görünür — dilim tanımı vade tarihine göredir.
 */
export type PaymentPlanRow = {
  id: string
  code: string | null
  name: string
  class1: string
  class2: string
  /**
   * Vadesi HİÇ tanımlı olmayan açık tutar. Ayrı sütun: bu belgelerin ne zaman
   * tahsil edileceği bilinmiyor, "geçmiş aylara" yazmak plana girmemiş bir
   * beklentiyi geçmiş gibi gösterirdi (yaşlandırma ekranı da bunları
   * "Vade Tanımsız" diye ayırıyor).
   */
  noDue: number
  /** Vadesi bu aydan ÖNCE olan açık tutar. */
  pastMonths: number
  period1: number
  period2: number
  period3: number
  monthTotal: number
  nextMonths: number
  total: number
}

export type PaymentPlan = {
  /** Sütun başlıkları — ay adıyla ("1-10 Eylül"). */
  labels: { period1: string; period2: string; period3: string }
  rows: PaymentPlanRow[]
}

export function buildPaymentPlan(accounts: PaymentPlanInput[], reference = new Date()): PaymentPlan {
  const year = reference.getFullYear()
  const month = reference.getMonth()
  const monthStart = new Date(year, month, 1).getTime()
  // Dilim sınırları GÜN başlangıcıdır; 11'i vadeli fatura ikinci dilime girer.
  const secondStart = new Date(year, month, 11).getTime()
  const thirdStart = new Date(year, month, 21).getTime()
  const nextMonthStart = new Date(year, month + 1, 1).getTime()
  const monthName = reference.toLocaleDateString("tr-TR", { month: "long" })
  const lastDay = new Date(year, month + 1, 0).getDate()

  const rows = accounts.map((account) => {
    const row: PaymentPlanRow = {
      id: account.id,
      code: account.code,
      name: account.name,
      class1: account.class1,
      class2: account.class2,
      noDue: 0,
      pastMonths: 0,
      period1: 0,
      period2: 0,
      period3: 0,
      monthTotal: 0,
      nextMonths: 0,
      total: 0,
    }
    for (const invoice of account.invoices) {
      const due = new Date(invoice.effectiveDueDate).getTime()
      const amount = invoice.openAmount
      row.total += amount
      // Vade yoksa dilim de yok: `effectiveDueDate` bu belgelerde fatura tarihine
      // düşer ve hepsi "Geçmiş Aylar"da toplanıp planı boş gösteriyordu.
      if (!invoice.hasDueDate) row.noDue += amount
      else if (due < monthStart) row.pastMonths += amount
      else if (due >= nextMonthStart) row.nextMonths += amount
      else if (due < secondStart) row.period1 += amount
      else if (due < thirdStart) row.period2 += amount
      else row.period3 += amount
    }
    row.monthTotal = round2(row.period1 + row.period2 + row.period3)
    row.noDue = round2(row.noDue)
    row.pastMonths = round2(row.pastMonths)
    row.period1 = round2(row.period1)
    row.period2 = round2(row.period2)
    row.period3 = round2(row.period3)
    row.nextMonths = round2(row.nextMonths)
    row.total = round2(row.total)
    return row
  })

  return {
    labels: {
      period1: `1-10 ${monthName}`,
      period2: `11-20 ${monthName}`,
      period3: `21-${lastDay} ${monthName}`,
    },
    rows,
  }
}
