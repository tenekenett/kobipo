import { prisma } from "@/lib/db/prisma"
import { kamuBilgisiHatasi, type KamuBilgisi } from "./kamu-bilgisi"

/**
 * Müşteri kartının kamu bilgisini kaydetmeden önce doğrular (kural `kamu-bilgisi.ts`).
 * Hesap YALNIZ bu firmanın hesapları arasında aranır: id istemciden gelir.
 */
export async function kamuBilgisiniDogrula(companyId: string, value: KamuBilgisi): Promise<string | null> {
  const account = value.publicPaymentAccountId
    ? await prisma.financialAccount.findFirst({
        where: { id: value.publicPaymentAccountId, companyId },
        select: { id: true, name: true, type: true, iban: true, currency: true, isActive: true },
      })
    : null
  return kamuBilgisiHatasi(value, account)
}
