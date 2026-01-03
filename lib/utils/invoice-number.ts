import { prisma } from "@/lib/db/prisma"

/**
 * Firma bazlı otomatik fatura numarası oluşturur
 * Format: SAT-YYYY-XXXX veya ALI-YYYY-XXXX
 */
export async function generateInvoiceNumber(
  companyId: string,
  type: "SALES" | "PURCHASE",
  date?: Date
): Promise<string> {
  const invoiceDate = date || new Date()
  const year = invoiceDate.getFullYear()
  const prefix = type === "SALES" ? "SAT" : "ALI"

  // Bu yıl için aynı tip faturaların sayısını bul
  const startOfYear = new Date(year, 0, 1)
  const endOfYear = new Date(year, 11, 31, 23, 59, 59)

  const count = await prisma.invoice.count({
    where: {
      companyId,
      type,
      date: {
        gte: startOfYear,
        lte: endOfYear,
      },
    },
  })

  // Sıra numarası (1'den başlar, 4 haneli)
  const sequence = (count + 1).toString().padStart(4, "0")

  return `${prefix}-${year}-${sequence}`
}

