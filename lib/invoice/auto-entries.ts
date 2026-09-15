import { Prisma } from "@prisma/client"
import type { prisma } from "@/lib/db/prisma"

/**
 * Satış faturasının OTOMATİK muhasebe fişleri — tek yazım yeri.
 *
 *   120 Alıcılar  →  600 Yurtiçi Satışlar   (matrah)   referenceType = INVOICE_AUTO
 *   120 Alıcılar  →  391 Hesaplanan KDV     (KDV)      referenceType = INVOICE_AUTO_VAT
 *
 * Neden tek yer: fiş POST'ta ve fiş→fatura dönüşümünde ayrı ayrı yazılıyordu,
 * fatura DÜZENLEMEDE (PUT) hiç güncellenmiyordu — toplam değişince yevmiye eski
 * tutarda kalıyordu; sipariş/teklif→fatura dönüşümü ise fişi hiç oluşturmuyordu.
 * Aynı faturanın fişi kimi yolda var kimi yolda yoktu.
 *
 * `sync` İDEMPOTENT: varsa günceller, yoksa açar, tutar sıfıra düşmüşse siler.
 * Fiş (isReceipt) ve satış dışı belgeler için fiş YAZILMAZ; varsa (tip değişmiş
 * olamaz ama) temizlenir. Hesap planında 120/600 yoksa sessizce atlanır — hesap
 * planı kurulmamış firmada fatura kesmeyi engellemek doğru olmaz.
 */

type Tx = Prisma.TransactionClient | typeof prisma

export type AutoEntrySource = {
  companyId: string
  invoiceId: string
  invoiceNo: string
  /** Fiş tarihi = fatura tarihi (dönüşümde "bugün" yazılıyordu; dönem kayıyordu). */
  date: Date
  type: string
  isReceipt: boolean
  netAmount: number | string | Prisma.Decimal
  vatAmount: number | string | Prisma.Decimal
  createdBy?: string | null
  /** Açıklama son eki — ör. "(fişten dönüştürme)". */
  suffix?: string
}

/**
 * Sıradaki otomatik fiş numarası — firmadaki EN BÜYÜK sayısal numara + 1.
 *
 * Eski yol `Number(sonKayıt.entryNo) + 1`: sıra `createdAt`e dayanıyordu ve elle
 * "YEV-001" gibi bir numara girilmişse sonraki otomatik fiş "000NaN" oluyordu.
 * Sayısal olmayan numaralar burada yok sayılır.
 */
export async function nextAutoEntryNo(tx: Tx, companyId: string): Promise<string> {
  const rows = await tx.$queryRaw<Array<{ max: number | null }>>`
    SELECT MAX(CAST("entryNo" AS BIGINT))::int AS max
    FROM accounting_entries
    WHERE "companyId" = ${companyId} AND "entryNo" ~ '^[0-9]{1,9}$'
  `
  const max = Number(rows[0]?.max ?? 0)
  return String(max + 1).padStart(6, "0")
}

export async function syncInvoiceAutoEntries(tx: Tx, src: AutoEntrySource): Promise<void> {
  const existing = await tx.accountingEntry.findMany({
    where: {
      companyId: src.companyId,
      reference: src.invoiceId,
      referenceType: { in: ["INVOICE_AUTO", "INVOICE_AUTO_VAT"] },
    },
    select: { id: true, referenceType: true },
  })
  const byType = new Map(existing.map((e) => [e.referenceType, e.id]))

  const eligible = String(src.type).toUpperCase() === "SALES" && !src.isReceipt
  const net = Number(src.netAmount)
  const vat = Number(src.vatAmount)

  const plans = eligible
    ? await tx.accountPlan.findMany({
        where: { companyId: src.companyId, code: { in: ["120", "600", "391"] } },
        select: { id: true, code: true },
      })
    : []
  const plan = (code: string) => plans.find((p) => p.code === code)?.id ?? null
  const debit = plan("120")
  const suffix = src.suffix ? ` ${src.suffix}` : ""

  const wanted: Array<{
    referenceType: "INVOICE_AUTO" | "INVOICE_AUTO_VAT"
    creditAccountId: string
    amount: number
    description: string
  }> = []
  if (eligible && debit) {
    const sales = plan("600")
    const vatAcc = plan("391")
    if (sales && net > 0) {
      wanted.push({
        referenceType: "INVOICE_AUTO",
        creditAccountId: sales,
        amount: net,
        description: `${src.invoiceNo} satış faturası otomatik fişi${suffix}`,
      })
    }
    if (vatAcc && vat > 0) {
      wanted.push({
        referenceType: "INVOICE_AUTO_VAT",
        creditAccountId: vatAcc,
        amount: vat,
        description: `${src.invoiceNo} KDV otomatik fişi${suffix}`,
      })
    }
  }

  // Artık istenmeyenleri sil (tutar sıfıra düştü, ya da uygun belge değil).
  const wantedTypes = new Set(wanted.map((w) => w.referenceType))
  const stale = existing.filter((e) => !wantedTypes.has(e.referenceType as never)).map((e) => e.id)
  if (stale.length > 0) {
    await tx.accountingEntry.deleteMany({ where: { id: { in: stale } } })
  }

  for (const w of wanted) {
    const id = byType.get(w.referenceType)
    if (id) {
      await tx.accountingEntry.update({
        where: { id },
        data: {
          date: src.date,
          description: w.description,
          debitAccountId: debit!,
          creditAccountId: w.creditAccountId,
          amount: w.amount,
        },
      })
    } else {
      await tx.accountingEntry.create({
        data: {
          companyId: src.companyId,
          entryNo: await nextAutoEntryNo(tx, src.companyId),
          date: src.date,
          description: w.description,
          debitAccountId: debit!,
          creditAccountId: w.creditAccountId,
          amount: w.amount,
          reference: src.invoiceId,
          referenceType: w.referenceType,
          createdBy: src.createdBy ?? null,
        },
      })
    }
  }
}
