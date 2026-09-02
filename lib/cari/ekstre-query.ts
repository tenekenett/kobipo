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
import { AGING_BUCKETS, type AgingBucket } from "@/lib/raporlar/cari-yaslandirma-buckets"
import { computeCariAging } from "@/lib/raporlar/cari-yaslandirma"

export type EkstreEntryType =
  | "INVOICE"
  | "INVOICE_PAYMENT"
  | "TRANSACTION"
  | "CHECK"
  | "PROMISSORY_NOTE"

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

/**
 * Ekstre yaşlandırması — kovalar YAŞLANDIRMA RAPORUYLA aynı sözlükten
 * (`lib/raporlar/cari-yaslandirma-buckets.ts`).
 *
 * Önceden burada kendi kovaları vardı (`current`/`days_0_30`/…) ve yaş
 * VADEYE değil BELGE TARİHİNE göre ölçülüyordu; `dueDate` hiç okunmuyordu.
 * Sonuç: vadesine 26 gün olan fatura "belge yaşı 69 gün" diye gecikmiş
 * sayılıyordu (ölçüldü: bir caride vadesi gelmemiş 7 faturanın 7'si de,
 * 22.617 TL, ekstrede "vadesi geçmiş" tarafında duruyordu; aynı tutar
 * yaşlandırma raporunda "vadesi gelmemiş"ti). Aynı cari, iki ekran, zıt cevap.
 *
 * İkinci kusur ödeme satırlarıydı: ekstredeki HER hareket (tahsilat dahil)
 * kovaya giriyor, tahsilat kendi tarihinin kovasına EKSİ olarak yazılıp
 * ilgisiz bir dilimi eksiltiyordu. Artık ölçü belge değil AÇIK FATURA:
 * tutar − tahsilat.
 */
export type EkstreAging = Record<AgingBucket, number>

export type EkstreResult = {
  entries: EkstreEntry[]
  totalDebit: number
  totalCredit: number
  finalBalance: number
  /**
   * CARİ SEÇİLMEDİYSE null. "Tümü" görünümünde tek bir yaşlandırma kutusu
   * anlamsızdır: alacaklar ve borçlar aynı torbaya girer. Sıfır göstermek
   * "gecikmiş borç yok" diye okunurdu — hesaplanamayan şeyi hesaplanmış gibi
   * göstermektense yok saymak doğru.
   */
  aging: EkstreAging | null
  /**
   * Yaşlandırmaya SAYILMAYAN satış taslakları. Ekstrenin hareket listesi ve
   * bakiyesi taslakları İÇERİR (durum süzgeci yalnız CANCELLED/CONVERTED'i eler),
   * yaşlandırma ise raporla aynı kuralı uygular ve saymaz. Söylenmezse aynı
   * ekranda "bakiye şu kadar ama vade kutuları tutmuyor" görünür.
   */
  agingExcludedDrafts: { count: number; amount: number } | null
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
      // Ödemeler: faturanın üzerine doğrudan işlenenler (Faturalar → Ödemeler)
      // cari işlemi ÜRETMEZ; ekstreye girmezlerse fatura tam tutarıyla borç
      // yazılı kalır ve bakiye ödenmemiş gibi görünür.
      include: {
        customer: true,
        supplier: true,
        items: true,
        payments: {
          select: { id: true, amount: true, paymentDate: true, transactionId: true, reference: true },
        },
      },
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
    // FATURAYA İŞLENEN ÖDEMELER. Yalnız `transactionId` BOŞ olanlar: cari
    // ekranından girilen tahsilat zaten Transaction olarak ayrı satır, ikisi de
    // yazılsaydı aynı ödeme iki kez düşerdi.
    //
    // Yön, faturanın yazıldığı tarafın TERSİDİR: satış faturası borç yazılır,
    // ödemesi alacak; aynı karta işlenmiş alış faturası alacak yazılır, ödemesi
    // borç. (Ölçüldü: bir caride 199.999 TL'lik alış faturası ekstreye alacak
    // düşüyor ama 199.999 TL'lik ödemesi hiç görünmüyordu — bakiye −101.186 TL
    // derken yaşlandırma +74.384 TL diyordu.)
    ...invoices.flatMap((inv) => {
      const invoiceIsDebit = receivableSign(inv) > 0 || payableSign(inv) < 0
      return inv.payments
        .filter((p) => !p.transactionId)
        .filter((p) => {
          if (!startDate && !endDate) return true
          const t = new Date(p.paymentDate).getTime()
          if (startDate && t < new Date(startDate).getTime()) return false
          if (endDate && t > new Date(endDate).getTime()) return false
          return true
        })
        .map((p) => ({
          type: "INVOICE_PAYMENT" as const,
          id: p.id,
          date: p.paymentDate,
          description: `Fatura ödemesi ${inv.eDocumentNo || inv.invoiceNo}`,
          debit: invoiceIsDebit ? 0 : Number(p.amount),
          credit: invoiceIsDebit ? Number(p.amount) : 0,
          balance: 0,
          reference: p.reference ?? (inv.eDocumentNo || inv.invoiceNo),
          data: p,
        }))
    }),
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

  const { aging, excludedDrafts: agingExcludedDrafts } = await computePartyAging(
    companyId,
    customerId,
    supplierId
  )

  return {
    entries,
    totalDebit: entries.reduce((sum, e) => sum + e.debit, 0),
    totalCredit: entries.reduce((sum, e) => sum + e.credit, 0),
    finalBalance: runningBalance,
    aging,
    agingExcludedDrafts,
  }
}

/**
 * Ekstrenin yaşlandırma kutuları — hesabı YAŞLANDIRMA RAPORU yapar.
 *
 * Kendi hesabını yazmak iki kez ayrışma üretmişti: (1) yaş vadeye değil belge
 * tarihine göre ölçülüyordu, (2) faturaya bağlanmamış tahsilat/çek/iade açık
 * kalemleri kapatmıyordu. İkisi de raporda çözülmüş; aynı fonksiyonu çağırmak
 * çözümü kopyalamaktan iyidir.
 *
 * Yaşlandırma ekrandaki tarih süzgecinden ETKİLENMEZ: "vadesi geçmiş" bugünkü
 * pozisyondur, seçili dönemin değil. Dönem süzgeci uygulansaydı Ağustos'u seçen
 * kullanıcı Eylül'de vadesi dolan borcu göremezdi.
 */
async function computePartyAging(
  companyId: string,
  customerId?: string | null,
  supplierId?: string | null
): Promise<{
  aging: EkstreAging | null
  excludedDrafts: { count: number; amount: number } | null
}> {
  if (!customerId && !supplierId) return { aging: null, excludedDrafts: null }

  const result = await computeCariAging(companyId, { customerId, supplierId })
  const account = customerId ? result.customers.accounts[0] : result.suppliers.accounts[0]
  const excludedDrafts =
    result.excludedDrafts.count > 0 ? result.excludedDrafts : null
  const zero = Object.fromEntries(AGING_BUCKETS.map((b) => [b, 0])) as EkstreAging
  // Açık bakiyesi olmayan cari listeye girmez; kovalar sıfırdır.
  if (!account) return { aging: zero, excludedDrafts }

  return {
    aging: Object.fromEntries(
      AGING_BUCKETS.map((bucket) => [bucket, account.totals[bucket]])
    ) as EkstreAging,
    excludedDrafts,
  }
}
