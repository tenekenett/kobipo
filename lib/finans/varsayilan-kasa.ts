import { prisma } from "@/lib/db/prisma"

type Db = Pick<typeof prisma, "financialAccount">

/** Hesap seçilmeden yazılan tahsilat/ödemenin düştüğü kasa. */
export const DEFAULT_CASH_ACCOUNT = { code: "KASA", name: "Kasa", type: "CASH" } as const

/**
 * Firmanın varsayılan KASA hesabını döndürür; yoksa "Kasa" adıyla açar.
 *
 * Neden var: `Transaction.accountId` zorunlu. Fatura ödemesi hesap seçilmeden
 * girildiğinde (fiş/POS ekranında kasa tanımlı değilken, Fatura Ödemeleri'nde
 * alan boş bırakılınca) yalnız `InvoicePayment` yazılıyor, kasa hareketi
 * ÜRETİLEMİYORDU: fatura "ödendi", cari borç düşmüş, ama para hiçbir kasada
 * yok — kasa bakiyesi, Finans > Hareketler, pano geliri ve nakit projeksiyonu
 * onu görmüyordu (2026-09-16'da canlıda 7 kayıt, ₺202.169,74).
 *
 * Karar (2026-09-16): hesap ZORUNLU yapılmadı — 33 firmanın 21'inde hiç
 * kasa/banka hesabı yok, zorunlu alan o firmalarda POS satışını bloke ederdi.
 * Bunun yerine hesapsız ödeme varsayılan Kasa'ya yazılır; para her zaman bir
 * yerde durur, yanlış yerdeyse hareket sonradan taşınır.
 *
 * Seçim sırası: en eski aktif CASH hesabı → yoksa "Kasa" açılır. BANK hesabına
 * düşülmez: nakit satışı bankaya yazmak, kasayı boş gösterip bankayı şişirir.
 * Aynı depo yaklaşımı: lib/stock/warehouse.ts → ensureDefaultWarehouseId.
 */
export async function ensureDefaultCashAccount(
  db: Db,
  companyId: string,
): Promise<{ id: string; name: string; created: boolean }> {
  const existing = await db.financialAccount.findFirst({
    where: { companyId, isActive: true, type: DEFAULT_CASH_ACCOUNT.type },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  })
  if (existing) return { ...existing, created: false }

  try {
    const created = await db.financialAccount.create({
      data: {
        companyId,
        code: DEFAULT_CASH_ACCOUNT.code,
        name: DEFAULT_CASH_ACCOUNT.name,
        type: DEFAULT_CASH_ACCOUNT.type,
        currency: "TRY",
      },
      select: { id: true, name: true },
    })
    return { ...created, created: true }
  } catch (error: unknown) {
    // Aynı anda iki ilk tahsilat: slug tekilliği (companyId, slug) ikinciyi
    // düşürür — kazananı oku, ikinci bir "Kasa" açma.
    if ((error as { code?: string })?.code === "P2002") {
      const winner = await db.financialAccount.findFirst({
        where: { companyId, isActive: true, type: DEFAULT_CASH_ACCOUNT.type },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true },
      })
      if (winner) return { ...winner, created: false }
    }
    throw error
  }
}
