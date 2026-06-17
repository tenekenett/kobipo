import { prisma } from "@/lib/db/prisma"

/**
 * Çek/senet ile cari kapama mantığı tek yerde.
 *
 * Yön (direction): RECEIVED = alınan (para bize girer), GIVEN = verilen (para çıkar).
 * null = eski kayıt → müşteride "alınan", tedarikçide "verilen" varsayılır (eski davranış).
 *
 * Cari bakiyeyi AZALTAN net etki (+) döndürülür; ARTIRAN durumlar (−) çıkar:
 *  - Müşteri (pozitif bakiye = bize borçlu): alınan çek alacağı AZALTIR (+),
 *    verilen çek (ör. iade) alacağı ARTIRIR (−).
 *  - Tedarikçi (pozitif bakiye = ona borçluyuz): verilen çek borcu AZALTIR (+),
 *    alınan çek (ör. tedarikçiden iade) borcu ARTIRIR (−).
 *
 * İADE_EDİLDİ / PROTESTOLU kıymetler hiç sayılmaz (cari pozisyonu değişmez).
 */
export const CHECK_NOTE_NON_SETTLING = ["İADE_EDİLDİ", "PROTESTOLU"] as const

/** Tek bir kıymetin cari bakiyeyi azaltan işaretli etkisi. */
export function checkNoteSignedCredit(
  kind: "customer" | "supplier",
  direction: string | null | undefined,
  amount: number,
): number {
  const dir = direction || (kind === "customer" ? "RECEIVED" : "GIVEN")
  if (kind === "customer") return dir === "GIVEN" ? -amount : amount
  return dir === "RECEIVED" ? -amount : amount
}

/** Tek cari için geçerli çek + senedin net (işaretli) bakiye-azaltan etkisi. */
export async function getCariCheckNoteCredit(
  kind: "customer" | "supplier",
  id: string,
): Promise<number> {
  const status = { notIn: [...CHECK_NOTE_NON_SETTLING] }
  const where = kind === "customer" ? { customerId: id, status } : { supplierId: id, status }
  const [checks, notes] = await Promise.all([
    prisma.check.findMany({ where, select: { amount: true, direction: true } }),
    prisma.promissoryNote.findMany({ where, select: { amount: true, direction: true } }),
  ])
  let sum = 0
  for (const r of [...checks, ...notes]) sum += checkNoteSignedCredit(kind, r.direction, Number(r.amount))
  return sum
}

/**
 * Firmadaki tüm carilerin net (işaretli) çek+senet kredisini cariId→tutar Map'i
 * olarak döndürür (yaşlandırma gibi toplu hesaplarda N+1'den kaçınmak için).
 */
export async function getCheckNoteCreditMap(
  kind: "customer" | "supplier",
  companyId: string,
): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  const status = { notIn: [...CHECK_NOTE_NON_SETTLING] }
  if (kind === "customer") {
    const where = { companyId, customerId: { not: null }, status }
    const [checks, notes] = await Promise.all([
      prisma.check.findMany({ where, select: { customerId: true, amount: true, direction: true } }),
      prisma.promissoryNote.findMany({ where, select: { customerId: true, amount: true, direction: true } }),
    ])
    for (const r of [...checks, ...notes]) {
      if (!r.customerId) continue
      map.set(r.customerId, (map.get(r.customerId) || 0) + checkNoteSignedCredit(kind, r.direction, Number(r.amount)))
    }
  } else {
    const where = { companyId, supplierId: { not: null }, status }
    const [checks, notes] = await Promise.all([
      prisma.check.findMany({ where, select: { supplierId: true, amount: true, direction: true } }),
      prisma.promissoryNote.findMany({ where, select: { supplierId: true, amount: true, direction: true } }),
    ])
    for (const r of [...checks, ...notes]) {
      if (!r.supplierId) continue
      map.set(r.supplierId, (map.get(r.supplierId) || 0) + checkNoteSignedCredit(kind, r.direction, Number(r.amount)))
    }
  }
  return map
}
