/**
 * Cari yaşlandırma hesabı.
 *
 * `app/api/raporlar/cari-yaslandirma/route.ts`ten ayıklandı: dışa aktarma ile
 * ekranın aynı vade/gecikme/performans sayılarını üretmesi için tek kaynak.
 */

import { prisma } from "@/lib/db/prisma"
import { AGING_BUCKETS, OVERDUE_BUCKETS, bucketOf, type AgingBucket } from "./cari-yaslandirma-buckets"
import { getCheckNoteCreditMap } from "@/lib/cari/check-credit"
import {
  PURCHASE_RETURN_WHERE,
  SALES_RETURN_WHERE,
  payableSign,
  receivableSign,
} from "@/lib/cari/invoice-direction"

const DAY_MS = 24 * 60 * 60 * 1000

// Kova sözlüğü SAF modülde (ekran ve Excel de okuyor); buradan yeniden dışa veriliyor.
export {
  AGING_BUCKETS,
  OVERDUE_BUCKETS,
  AGING_BUCKET_LABEL,
  bucketOf,
} from "./cari-yaslandirma-buckets"
export type { AgingBucket } from "./cari-yaslandirma-buckets"

export type AgingTotals = Record<AgingBucket, number> & {
  /** Ölçülebilen gecikme kovalarının toplamı (türetilmiş). */
  overdue: number
  overdueAvgDays: number
  performanceAvgDays: number
  performanceScore: number
  performanceLabel: string
  total: number
  /**
   * Çift rollü caride KARŞI yöndeki açık belgelerin mahsup ettiği tutar.
   * Aynı müşteri kaydına işlenmiş alış faturaları gibi. Cari bakiyesi bunu
   * düşüyordu, yaşlandırma düşmüyordu: bir hesapta kart −78.365 TL (biz
   * borçluyuz) derken rapor +116.062 TL alacak yazıyordu.
   */
  offsetCredit: number
}

export type AgingInvoice = {
  id: string
  invoiceNo: string
  date: Date
  effectiveDueDate: Date
  /** Vade GERÇEKTEN tanımlı mı (fatura vadesi ya da cari vade günü). */
  hasDueDate: boolean
  totalAmount: number
  paidAmount: number
  openAmount: number
  lastPaymentDate: Date | null
  overdueDays: number
  bucket: AgingBucket
  /** Ödenen kısım için: son ödeme − vade. */
  performanceDays: number
  /** Açık kalan kısım için: bugün − vade. Kısmi ödeme skoru şişirmesin diye ayrı. */
  openPerformanceDays: number
}

export type AgingAccount = {
  id: string
  name: string
  code: string | null
  paymentDueDays: number | null
  taxNumber: string | null
  /** Cari kartındaki sınıflandırmalar (Ayarlar → Tanımlar); tanımsızsa boş string. */
  class1: string
  class2: string
  totals: AgingTotals
  invoices: AgingInvoice[]
}

export type CariAgingOptions = {
  /**
   * Satış TASLAKLARI da alacak sayılsın mı (varsayılan hayır). Taslak/GİB
   * taslağı henüz kesilmemiş belgedir; ölçümde bir firmada 118 taslak
   * 187.121 TL'lik "vadesi geçmiş alacak" üretiyordu. ALIŞ tarafında DRAFT
   * "Kayıtlı" anlamına geldiği için orada ayıklama YAPILMAZ.
   */
  includeDrafts?: boolean
}

