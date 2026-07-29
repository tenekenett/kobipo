import { prisma } from "@/lib/db/prisma"

// Biçim kuralları ayrı modülde: bu dosya prisma çektiği için client component'ten
// import edilemiyor. Sunucu tarafı çağıranlar buradan da erişebilsin diye re-export.
export {
  INVOICE_NO_MAX_LENGTH,
  INVOICE_NO_ALLOWED,
  normalizeManualInvoiceNo,
} from "@/lib/utils/invoice-number-format"
export type { ManualInvoiceNoResult } from "@/lib/utils/invoice-number-format"

/**
 * Firma bazlı otomatik fatura numarası oluşturur
 * Format: SAT-YYYY-XXXX veya ALI-YYYY-XXXX
 * Fiş (isReceipt=true) için: FS-SAT-YYYY-XXXX / FS-ALI-YYYY-XXXX (ayrık dizi).
 */
export async function generateInvoiceNumber(
  companyId: string,
  type: "SALES" | "PURCHASE" | "RETURN",
  date?: Date,
  isReceipt?: boolean
): Promise<string> {
  const invoiceDate = date || new Date()
  const year = invoiceDate.getFullYear()
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { invoiceSeriesPrefix: true },
  })
  const defaultPrefix = type === "SALES" ? "SAT" : type === "RETURN" ? "IAD" : "ALI"
  // Fiş numarası firmanın fatura önekinden bağımsız, sabit "FS-" ile başlar; böylece
  // resmî fatura numaralarıyla çakışmaz ve fiş dizisi ayrı ilerler.
  const prefix = isReceipt
    ? `FS-${defaultPrefix}`
    : type === "RETURN"
      ? defaultPrefix
      : company?.invoiceSeriesPrefix || defaultPrefix
  const fullPrefix = `${prefix}-${year}-`

  // Aynı önekli mevcut faturaları çek. Sayma (count+1) tabanlı üretim, silme
  // kaynaklı boşluklarda var olan bir numarayla çakışabiliyordu (P2002); bu
  // yüzden en büyük sıra numarasını baz alıp boş numara bulana dek ilerliyoruz.
  const existing = await prisma.invoice.findMany({
    where: { companyId, invoiceNo: { startsWith: fullPrefix } },
    select: { invoiceNo: true },
  })

  let maxSeq = 0
  const taken = new Set<string>()
  for (const { invoiceNo } of existing) {
    taken.add(invoiceNo)
    const parsed = parseInt(invoiceNo.slice(fullPrefix.length), 10)
    if (Number.isFinite(parsed) && parsed > maxSeq) maxSeq = parsed
  }

  // En büyük + 1'den başla; teorik çakışmalara karşı serbest numarayı garanti et.
  let seq = maxSeq + 1
  let candidate = `${fullPrefix}${String(seq).padStart(4, "0")}`
  while (taken.has(candidate)) {
    seq += 1
    candidate = `${fullPrefix}${String(seq).padStart(4, "0")}`
  }
  return candidate
}

