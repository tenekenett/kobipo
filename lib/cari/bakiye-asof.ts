/**
 * TARİH İTİBARIYLA CARİ BAKİYESİ — bilançonun alacak/borç kalemleri buradan.
 *
 * Formül cari LİSTESİNİN (`lib/cari/list-query.ts`) aynısıdır; tek farkı her
 * kaynağın bir tarih süzgecinden geçmesi. Ayrışmadıklarını canlı test ölçer:
 * `lib/cari/bakiye-tutarlilik.canli.test.ts` → gelecekteki bir tarihte buradaki
 * bakiye = liste bakiyesi.
 *
 * Kaynaklar ve tarihleri (sınır DIŞLAYICI: `< end`):
 *   fatura            belge tarihi (`date`); iptal/dönüşmüş hariç, iade ve karşı
 *                     yönlü (mahsup) fatura kendi yönüyle
 *   kasasız ödeme     `paymentDate` (kasaya bağlı ödeme işlem üzerinden girer)
 *   cari işlemi       `date` (tahsilat/ödeme/avans)
 *   çek/senet         `issueDate` — bilançodaki portföy satırı da AYNI tarihle
 *                     kurulur ki cariden düşen tutar portföye aynı gün girsin
 *   açılış bakiyesi   carinin `createdAt`ı (ekstre ve kasa geri sarımıyla aynı)
 *   virman fişi       fişin `date`i
 *
 * İşaret carinin KENDİ bakiyesidir: müşteride + = bize borçlu, tedarikçide + =
 * biz ona borçluyuz. Arşivlenmiş cariler DAHİLDİR: geçmiş bir tarihte bakiyeleri
 * olabilir.
 *
 * ── Neden gerekti (2026-09-23) ──────────────────────────────────────────────
 * Bilanço alacak/borcu yalnız faturadan kuruyordu: faturaya bağlanmamış tahsilat
 * (avans) kasaya girip alacaktan düşmüyor, tahsil edilen çek hem kasada hem
 * alacakta kalıyor, açılış bakiyesi ve virman hiç görünmüyordu. Ölçüldü:
 * HİDROEREN'de bilanço 35.200 TL alacak, cari bakiyeleri toplamı 200 TL.
 */

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import type { CariKind } from "@/lib/cari/virman"

export type CariBalanceAsOf = { id: string; balance: number }

/** Tablo/kolon adları sabittir (kullanıcı girdisi değil) — `Prisma.raw` güvenli. */
const SIDE = {
  customer: {
    table: Prisma.raw("customers"),
    col: Prisma.raw(`"customerId"`),
    /** Fatura işareti — müşteri ekseni: satış +, satış iadesi −, alış (mahsup) −, alış iadesi +. */
    invoiceSign: 1,
    /** Cari işlemi: müşteride EXPENSE bakiyeyi artırır, INCOME azaltır. */
    trxIncreasing: "EXPENSE",
    /** Çek/senet: müşteride alınan (null dahil) bakiyeyi AZALTIR, verilen artırır. */
    checkIncreasingDirection: "GIVEN",
    /** Açılış: müşteride DEBIT artırır. */
    openingIncreasing: "DEBIT",
  },
  supplier: {
    table: Prisma.raw("suppliers"),
    col: Prisma.raw(`"supplierId"`),
    invoiceSign: -1,
    trxIncreasing: "INCOME",
    checkIncreasingDirection: "RECEIVED",
    openingIncreasing: "CREDIT",
  },
} as const

