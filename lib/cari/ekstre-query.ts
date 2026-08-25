/**
 * Cari ekstre (hesap hareketleri) sorgusu.
 *
 * `app/api/cari/ekstre/route.ts`ten ayıklandı: dışa aktarma da AYNI hareketleri,
 * AYNI borç/alacak yönünü ve AYNI yürüyen bakiyeyi üretmek zorunda. Ekstre
 * ekranı daha önce kendi tek seferlik XLSX kodunu yazıyordu; artık ikisi de bu
 * fonksiyonu çağırıyor.
 */

import { prisma } from "@/lib/db/prisma"
import { isPurchaseReturn, payableSign, receivableSign } from "@/lib/cari/invoice-direction"

export type EkstreEntryType = "INVOICE" | "TRANSACTION" | "CHECK" | "PROMISSORY_NOTE"

export type EkstreEntry = {
  type: EkstreEntryType
  id: string
  date: Date
  description: string
  debit: number
  credit: number
  balance: number
  reference: string | null
  /** Ham kayıt — uç sözleşmesi için taşınır, dışa aktarma kullanmaz. */
  data: unknown
}

export type EkstreAging = {
  current: number
  days_0_30: number
  days_31_60: number
  days_61_90: number
  days_90_plus: number
}

export type EkstreResult = {
  entries: EkstreEntry[]
  totalDebit: number
  totalCredit: number
  finalBalance: number
  aging: EkstreAging
}

export type EkstreOptions = {
  companyId: string
  customerId?: string | null
  supplierId?: string | null
  startDate?: string | null
  endDate?: string | null
}

export async function fetchEkstre(options: EkstreOptions): Promise<EkstreResult> {
  const { companyId, customerId, supplierId, startDate, endDate } = options

  const where: any = {
    companyId,
    status: { notIn: ["CANCELLED", "CONVERTED"] },
  }
  if (customerId) where.customerId = customerId
  if (supplierId) where.supplierId = supplierId
  if (startDate || endDate) {
    where.date = {}
    if (startDate) where.date.gte = new Date(startDate)
    if (endDate) where.date.lte = new Date(endDate)
  }

  // Çek/senette tarih alanı `dueDate`, fatura/işlemde `date`.
  const dateRange = (field: "date" | "dueDate") =>
    startDate || endDate
      ? {
          [field]: {
            ...(startDate && { gte: new Date(startDate) }),
            ...(endDate && { lte: new Date(endDate) }),
          },
        }
      : {}

  const partyFilter = {
    ...(customerId && { customerId }),
    ...(supplierId && { supplierId }),
  }

  const [invoices, transactions, checks, promissoryNotes] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: { customer: true, supplier: true, items: true },
      orderBy: { date: "desc" },
    }),
    prisma.transaction.findMany({
      where: { companyId, ...partyFilter, ...dateRange("date") },
      include: { account: true, customer: true, supplier: true },
      orderBy: { date: "desc" },
    }),
    prisma.check.findMany({
      where: { companyId, ...partyFilter, ...dateRange("dueDate") },
      orderBy: { dueDate: "desc" },
    }),
    prisma.promissoryNote.findMany({
      where: { companyId, ...partyFilter, ...dateRange("dueDate") },
      orderBy: { dueDate: "desc" },
    }),
  ])

  const entries: EkstreEntry[] = [
    ...invoices.map((inv) => ({
      type: "INVOICE" as const,
      id: inv.id,
      date: inv.date,
      // Ekstrede resmi GİB belge no'yu göster; yoksa iç seri numarasına düş.
      description: `${
        inv.type === "RETURN" ? (isPurchaseReturn(inv) ? "Alış iadesi" : "Satış iadesi") : "Fatura"
      } ${inv.eDocumentNo || inv.invoiceNo}`,
      // İADE, ait olduğu belgenin TERS TARAFINA yazılır: satış iadesi müşterinin
      // borcunu azalttığı için ALACAK, alış iadesi bizim borcumuzu azalttığı için
      // BORÇ olur. Önceden iade ekstreye 0/0 düşüyordu — müşteri geri verdiği malın
      // borcunu taşımaya devam ediyordu.
      debit: receivableSign(inv) > 0 || payableSign(inv) < 0 ? Number(inv.totalAmount) : 0,
      credit: payableSign(inv) > 0 || receivableSign(inv) < 0 ? Number(inv.totalAmount) : 0,
      balance: 0,
      reference: inv.eDocumentNo || inv.invoiceNo,
      data: inv,
    })),
    ...transactions.map((trx) => ({
      type: "TRANSACTION" as const,
      id: trx.id,
      date: trx.date,
      // Açıklama boşsa işlem türüne göre insanca etiket: ödeme/tahsilat.
      description:
        trx.description ||
        (trx.type === "EXPENSE"
          ? "Ödeme"
          : trx.type === "INCOME"
            ? "Tahsilat"
            : `${trx.type} - ${trx.account.name}`),
      // Cari ekstrede ödeme (EXPENSE) cariyi borçlandırır → BORÇ sütunu;
      // tahsilat (INCOME) cariyi alacaklandırır → ALACAK sütunu. Fatura tarafıyla
      // tutarlı (SALES→borç, PURCHASE→alacak): müşteri tahsilatı bakiyeyi azaltır,
      // tedarikçi ödemesi borcu azaltır.
      debit: trx.type === "EXPENSE" ? Number(trx.amount) : 0,
      credit: trx.type === "INCOME" ? Number(trx.amount) : 0,
      balance: 0,
      reference: trx.reference,
      data: trx,
    })),
    ...checks.map((check) => ({
      type: "CHECK" as const,
      id: check.id,
      date: check.dueDate,
      description: `Çek ${check.checkNo}`,
      debit: check.customerId ? Number(check.amount) : 0,
      credit: check.supplierId ? Number(check.amount) : 0,
      balance: 0,
      reference: check.checkNo,
      data: check,
    })),
    ...promissoryNotes.map((note) => ({
      type: "PROMISSORY_NOTE" as const,
      id: note.id,
      date: note.dueDate,
      description: `Senet ${note.noteNo}`,
      debit: note.customerId ? Number(note.amount) : 0,
      credit: note.supplierId ? Number(note.amount) : 0,
      balance: 0,
      reference: note.noteNo,
      data: note,
    })),
  ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  // Yürüyen bakiye
  let runningBalance = 0
  entries.forEach((entry) => {
    runningBalance += entry.debit - entry.credit
    entry.balance = runningBalance
  })

  const now = new Date()
  const aging: EkstreAging = {
    current: 0,
    days_0_30: 0,
    days_31_60: 0,
    days_61_90: 0,
    days_90_plus: 0,
  }

  entries.forEach((entry) => {
    const openAmount = entry.debit - entry.credit
    if (openAmount === 0) return
    const ageDays = Math.floor((now.getTime() - new Date(entry.date).getTime()) / (1000 * 60 * 60 * 24))
    if (ageDays < 0) {
      aging.current += openAmount
    } else if (ageDays <= 30) {
      aging.days_0_30 += openAmount
    } else if (ageDays <= 60) {
      aging.days_31_60 += openAmount
    } else if (ageDays <= 90) {
      aging.days_61_90 += openAmount
    } else {
      aging.days_90_plus += openAmount
    }
  })

  return {
    entries,
    totalDebit: entries.reduce((sum, e) => sum + e.debit, 0),
    totalCredit: entries.reduce((sum, e) => sum + e.credit, 0),
    finalBalance: runningBalance,
    aging,
  }
}
