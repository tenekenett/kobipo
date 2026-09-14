/**
 * TÜRKÇE KATLAMA — SQL ↔ JS EŞİTLİĞİ, CANLI VERİTABANINA KARŞI.
 *
 * ── Neden gerekli ───────────────────────────────────────────────────────────
 * Arama iki yerde katlanıyor: istemcide/bellekte `trFold()` (lib/text/tr-fold.ts),
 * sunucuda Postgres `lower(translate(...))` (lib/db/tr-search.ts). İki harf
 * tablosu AYNI sabitten geliyor ama üretilen anahtarın aynı olduğunu ancak
 * gerçek bir Postgres söyleyebilir: `translate` fazlalık harfleri SİLER,
 * `lower` ise veritabanının lc_ctype'ına bağlıdır. Ayrışırlarsa ekranda
 * eşleşen kayıt sunucu tarafında bulunmaz (ya da tersi) ve hata sessizdir.
 *
 * ── Veri güvenliği ──────────────────────────────────────────────────────────
 * SALT OKUR: tek bir `SELECT` çalışır, hiçbir tabloya dokunmaz, fixture açmaz.
 */

import { describe, expect, it, afterAll } from "vitest"
import { config } from "dotenv"
import { Prisma, PrismaClient } from "@prisma/client"
import { TR_FOLD_FROM, TR_FOLD_TO, trFold } from "./tr-fold"

config({ path: ".env.local", override: true })
config()

const prisma = new PrismaClient()

/** Katlamanın her kuralına değen örnekler + gerçek hayattan cari/ürün adları. */
const ORNEKLER = [
  "IŞIK",
  "ışık",
  "Işık",
  "isik",
  "İstanbul",
  "ISTANBUL",
  "Şişli",
  "sisli",
  "ÇAĞLAYAN GIDA SAN. VE TİC. LTD. ŞTİ.",
  "Hâlâ Îî Ûû",
  "Şeker",
  "SEKER",
  "  boşluklu  ad  ",
  "ACME Ltd. Şti.",
  "TR12-345/A",
  "",
]

async function sqlFold(value: string): Promise<string> {
  // Sütun ifadesi tam olarak `trFoldColumn`un ürettiği biçimde kurulur; tablo
  // sabitleri de aynı modülden gelir — testin sınadığı şey bu ikisinin eşitliği.
  const rows = await prisma.$queryRaw<Array<{ folded: string }>>(Prisma.sql`
    SELECT lower(translate(btrim(t.value), ${TR_FOLD_FROM}, ${TR_FOLD_TO})) AS folded
    FROM (VALUES (${value}::text)) AS t(value)
  `)
  return rows[0]?.folded ?? ""
}

describe("trFold ↔ Postgres translate", () => {
  afterAll(async () => {
    await prisma.$disconnect()
  })

  it("her örnekte iki taraf AYNI anahtarı üretir", async () => {
    for (const ornek of ORNEKLER) {
      expect(await sqlFold(ornek), `örnek: "${ornek}"`).toBe(trFold(ornek))
    }
  })

  it("harf tabloları eşit uzunlukta (translate fazlalığı siler)", async () => {
    const rows = await prisma.$queryRaw<Array<{ a: number; b: number }>>(Prisma.sql`
      SELECT length(${TR_FOLD_FROM}::text) AS a, length(${TR_FOLD_TO}::text) AS b
    `)
    expect(rows[0].a).toBe(rows[0].b)
  })
})
