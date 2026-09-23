/**
 * Cari virman fişinin veritabanı yardımcıları — kural `lib/cari/virman.ts`te.
 *
 * Bakiye kurucuları bacakları buradan okur ki satırın açıklaması, yönü ve karşı
 * cari adı kart tablosunda, ekstrede ve dışa aktarımda aynı çıksın.
 */

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import {
  formatVirmanNo,
  isVirmanSide,
  virmanAciklamasi,
  virmanSatirYonu,
  type CariKind,
  type VirmanSide,
} from "@/lib/cari/virman"

type Db = Prisma.TransactionClient | typeof prisma

/** Bacak + başlık + karşı bacağın carisi — satır kurmak için gereken her şey. */
export const VIRMAN_LEG_SELECT = {
  id: true,
  side: true,
  customerId: true,
  supplierId: true,
  virman: {
    select: {
      id: true,
      virmanNo: true,
      date: true,
      amount: true,
      description: true,
      createdAt: true,
      legs: {
        select: {
          id: true,
          side: true,
          customer: { select: { id: true, name: true, slug: true } },
          supplier: { select: { id: true, name: true, slug: true } },
        },
      },
    },
  },
} satisfies Prisma.CariVirmanLegSelect

export type VirmanLegRecord = Prisma.CariVirmanLegGetPayload<{ select: typeof VIRMAN_LEG_SELECT }>

export type VirmanCounterparty = { kind: CariKind; id: string; name: string; slug: string | null }

export type VirmanLegRow = {
  /** Bacağın id'si — satır anahtarı. */
  id: string
  virmanId: string
  virmanNo: string
  date: Date
  createdAt: Date
  side: VirmanSide
  amount: number
  debit: number
  credit: number
  description: string
  counterparty: VirmanCounterparty | null
}

export function virmanLegRow(leg: VirmanLegRecord): VirmanLegRow {
  const side: VirmanSide = isVirmanSide(leg.side) ? leg.side : "DEBIT"
  const amount = Number(leg.virman.amount)
  const other = leg.virman.legs.find((l) => l.id !== leg.id) ?? null
  const counterparty: VirmanCounterparty | null = other?.customer
    ? { kind: "customer", id: other.customer.id, name: other.customer.name, slug: other.customer.slug ?? null }
    : other?.supplier
      ? { kind: "supplier", id: other.supplier.id, name: other.supplier.name, slug: other.supplier.slug ?? null }
      : null
  return {
    id: leg.id,
    virmanId: leg.virman.id,
    virmanNo: leg.virman.virmanNo,
    date: leg.virman.date,
    createdAt: leg.virman.createdAt,
    side,
    amount,
    ...virmanSatirYonu(side, amount),
    description: virmanAciklamasi({
      virmanNo: leg.virman.virmanNo,
      counterpartyName: counterparty?.name ?? null,
      description: leg.virman.description,
    }),
    counterparty,
  }
}

/** Tek carinin bütün virman bacakları (tarih sırasıyla). */
export async function fetchVirmanLegsForParty(kind: CariKind, id: string): Promise<VirmanLegRow[]> {
  const legs = await prisma.cariVirmanLeg.findMany({
    where: kind === "customer" ? { customerId: id } : { supplierId: id },
    select: VIRMAN_LEG_SELECT,
    orderBy: { virman: { date: "asc" } },
  })
  return legs.map(virmanLegRow)
}

/**
 * Carinin virman NET'i (borç − alacak, ekstre ekseni) ve bacak sayısı. Arşiv
 * kapısı gibi yalnız toplam isteyen yerler için; satır istemeyen yerde bacakları
 * tek tek çekmemek için SQL'de toplanır.
 */
export async function virmanNetForParty(
  kind: CariKind,
  id: string,
): Promise<{ debitMinusCredit: number; count: number }> {
  const column = kind === "customer" ? Prisma.sql`l."customerId"` : Prisma.sql`l."supplierId"`
  const rows = await prisma.$queryRaw<Array<{ net: unknown; count: bigint | number }>>(Prisma.sql`
    SELECT
      COALESCE(SUM(CASE WHEN l.side = 'DEBIT' THEN v.amount ELSE -v.amount END), 0) AS net,
      COUNT(*) AS count
    FROM cari_virman_legs l
    INNER JOIN cari_virman v ON v.id = l."virmanId"
    WHERE ${column} = ${id}
  `)
  return { debitMinusCredit: Number(rows[0]?.net ?? 0), count: Number(rows[0]?.count ?? 0) }
}

/**
 * Sıradaki fiş numarası: firmadaki EN BÜYÜK sayısal numara + 1. Eşzamanlı iki
 * kayıt aynı numarayı alırsa `(companyId, virmanNo)` tekilliği ikincisini
 * reddeder; uç bir kez yeniden dener.
 */
export async function nextVirmanNo(db: Db, companyId: string): Promise<string> {
  const rows = await db.$queryRaw<Array<{ max: number | null }>>(Prisma.sql`
    SELECT MAX(CAST(SUBSTRING("virmanNo" FROM 5) AS INTEGER)) AS max
    FROM cari_virman
    WHERE "companyId" = ${companyId} AND "virmanNo" ~ '^VRM-[0-9]+$'
  `)
  const max = Number(rows[0]?.max ?? 0)
  return formatVirmanNo((Number.isFinite(max) ? max : 0) + 1)
}
