import type { Prisma } from "@prisma/client"
import { revertInvoiceStock } from "@/lib/stock/warehouse"

type Tx = Prisma.TransactionClient

/**
 * Bir faturayı GEÇERSİZ kılar (alıcı reddi / GİB iptali): status=CANCELLED yapar,
 * stok hareketini geri alır ve integrationStatus'ü yazar.
 *
 * NEDEN TEK YER: Cari bakiye / ekstre / rapor sorgularının HEPSİ faturayı
 * `status NOT IN ('CANCELLED','CONVERTED')` ile filtreler. Dolayısıyla bir fatura
 * reddedildiğinde/ iptal edildiğinde borç/alacaktan otomatik düşmesi için TEK
 * yeterli koşul `status = 'CANCELLED'` olmasıdır. Reddin nereden geldiği (manuel
 * "Durumu Kontrol Et", gelen fatura reddi, portal senkronu, toplu senkron) fark
 * etmemeli — hepsi bu yardımcıyı çağırmalı ki hiçbir yol "status'ü CANCELLED
 * yapmayı unutma" hatasına düşmesin. (Geçmişte her yol ayrı ayrı yazıyordu ve
 * bazıları yalnızca integrationStatus'ü REJECTED:RED yapıp status'ü SENT bırakıyordu;
 * bu yüzden reddedilen faturanın tutarı cari borçta kalıyordu.)
 *
 * İDEMPOTENT: revertInvoiceStock aynı reference ile net=0 olacağından ikinci
 * çağrıda stoğu tekrar iade etmez. Yine de gereksiz yazımı önlemek için çağıran
 * taraf zaten CANCELLED olanı atlayabilir.
 *
 * @param integrationStatus Ekranda "İptal" mi "Reddedildi" mi ayrışsın diye GİB
 *   alt-durumu. Alıcı reddi → "REJECTED:RED", portal/GİB iptali → "CANCELLED:IPTAL_EDILDI".
 */
export async function voidInvoice(
  tx: Tx,
  args: {
    invoiceId: string
    companyId: string
    invoiceNo?: string | null
    integrationStatus: string
    createdBy?: string | null
  },
): Promise<void> {
  await revertInvoiceStock(tx, {
    companyId: args.companyId,
    invoiceId: args.invoiceId,
    invoiceNo: args.invoiceNo ?? null,
    createdBy: args.createdBy ?? null,
  })
  await tx.invoice.update({
    where: { id: args.invoiceId },
    data: { status: "CANCELLED", integrationStatus: args.integrationStatus },
  })
}

/**
 * Mysoft getInvoiceStatus() sonucundan faturanın GEÇERSİZ sayılıp sayılmayacağına
 * ve integrationStatus'e karar verir. check-status ve toplu senkron ortak kullanır.
 *
 * - IPTAL_EDILDI (mappedStatus CANCELLED) → geçersiz (iptal)
 * - RED (mappedStatus REJECTED + rawText === "RED") → geçersiz (alıcı reddi)
 * - HATA da REJECTED'a maplenir ANCAK geçici/entegrasyon hatası olabileceği için
 *   faturayı iptal ETMEZ.
 */
export function evaluateGibVoid(result: {
  status?: string | null
  rawText?: string | null
  message?: string | null
}): { becomesVoid: boolean; isRejection: boolean; integrationStatus: string } {
  const rawUpper = (result.rawText || "").trim().toUpperCase()
  const integrationStatus = `${result.status}:${result.rawText || result.message}`
  const becomesCancelled = result.status === "CANCELLED"
  const isRejection = result.status === "REJECTED" && rawUpper === "RED"
  return {
    becomesVoid: becomesCancelled || isRejection,
    isRejection,
    integrationStatus,
  }
}