function balanceSql(kind: CariKind, companyId: string, end: Date): Prisma.Sql {
  const s = SIDE[kind]
  return Prisma.sql`
    WITH party AS (
      SELECT p.id, p."openingBalanceAmount" AS oa, p."openingBalanceType" AS ot, p."createdAt" AS ca
      FROM ${s.table} p
      WHERE p."companyId" = ${companyId}
    ),
    paid AS (
      SELECT ip."invoiceId", SUM(ip.amount) AS amount
      FROM invoice_payments ip
      WHERE ip."companyId" = ${companyId}
        AND ip."transactionId" IS NULL
        AND ip."paymentDate" < ${end}
      GROUP BY ip."invoiceId"
    ),
    inv AS (
      SELECT i.${s.col} AS id,
        SUM(
          ${s.invoiceSign} * (
            CASE
              WHEN i.type = 'SALES' THEN 1
              WHEN i.type = 'PURCHASE' THEN -1
              WHEN i.type = 'RETURN' AND COALESCE(i."returnKind", 'SALES') = 'PURCHASE' THEN 1
              WHEN i.type = 'RETURN' THEN -1
              ELSE 0
            END
          ) * (i."totalAmount" - COALESCE(pd.amount, 0))
        ) AS v
      FROM invoices i
      INNER JOIN party ON party.id = i.${s.col}
      LEFT JOIN paid pd ON pd."invoiceId" = i.id
      WHERE i.status NOT IN ('CANCELLED', 'CONVERTED') AND i.date < ${end}
      GROUP BY i.${s.col}
    ),
    trx AS (
      SELECT t.${s.col} AS id,
        SUM(CASE WHEN t.type = ${s.trxIncreasing} THEN t.amount
                 WHEN t.type IN ('INCOME', 'EXPENSE') THEN -t.amount
                 ELSE 0 END) AS v
      FROM transactions t
      INNER JOIN party ON party.id = t.${s.col}
      WHERE t.date < ${end}
      GROUP BY t.${s.col}
    ),
    kiymet AS (
      -- Bakiyeyi ARTIRAN yöndeki evrak +, azaltan −.
      SELECT k.id, SUM(k.v) AS v
      FROM (
        SELECT ch.${s.col} AS id,
          CASE WHEN ch.direction = ${s.checkIncreasingDirection} THEN ch.amount ELSE -ch.amount END AS v
        FROM checks ch
        WHERE ch."companyId" = ${companyId}
          AND ch.status NOT IN ('İADE_EDİLDİ', 'PROTESTOLU')
          AND ch."issueDate" < ${end}
        UNION ALL
        SELECT n.${s.col} AS id,
          CASE WHEN n.direction = ${s.checkIncreasingDirection} THEN n.amount ELSE -n.amount END AS v
        FROM promissory_notes n
        WHERE n."companyId" = ${companyId}
          AND n.status NOT IN ('İADE_EDİLDİ', 'PROTESTOLU')
          AND n."issueDate" < ${end}
      ) k
      INNER JOIN party ON party.id = k.id
      GROUP BY k.id
    ),
    vr AS (
      SELECT l.${s.col} AS id,
        SUM(${s.invoiceSign} * (CASE WHEN l.side = 'DEBIT' THEN v.amount ELSE -v.amount END)) AS v
      FROM cari_virman_legs l
      INNER JOIN cari_virman v ON v.id = l."virmanId"
      INNER JOIN party ON party.id = l.${s.col}
      WHERE v.date < ${end}
      GROUP BY l.${s.col}
    )
    SELECT party.id,
      COALESCE(inv.v, 0) + COALESCE(trx.v, 0) + COALESCE(kiymet.v, 0) + COALESCE(vr.v, 0)
      + CASE
          WHEN party.ca >= ${end} THEN 0
          WHEN COALESCE(party.ot, 'DEBIT') = ${s.openingIncreasing} THEN COALESCE(party.oa, 0)
          ELSE -COALESCE(party.oa, 0)
        END AS balance
    FROM party
    LEFT JOIN inv ON inv.id = party.id
    LEFT JOIN trx ON trx.id = party.id
    LEFT JOIN kiymet ON kiymet.id = party.id
    LEFT JOIN vr ON vr.id = party.id
  `
}

/** Firmanın bütün carilerinin `end` anından HEMEN ÖNCEKİ bakiyesi (sınır dışarıda). */
export async function cariBalancesAsOf(
  companyId: string,
  end: Date,
): Promise<{ customers: CariBalanceAsOf[]; suppliers: CariBalanceAsOf[] }> {
  const [customers, suppliers] = await Promise.all(
    (["customer", "supplier"] as const).map((kind) =>
      prisma.$queryRaw<Array<{ id: string; balance: unknown }>>(balanceSql(kind, companyId, end)),
    ),
  )
  const toRows = (rows: Array<{ id: string; balance: unknown }>) =>
    rows.map((r) => ({ id: r.id, balance: Number(r.balance ?? 0) }))
  return { customers: toRows(customers), suppliers: toRows(suppliers) }
}
