import { prisma } from "@/lib/db/prisma"

/** invoiceType (E_INVOICE/E_ARCHIVE) → Mysoft belge tipi (1=E-Fatura, 2=E-Arşiv). */
export function invoiceTypeToEDocumentType(invoiceType: string | null | undefined): number | null {
  if (invoiceType === "E_INVOICE") return 1
  if (invoiceType === "E_ARCHIVE") return 2
  return null
}

/**
 * Firma + belge tipi için gönderimde kullanılacak AKTİF şablon adını döndürür.
 * Mysoft'un set-default API'si olmadığından "aktif tasarım" seçimi Kobipo'da
 * tutulur; gönderim payload'ındaki `xsltName` ile eşleşir. Yoksa null (Mysoft
 * kendi varsayılan/genel dizaynını kullanır).
 */
export async function getActiveXsltName(
  companyId: string,
  eDocumentType: number,
): Promise<string | null> {
  try {
    const row = await prisma.eInvoiceTemplate.findFirst({
      where: { companyId, eDocumentType, isActive: true },
      select: { xsltName: true },
    })
    return row?.xsltName ?? null
  } catch {
    return null
  }
}
