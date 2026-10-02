/**
 * FATURA ALTI İSKONTO/İLAVE — KALEMİN BELGEDEKİ KDV'Sİ, CANLI VERİTABANINA KARŞI.
 *
 * ── Neden gerekli ───────────────────────────────────────────────────────────
 * Kalem satırı KDV'sini fatura altı iskonto/ilave dağıtılmadan saklar, belge
 * (başlık + GİB) dağıtılmış hâliyle. KDV raporu kalemden toplar ve kalemi
 * `faturaAltiCarpanSql` ile belgedeki karşılığına çevirir (kdv-kural.ts).
 * Katsayı document-totals'ın dağıtımını SQL'de yeniden kurar; ikisinin aynı
 * rakamı verdiğini ancak gerçek belgeler söyleyebilir. Ayrışırsa beyan rakamı
 * sessizce faturadan sapar (2026-10-02'ye kadar ~5.250 TL fazla saymıştı).
 *
 * İki ölçü:
 *   1. Her iskontolu/ilaveli belgede Σ kalemin belgedeki KDV'si = başlık KDV'si.
 *   2. Böyle belgesi olan her firma × ayda `computeVatDeclaration`ın KDV'si =
 *      aynı belgelerin BAŞLIK KDV'sinden bağımsız kurulan toplam.
 *
 * ── Veri güvenliği ──────────────────────────────────────────────────────────
 * SALT OKUR: yalnız SELECT çalışır, fixture açmaz.
 */

import { afterAll, describe, expect, it } from "vitest"
import { config } from "dotenv"
import { Prisma, PrismaClient } from "@prisma/client"
import {
  belgedekiTutarSql,
  faturaAltiCarpanSql,
  kalemGekapSql,
  kdvIsaretSql,
  kdvKurSql,
  kdvyeGirerSql,
  satisAilesiSql,
} from "./kdv-kural"
import { computeVatDeclaration } from "./vergiler"

config({ path: ".env.local", override: true })
config()

const prisma = new PrismaClient()
afterAll(() => prisma.$disconnect())

/** Kalem başına kuruş yuvarlaması belgede birikebilir; 5 kuruş üstü sapmadır. */
const TOLERANS = 0.05

const faturaAltiVar = Prisma.sql`(COALESCE(i."globalDiscountAmount", 0) > 0 OR COALESCE(i."globalChargeAmount", 0) > 0)`

describe("fatura altı iskonto/ilave — kalem ↔ belge KDV'si", () => {
  it("her belgede Σ kalemin belgedeki KDV'si başlık KDV'sini tutar", async () => {
    const g = kalemGekapSql("ii")
    const rows = await prisma.$queryRaw<
      Array<{ invoiceNo: string; bas: unknown; belge: unknown; kalem: unknown }>
    >(Prisma.sql`
      SELECT i."invoiceNo", i."vatAmount" AS bas,
             SUM(${belgedekiTutarSql(Prisma.sql`ii."vatAmount"`, g.kdv, Prisma.sql`fa.f`)}) AS belge,
             SUM(ii."vatAmount") AS kalem
      FROM invoices i
      CROSS JOIN LATERAL (SELECT ${faturaAltiCarpanSql("i")} AS f) fa
      JOIN invoice_items ii ON ii."invoiceId" = i.id
      WHERE ${faturaAltiVar} AND i.status NOT IN ('CANCELLED', 'CONVERTED')
      GROUP BY i.id
    `)

    // Ölçünün boşa dönmediğini göster: iskontolu belge var ve düz kalem toplamı
    // en az birinde başlıktan sapıyor (yani katsayı gerçekten bir şey düzeltiyor).
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.some((r) => Math.abs(Number(r.kalem) - Number(r.bas)) > TOLERANS)).toBe(true)

    const sapan = rows
      .filter((r) => Math.abs(Number(r.belge) - Number(r.bas)) > TOLERANS)
      .map((r) => `${r.invoiceNo}: başlık ${Number(r.bas)}, belgedeki kalem ${Number(r.belge).toFixed(2)}`)
    expect(sapan).toEqual([])
  })

  it("computeVatDeclaration, iskontolu belgesi olan her ayda başlık KDV'sinden kurulan toplamı verir", async () => {
    // Bağımsız toplam: KDV'ye giren belgelerin BAŞLIK KDV'si, aile × işaret × kur.
    // Kalem tablosuna hiç dokunmaz.
    const aylar = await prisma.$queryRaw<
      Array<{ companyId: string; yil: number; ay: number; satis: unknown; alis: unknown }>
    >(Prisma.sql`
      WITH donem AS (
        SELECT DISTINCT i."companyId", EXTRACT(YEAR FROM i.date)::int AS yil, EXTRACT(MONTH FROM i.date)::int AS ay
        FROM invoices i
        WHERE ${faturaAltiVar} AND ${kdvyeGirerSql("i")}
      )
      SELECT d."companyId", d.yil, d.ay,
             COALESCE(SUM(i."vatAmount" * ${kdvIsaretSql("i")} * ${kdvKurSql("i")}) FILTER (WHERE ${satisAilesiSql("i")}), 0) AS satis,
             COALESCE(SUM(i."vatAmount" * ${kdvIsaretSql("i")} * ${kdvKurSql("i")}) FILTER (WHERE NOT ${satisAilesiSql("i")}), 0) AS alis
      FROM donem d
      JOIN invoices i ON i."companyId" = d."companyId"
        AND EXTRACT(YEAR FROM i.date)::int = d.yil AND EXTRACT(MONTH FROM i.date)::int = d.ay
      WHERE ${kdvyeGirerSql("i")} AND ${kdvKurSql("i")} IS NOT NULL
      GROUP BY 1, 2, 3
    `)
    expect(aylar.length).toBeGreaterThan(0)

    const sapan: string[] = []
    for (const a of aylar) {
      const r = await computeVatDeclaration({ companyId: a.companyId, year: a.yil, month: a.ay })
      const satis = r.breakdown.sales.reduce((t, x) => t + x.vatAmount, 0)
      const alis = r.breakdown.purchases.reduce((t, x) => t + x.vatAmount, 0)
      if (Math.abs(satis - Number(a.satis)) > TOLERANS || Math.abs(alis - Number(a.alis)) > TOLERANS) {
        sapan.push(
          `${a.companyId} ${a.yil}-${a.ay}: satış ${satis.toFixed(2)} ↔ ${Number(a.satis).toFixed(2)}, ` +
            `alış ${alis.toFixed(2)} ↔ ${Number(a.alis).toFixed(2)}`,
        )
      }
    }
    expect(sapan).toEqual([])
  }, 120_000)
})