function emptyTotals(): AgingTotals {
  return {
    not_due: 0,
    d1_30: 0,
    d31_60: 0,
    d61_90: 0,
    d90_plus: 0,
    no_due: 0,
    overdue: 0,
    overdueAvgDays: 0,
    performanceAvgDays: 0,
    performanceScore: 0,
    performanceLabel: "Veri yok",
    total: 0,
    offsetCredit: 0,
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function round2(value: number) {
  return Number(value.toFixed(2))
}

/**
 * Vade: faturanın kendi vadesi, yoksa cari kartındaki vade günü. İkisi de yoksa
 * vade BİLİNMİYOR — fatura tarihi yalnız sıralama/plan için kullanılır, belge
 * "gecikmiş" sayılmaz (bkz. `no_due`).
 */
function resolveEffectiveDue(
  invoice: any,
  paymentDueDays: number | null
): { ms: number; explicit: boolean } {
  const baseDate = new Date(invoice.date).getTime()
  const explicitDue = invoice.dueDate ? new Date(invoice.dueDate).getTime() : null
  if (explicitDue !== null) return { ms: explicitDue, explicit: true }
  if (typeof paymentDueDays === "number" && paymentDueDays > 0) {
    return { ms: baseDate + paymentDueDays * DAY_MS, explicit: true }
  }
  return { ms: baseDate, explicit: false }
}

function computePerformanceScore(avgDays: number) {
  // Erken ödemeyi pozitif, gecikmeyi negatif etkileyen sade bir ölçek.
  if (!Number.isFinite(avgDays)) {
    return { score: 0, label: "Veri yok" }
  }
  const rawScore = avgDays <= 0 ? 100 + Math.abs(avgDays) * 0.8 : 100 - avgDays * 2
  const score = Math.round(clamp(rawScore, 0, 100))
  let label = "Zamanında"
  if (avgDays <= -3) label = "Erken ödeyen"
  else if (avgDays >= 15) label = "Riskli"
  else if (avgDays >= 4) label = "Gecikmeli"
  return { score, label }
}

function bucketize(invoice: any, paymentDueDays: number | null, today: number): AgingInvoice | null {
  const total = Number(invoice.totalAmount)
  if (total <= 0) return null
  const payments = (invoice.payments || []).map((p: any) => ({
    amount: Number(p.amount),
    paymentDate: p.paymentDate ? new Date(p.paymentDate) : null,
  }))
  const paid = payments.reduce((s: number, p: any) => s + Number(p.amount), 0)
  const open = round2(total - paid)

  const due = resolveEffectiveDue(invoice, paymentDueDays)
  const effectiveDueMs = due.ms
  const overdueDays = Math.floor((today - effectiveDueMs) / DAY_MS)
  const sortedByDate = payments
    .filter((p: any) => p.paymentDate)
    .sort((a: any, b: any) => a.paymentDate.getTime() - b.paymentDate.getTime())
  const lastPaymentDate = sortedByDate.length > 0 ? sortedByDate[sortedByDate.length - 1].paymentDate : null
  const performanceRefMs = (lastPaymentDate ?? new Date(today)).getTime()
  const performanceDays = Math.floor((performanceRefMs - effectiveDueMs) / DAY_MS)
  // Açık kalan kısım BUGÜNE göre ölçülür: 22.000 TL'lik faturaya 500 TL yatıran
  // müşteri, kalan 21.500 için de "zamanında ödedi" sayılıyordu.
  const openPerformanceDays = overdueDays
  const bucket = bucketOf(overdueDays, due.explicit)

  return {
    id: invoice.id,
    invoiceNo: invoice.invoiceNo,
    date: invoice.date,
    effectiveDueDate: new Date(effectiveDueMs),
    hasDueDate: due.explicit,
    totalAmount: total,
    paidAmount: paid,
    openAmount: open,
    lastPaymentDate,
    overdueDays: Math.max(0, overdueDays),
    bucket,
    performanceDays,
    openPerformanceDays,
  }
}

function openingBalanceToAgingItem(
  account: {
    id: string
    createdAt: Date
    openingBalanceAmount: unknown
    openingBalanceType: string | null
    paymentDueDays: number | null
  },
  today: number
): AgingInvoice | null {
  const openingAmount = Number(account.openingBalanceAmount || 0)
  if (!Number.isFinite(openingAmount) || openingAmount <= 0) return null
  // Current balance conventions treat DEBIT as positive receivable/payable exposure.
  if (String(account.openingBalanceType || "DEBIT").toUpperCase() !== "DEBIT") return null

  const baseDate = new Date(account.createdAt)
  // Açılış bakiyesinin vadesi ancak cari kartında vade günü varsa bilinir; yoksa
  // "vade tanımsız"dır — hesabın açıldığı gün vadesi dolmuş sayılamaz.
  const hasDueDate = typeof account.paymentDueDays === "number" && account.paymentDueDays > 0
  const dueMs = hasDueDate
    ? baseDate.getTime() + (account.paymentDueDays as number) * DAY_MS
    : baseDate.getTime()
  const overdueDays = Math.floor((today - dueMs) / DAY_MS)
  const amount = round2(openingAmount)

  return {
    id: `opening-${account.id}`,
    invoiceNo: "Açılış Bakiyesi",
    date: baseDate,
    effectiveDueDate: new Date(dueMs),
    hasDueDate,
    totalAmount: amount,
    paidAmount: 0,
    openAmount: amount,
    lastPaymentDate: null,
    overdueDays: Math.max(0, overdueDays),
    bucket: bucketOf(overdueDays, hasDueDate),
    performanceDays: overdueDays,
    openPerformanceDays: overdueDays,
  }
}

/**
 * İadenin kapatabileceği NET tutar.
 *
 * Yalnız İŞLEME BAĞLI OLMAYAN geri ödemeler düşülür. İşleme bağlı olan (ör.
 * kasadan yapılan iade ödemesi) havuza zaten `expenseSum`/`incomeSum` üzerinden
 * eksi olarak giriyor; burada da düşülseydi aynı geri ödeme İKİ KEZ sayılır ve
 * müşteri, iade ettiği malın borcunu taşımaya devam ederdi.
 */
function returnCreditOf(inv: {
  totalAmount: unknown
  payments?: Array<{ amount: unknown; transactionId?: string | null }>
}): number {
  const refunded = (inv.payments || []).reduce(
    (sum, p) => sum + (p.transactionId ? 0 : Number(p.amount)),
    0,
  )
  return Math.max(0, round2(Number(inv.totalAmount) - refunded))
}

/**
 * Faturaya bağlanmamış serbest tahsilat/ödeme havuzunu (ör. cari ekranındaki
 * "Tahsilat Ekle" ile girilen INCOME işlemi) açık fatura kalemlerine eskiden
 * yeniye (FIFO) uygular. Böylece hesap bakiyesi kapanmışsa yaşlandırma da açık
 * göstermez. Havuz tutarı pozitif değilse bir şey yapmaz.
 */
function applyUnallocatedCredits(items: AgingInvoice[], pool: number) {
  if (!(pool > 0)) return
  let remaining = pool
  // Vadesi en eski kalemden başlayarak kapat.
  const ordered = [...items].sort(
    (a, b) => a.effectiveDueDate.getTime() - b.effectiveDueDate.getTime(),
  )
  for (const item of ordered) {
    if (remaining <= 0) break
    if (item.openAmount <= 0) continue
    const applied = Math.min(item.openAmount, remaining)
    item.openAmount = round2(item.openAmount - applied)
    remaining = round2(remaining - applied)
    if (item.openAmount <= 0) {
      // Tamamen tahsil edildi: artık açık/gecikmiş değil.
      item.openAmount = 0
      item.overdueDays = 0
      item.bucket = item.hasDueDate ? "not_due" : "no_due"
    }
  }
}

/** Kalemlerden hesap toplamı — kovalar, ortalama gecikme, performans. */
export function summarize(invoices: AgingInvoice[]): AgingTotals {
  const totals = emptyTotals()
  let overdueWeightedDays = 0
  let overdueWeight = 0
  let perfWeightedDays = 0
  let perfWeight = 0

  for (const inv of invoices) {
    totals[inv.bucket] += inv.openAmount
    totals.total += inv.openAmount

    if (OVERDUE_BUCKETS.includes(inv.bucket)) {
      totals.overdue += inv.openAmount
      overdueWeightedDays += inv.overdueDays * inv.openAmount
      overdueWeight += inv.openAmount
    }

    // Vadesi TANIMSIZ belge performansa girmez: neye göre geciktiğini
    // bilmiyoruz. Girseydi skor, müşterinin davranışını değil vade boşluğunu
    // ölçerdi (ölçüldü: bir firmada 5 hesabın 5'i "Riskli", 4/100).
    if (!inv.hasDueDate) continue

    // Ödenen kısım SON ÖDEMEYE göre: erken ödeme eksi, geç ödeme artı gün.
    if (inv.paidAmount > 0) {
      perfWeightedDays += inv.performanceDays * inv.paidAmount
      perfWeight += inv.paidAmount
    }
    // Açık kısım YALNIZ GECİKMİŞSE sayılır. Vadesi henüz gelmemiş bir borç,
    // müşterinin davranışı hakkında hiçbir şey söylemez; sayılınca eksi gün
    // üretiyor ve hiç ödeme yapmamış hesap "Erken ödeyen 100/100" görünüyordu
    // (ölçüldü: 283.599,73 TL açık, tek kuruş ödeme yok, skor 100).
    if (inv.openAmount > 0 && inv.openPerformanceDays > 0) {
      perfWeightedDays += inv.openPerformanceDays * inv.openAmount
      perfWeight += inv.openAmount
    }
  }
  totals.overdueAvgDays = overdueWeight > 0 ? round2(overdueWeightedDays / overdueWeight) : 0
  totals.performanceAvgDays = perfWeight > 0 ? round2(perfWeightedDays / perfWeight) : 0
  // Ölçülebilir hiç belge yoksa skor uydurulmaz.
  const perf = perfWeight > 0 ? computePerformanceScore(totals.performanceAvgDays) : { score: 0, label: "Veri yok" }
  totals.performanceScore = perf.score
  totals.performanceLabel = perf.label
  return totals
}

export type CariAgingResult = {
  asOf: string
  customers: { accounts: AgingAccount[]; totals: AgingTotals }
  suppliers: { accounts: AgingAccount[]; totals: AgingTotals }
  /**
   * Sayılmayan satış taslakları. Cari kartındaki bakiye bunları İÇERİR; rapor
   * içermez. Söylenmezse kullanıcı iki ekranda iki farklı rakam görüp hangisinin
   * doğru olduğunu bilemez.
   */
  excludedDrafts: { count: number; amount: number }
}

/** Satış tarafında sayılmayacak durumlar. Alışta DRAFT "Kayıtlı" demek, elenmez. */
const SALES_EXCLUDED_STATUSES = ["CANCELLED", "CONVERTED", "DRAFT", "GIB_DRAFT"]
const ALWAYS_EXCLUDED_STATUSES = ["CANCELLED", "CONVERTED"]

export async function computeCariAging(
  companyId: string,
  options: CariAgingOptions = {}
): Promise<CariAgingResult> {
  const today = Date.now()
  const salesStatusFilter = {
    notIn: options.includeDrafts ? ALWAYS_EXCLUDED_STATUSES : SALES_EXCLUDED_STATUSES,
  }

  const customers = await prisma.customer.findMany({
    where: { companyId },
    select: {
      id: true,
      name: true,
      code: true,
      paymentDueDays: true,
      taxNumber: true,
      classification1: { select: { label: true } },
      classification2: { select: { label: true } },
      openingBalanceAmount: true,
      openingBalanceType: true,
      createdAt: true,
      invoices: {
        // İADE de çekilir: satış iadesi alacağı azaltır. Yaşlandırma kalemi
        // OLARAK eklenmez (negatif bir kalemi vadelendirmek anlamsız) — aşağıda
        // serbest kredi havuzuna girip açık faturaları FIFO kapatır. Kural:
        // lib/cari/invoice-direction.ts.
        where: {
          // Çift rollü cari: AYNI müşteri kaydına işlenmiş ALIŞ faturaları da
          // çekilir; açık kısımları alacağı mahsup eder (cari bakiyesi bunu
          // zaten yapıyordu, yaşlandırma yapmıyordu).
          OR: [{ type: "SALES" }, SALES_RETURN_WHERE(), { type: "PURCHASE" }, PURCHASE_RETURN_WHERE()],
          status: { notIn: ALWAYS_EXCLUDED_STATUSES },
        },
        select: {
          id: true,
          invoiceNo: true,
          type: true,
          returnKind: true,
          status: true,
          date: true,
          dueDate: true,
          totalAmount: true,
          payments: { select: { amount: true, paymentDate: true, transactionId: true } },
        },
      },
      // Faturaya bağlanmamış serbest tahsilat/ödeme işlemleri (Tahsilat Ekle →
      // INCOME). Açık faturaları kapatmak için kullanılır.
      transactions: { select: { type: true, amount: true } },
    },
    orderBy: { name: "asc" },
  })

  const suppliers = await prisma.supplier.findMany({
    where: { companyId },
    select: {
      id: true,
      name: true,
      code: true,
      paymentDueDays: true,
      taxNumber: true,
      classification1: { select: { label: true } },
      classification2: { select: { label: true } },
      openingBalanceAmount: true,
      openingBalanceType: true,
      createdAt: true,
      invoices: {
        // Alış iadesi borcumuzu azaltır → kalem değil, kredi havuzu (yukarıdaki not).
        where: {
          // Çift rollü cari (ters yön): tedarikçi kaydına işlenmiş SATIŞ
          // faturalarının açık kısmı borcu mahsup eder.
          OR: [{ type: "PURCHASE" }, PURCHASE_RETURN_WHERE(), { type: "SALES" }, SALES_RETURN_WHERE()],
          status: { notIn: ALWAYS_EXCLUDED_STATUSES },
        },
        select: {
          id: true,
          invoiceNo: true,
          type: true,
          returnKind: true,
          status: true,
          date: true,
          dueDate: true,
          totalAmount: true,
          payments: { select: { amount: true, paymentDate: true, transactionId: true } },
        },
      },
      // Faturaya bağlanmamış serbest ödeme işlemleri (Ödeme Ekle → EXPENSE).
      transactions: { select: { type: true, amount: true } },
    },
    orderBy: { name: "asc" },
  })

  // Çek/senet kredileri (iade/protesto hariç): cariId→tutar. Serbest tahsilat gibi
  // açık faturaları FIFO kapatır.
  const [customerCheckCredit, supplierCheckCredit] = await Promise.all([
    getCheckNoteCreditMap("customer", companyId),
    getCheckNoteCreditMap("supplier", companyId),
  ])

  /** Satış tarafında taslak belgeler istenmedikçe sayılmaz. */
  const salesCounts = (inv: { status: string }) =>
    options.includeDrafts || !SALES_EXCLUDED_STATUSES.includes(inv.status)

  // Sayılmayan taslakların TUTARI: ekranda ve dosyada açıkça yazılır.
  const excludedDrafts = { count: 0, amount: 0 }
  if (!options.includeDrafts) {
    // Tedarikçi kaydına işlenmiş satış taslakları da sayılmıyor (çift rollü
    // caride borcu mahsup ederlerdi); uyarı iki sekmede de doğru olsun.
    for (const party of [...customers, ...suppliers]) {
      for (const inv of party.invoices) {
        if (receivableSign(inv) > 0 && SALES_EXCLUDED_STATUSES.includes(inv.status)) {
          excludedDrafts.count += 1
          excludedDrafts.amount += Number(inv.totalAmount || 0)
        }
      }
    }
    excludedDrafts.amount = round2(excludedDrafts.amount)
  }

  const customerAccounts: AgingAccount[] = customers
    .map((c) => {
      // İadeler kalem listesine GİRMEZ; kapattıkları tutar krediye yazılır.
      const returnCredit = c.invoices
        .filter((inv) => receivableSign(inv) < 0 && salesCounts(inv))
        .reduce((sum, inv) => sum + returnCreditOf(inv), 0)
      // Çift rollü cari: bu kayda işlenmiş ALIŞ belgelerinin açık kısmı (alış −
      // alış iadesi) alacağı mahsup eder. Alışta taslak "Kayıtlı" demek olduğu
      // için orada ayıklama yapılmaz.
      const offsetCredit = round2(
        Math.max(
          0,
          c.invoices
            .filter((inv) => payableSign(inv) > 0)
            .reduce((sum, inv) => sum + returnCreditOf(inv), 0) -
            c.invoices
              .filter((inv) => payableSign(inv) < 0)
              .reduce((sum, inv) => sum + returnCreditOf(inv), 0)
        )
      )
      const analyzed = c.invoices
        .filter((inv) => receivableSign(inv) > 0 && salesCounts(inv))
        .map((inv) => bucketize(inv, c.paymentDueDays, today))
        .filter((x): x is AgingInvoice => Boolean(x))
      const openingItem = openingBalanceToAgingItem(c, today)
      if (openingItem) analyzed.push(openingItem)
      // Müşteride INCOME tahsilatları alacağı azaltır, EXPENSE artırır.
      const incomeSum = c.transactions
        .filter((t) => t.type === "INCOME")
        .reduce((s, t) => s + Number(t.amount), 0)
      const expenseSum = c.transactions
        .filter((t) => t.type === "EXPENSE")
        .reduce((s, t) => s + Number(t.amount), 0)
      // İşleme bağlı ödemeler zaten faturadan düşüldü; havuzdan da çıkar.
      // Yalnız SATIŞ faturaları: iadenin işleme bağlı geri ödemesi havuza
      // expense/income üzerinden giriyor, burada tekrar mahsuplaşmamalı.
      const linkedSum = c.invoices
        .filter((inv) => receivableSign(inv) > 0 && salesCounts(inv))
        .reduce(
          (s, inv) =>
            s + inv.payments.reduce((a, p) => a + (p.transactionId ? Number(p.amount) : 0), 0),
          0,
        )
      // Çek/senet (müşteriden alınan) alacağı kapatır → serbest krediye eklenir.
      const checkCredit = customerCheckCredit.get(c.id) || 0
      applyUnallocatedCredits(
        analyzed,
        round2(incomeSum - expenseSum - linkedSum + checkCredit + returnCredit + offsetCredit)
      )
      const invoices = analyzed.filter((inv) => inv.openAmount > 0)
      const totals = summarize(analyzed)
      totals.offsetCredit = offsetCredit
      return {
        id: c.id,
        name: c.name,
        code: c.code,
        paymentDueDays: c.paymentDueDays,
        taxNumber: c.taxNumber,
        class1: c.classification1?.label || "",
        class2: c.classification2?.label || "",
        totals,
        invoices,
      }
    })
    .filter((acc) => acc.totals.total > 0)

  const supplierAccounts: AgingAccount[] = suppliers
    .map((s) => {
      const returnCredit = s.invoices
        .filter((inv) => payableSign(inv) < 0)
        .reduce((sum, inv) => sum + returnCreditOf(inv), 0)
      // Çift rollü cari (ters yön): tedarikçi kaydına işlenmiş SATIŞ belgelerinin
      // açık kısmı borcu mahsup eder.
      const offsetCredit = round2(
        Math.max(
          0,
          s.invoices
            .filter((inv) => receivableSign(inv) > 0 && salesCounts(inv))
            .reduce((sum, inv) => sum + returnCreditOf(inv), 0) -
            s.invoices
              .filter((inv) => receivableSign(inv) < 0 && salesCounts(inv))
              .reduce((sum, inv) => sum + returnCreditOf(inv), 0)
        )
      )
      const analyzed = s.invoices
        .filter((inv) => payableSign(inv) > 0)
        .map((inv) => bucketize(inv, s.paymentDueDays, today))
        .filter((x): x is AgingInvoice => Boolean(x))
      const openingItem = openingBalanceToAgingItem(s, today)
      if (openingItem) analyzed.push(openingItem)
      // Tedarikçide EXPENSE ödemeleri borcu azaltır, INCOME artırır.
      const incomeSum = s.transactions
        .filter((t) => t.type === "INCOME")
        .reduce((sum, t) => sum + Number(t.amount), 0)
      const expenseSum = s.transactions
        .filter((t) => t.type === "EXPENSE")
        .reduce((sum, t) => sum + Number(t.amount), 0)
      // İşleme bağlı ödemeler zaten faturadan düşüldü; havuzdan da çıkar.
      const linkedSum = s.invoices
        .filter((inv) => payableSign(inv) > 0)
        .reduce(
          (sum, inv) =>
            sum + inv.payments.reduce((a, p) => a + (p.transactionId ? Number(p.amount) : 0), 0),
          0,
        )
      // Çek/senet (tedarikçiye verilen) borcu kapatır → serbest krediye eklenir.
      const checkCredit = supplierCheckCredit.get(s.id) || 0
      applyUnallocatedCredits(
        analyzed,
        round2(expenseSum - incomeSum - linkedSum + checkCredit + returnCredit + offsetCredit)
      )
      const invoices = analyzed.filter((inv) => inv.openAmount > 0)
      const totals = summarize(analyzed)
      totals.offsetCredit = offsetCredit
      return {
        id: s.id,
        name: s.name,
        code: s.code,
        paymentDueDays: s.paymentDueDays,
        taxNumber: s.taxNumber,
        class1: s.classification1?.label || "",
        class2: s.classification2?.label || "",
        totals,
        invoices,
      }
    })
    .filter((acc) => acc.totals.total > 0)

  const grandTotal = (accounts: AgingAccount[]): AgingTotals => {
    const t = emptyTotals()
    let overdueWeightedDays = 0
    let overdueWeight = 0
    let perfWeightedDays = 0
    let perfWeight = 0

    for (const a of accounts) {
      for (const bucket of AGING_BUCKETS) t[bucket] += a.totals[bucket]
      t.overdue += a.totals.overdue
      t.total += a.totals.total
      t.offsetCredit += a.totals.offsetCredit
      overdueWeightedDays += a.totals.overdueAvgDays * a.totals.overdue
      overdueWeight += a.totals.overdue
      // Vadesi tanımsız tutar skora girmediği için ağırlığa da girmez.
      const perfBase = a.totals.total - a.totals.no_due
      if (a.totals.performanceLabel !== "Veri yok" && perfBase > 0) {
        perfWeightedDays += a.totals.performanceAvgDays * perfBase
        perfWeight += perfBase
      }
    }
    t.overdueAvgDays = overdueWeight > 0 ? round2(overdueWeightedDays / overdueWeight) : 0
    t.performanceAvgDays = perfWeight > 0 ? round2(perfWeightedDays / perfWeight) : 0
    const perf = perfWeight > 0 ? computePerformanceScore(t.performanceAvgDays) : { score: 0, label: "Veri yok" }
    t.performanceScore = perf.score
    t.performanceLabel = perf.label
    return t
  }

  return {
    asOf: new Date().toISOString(),
    customers: {
      accounts: customerAccounts,
      totals: grandTotal(customerAccounts),
    },
    excludedDrafts,
    suppliers: {
      accounts: supplierAccounts,
      totals: grandTotal(supplierAccounts),
    },
  }
}

// Ay içi ödeme planı SAF modülde (ekran da çağırıyor); buradan yeniden dışa
// veriliyor ki çağıranlar tek adres bilsin.
export { buildPaymentPlan } from "./cari-yaslandirma-plan"
export type { PaymentPlan, PaymentPlanRow } from "./cari-yaslandirma-plan"
