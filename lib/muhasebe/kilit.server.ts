import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"

/**
 * FİŞ KİLİDİ — taslağın satırlarını değiştiren yollar ile ONAY aynı satır kilidinde buluşur.
 *
 * Onay satırları okuyup sınar, sonra durumu yazar. Arada başka bir yol (senkron yenilemesi,
 * hesap tazeleme, elle seçim, toplu eşleme) satırları değiştirirse yeni satırlar SINANMADAN
 * onaylanırdı — hesapsız satırlı onaylı fiş mizanı bozar. Kural:
 *
 *   - Taslağın satırına yazan her yol, transaction'ının BAŞINDA `taslaklariKilitle` çağırır
 *     ve satırlara yalnız dönen (hâlâ TASLAK olan) fişlerde dokunur.
 *   - Onay `fisleriKilitle` ile kilidi alır, satırları kilit ALTINDA okur, sınar ve yazar.
 *
 * Yazan önce gelirse onay yeni satırları görür (her sorgu taze anlık görüntüyle okur); onay
 * önce gelirse yazan fişi onaylı bulur ve dokunmaz. Kilit id sırasıyla alınır: iki toplu yol
 * aynı fişlere çakışsa da birbirini kilitlemez (deadlock yok).
 *
 * Tek cümlelik DELETE/UPDATE (`status = 'DRAFT'` koşullu silme) kilide gerek duymaz: satırı
 * kilitli bulursa bekler, sonra koşulu yeni hâliyle yeniden sorar.
 */

type Tx = Prisma.TransactionClient

/** Hâlâ TASLAK olan fişleri kilitler; döner: kilitlenen (taslak) id'ler. */
export async function taslaklariKilitle(tx: Tx, defterId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM journal_vouchers
    WHERE "companyId" = ${defterId} AND id IN (${Prisma.join([...new Set(ids)])}) AND status = 'DRAFT'
    ORDER BY id
    FOR UPDATE
  `
  return new Set(rows.map((r) => r.id))
}

/** Fişleri durumundan bağımsız kilitler (onay: durum kilit altında yeniden okunur). */
export async function fisleriKilitle(tx: Tx, defterId: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set()
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM journal_vouchers
    WHERE "companyId" = ${defterId} AND id IN (${Prisma.join([...new Set(ids)])})
    ORDER BY id
    FOR UPDATE
  `
  return new Set(rows.map((r) => r.id))
}

/** Kilit tutan kısa yazma transaction'ı (uzak veritabanında varsayılan 5 sn dar kalır). */
export function kilitliYaz<T>(is: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(is, { timeout: 60_000, maxWait: 10_000 })
}
