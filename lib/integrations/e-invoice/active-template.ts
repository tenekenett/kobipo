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

/** Bu firma+belge tipi için tanımlı en az bir prefix→şablon eşlemesi var mı? */
export async function hasSeriesTemplates(
  companyId: string,
  eDocumentType: number,
): Promise<boolean> {
  try {
    const count = await prisma.eInvoiceSeriesTemplate.count({
      where: { companyId, eDocumentType },
    })
    return count > 0
  } catch {
    return false
  }
}

/**
 * Gönderimde kullanılacak şablonu seri no (prefix) önceliğiyle çözer:
 *  1) prefix'e atanmış şablon (EInvoiceSeriesTemplate) varsa onu döndürür,
 *  2) yoksa firma genel aktif şablonuna (getActiveXsltName) düşer.
 * prefix boşsa (Mysoft varsayılan numaratörü) doğrudan genel aktif şablon kullanılır.
 */
export async function getXsltNameForSeries(
  companyId: string,
  eDocumentType: number,
  prefix: string | null | undefined,
): Promise<string | null> {
  const cleanPrefix = (prefix || "").trim()
  if (cleanPrefix) {
    try {
      const mapped = await prisma.eInvoiceSeriesTemplate.findUnique({
        where: {
          companyId_eDocumentType_prefix: { companyId, eDocumentType, prefix: cleanPrefix },
        },
        select: { xsltName: true },
      })
      if (mapped?.xsltName) return mapped.xsltName
    } catch {
      // eşleme okunamadıysa genel aktif şablona düş
    }
  }
  return getActiveXsltName(companyId, eDocumentType)
}
