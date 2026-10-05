import { TRANSFER_REFERENCE_PREFIX } from "@/lib/finans/nakit-hareket"
import { istanbulGunu } from "@/lib/muhasebe/fis"

/**
 * HESAPLAR ARASI VİRMAN — iki bacağı eşleştirir. Saf modül, testli.
 *
 * Kaynak bacak `TRANSFER`, hedef bacak `INCOME` + `TRANSFER:<kaynak kasa>` referanslıdır
 * (app/api/finans/transactions). 2026-10-05'ten beri iki bacak ORTAK KİMLİK taşır
 * (`transferGroupId`): eşleşme önce ondan kurulur. Kimliği olmayan eski bacak eski kurala
 * düşer: aynı firma, aynı tutar, aynı İstanbul günü, hedefin referansı kaynağın kasası (ve
 * kaynak referansı hedefi gösteriyorsa o kasa). Her bacak en çok bir kez eşleşir, sıra id'ye göre.
 */

export type VirmanBacagi = {
  id: string
  companyId: string
  accountId: string
  date: Date
  type: string
  /** Tutar karşılaştırması kuruş düzeyinde (Prisma.Decimal da number da olabilir). */
  amount: { toString(): string } | number
  reference: string | null
  transferGroupId?: string | null
}

const gunAnahtari = (d: Date) => istanbulGunu(d).toISOString().slice(0, 10)
const kurus = (v: VirmanBacagi["amount"]) => Math.round(Number(String(v)) * 100)
const hedefMi = (b: VirmanBacagi) => b.type === "INCOME" && Boolean(b.reference?.startsWith(TRANSFER_REFERENCE_PREFIX))

/** Döner: her iki yönde eşleşme (kaynak→hedef, hedef→kaynak). */
export function virmanEslestir(bacaklar: VirmanBacagi[]): Map<string, string> {
  const cift = new Map<string, string>()
  const kullanilan = new Set<string>()

  // 1) Ortak kimlik: aynı gruptaki TRANSFER bacağı ile giriş bacağı.
  const gruplar = new Map<string, VirmanBacagi[]>()
  for (const b of bacaklar) {
    if (!b.transferGroupId) continue
    gruplar.set(b.transferGroupId, [...(gruplar.get(b.transferGroupId) ?? []), b])
  }
  for (const grup of gruplar.values()) {
    const k = grup.find((b) => b.type === "TRANSFER")
    const h = grup.find(hedefMi)
    if (!k || !h) continue
    cift.set(k.id, h.id)
    cift.set(h.id, k.id)
    kullanilan.add(k.id)
    kullanilan.add(h.id)
  }

  // 2) Kimliksiz (eski) bacaklar: tutar + gün + referans.
  const kaynaklar = bacaklar
    .filter((b) => b.type === "TRANSFER" && !b.transferGroupId && !kullanilan.has(b.id))
    .sort((a, b) => a.id.localeCompare(b.id))
  const hedefler = bacaklar
    .filter((b) => hedefMi(b) && !b.transferGroupId && !kullanilan.has(b.id))
    .sort((a, b) => a.id.localeCompare(b.id))
  for (const k of kaynaklar) {
    const hedefKasa = k.reference?.startsWith(TRANSFER_REFERENCE_PREFIX) ? k.reference.slice(TRANSFER_REFERENCE_PREFIX.length) : null
    const h = hedefler.find(
      (t) =>
        !kullanilan.has(t.id) &&
        t.companyId === k.companyId &&
        t.reference === `${TRANSFER_REFERENCE_PREFIX}${k.accountId}` &&
        kurus(t.amount) === kurus(k.amount) &&
        gunAnahtari(t.date) === gunAnahtari(k.date) &&
        (!hedefKasa || t.accountId === hedefKasa),
    )
    if (!h) continue
    kullanilan.add(h.id)
    cift.set(k.id, h.id)
    cift.set(h.id, k.id)
  }
  return cift
}
