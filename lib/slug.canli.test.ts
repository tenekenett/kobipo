/**
 * SLUG ÜRETİMİ — SQL ↔ JS EŞİTLİĞİ, CANLI VERİTABANINA KARŞI.
 *
 * ── Neden gerekli ───────────────────────────────────────────────────────────
 * Slug iki yerde üretiliyor ve ikisi de aynı adı görebilir:
 *   • JS  `lib/slug.ts` → slugify (blog yazısı, rol kalıbı anahtarı,
 *         issue-sales-invoice'ın müşteri açma yolu — slug'ı AÇIKÇA gönderir)
 *   • SQL `set_entity_slug()` BEFORE INSERT trigger'ı (cari, ürün, personel,
 *         finansal hesap — app slug göndermediğinde devreye girer)
 *
 * Ayrıştıkları an aynı ad iki farklı adres üretir ve hata SESSİZDİR: kimse
 * "i-zin" ya da "lim-ticaret" yazan bir adresi hata sanmaz. Nitekim iki kez
 * ayrıştılar: JS tarafı `toLowerCase()`i katlamadan önce çağırdığı için Türkçe
 * "İ"yi ikiye bölüyordu; SQL tarafı da â/î/û'yu hiç çevirmediği için baş harfi
 * düşürüyordu (migrasyon 20260915000002).
 *
 * ── Veri güvenliği ──────────────────────────────────────────────────────────
 * SALT OKUR: `pg_proc`tan fonksiyon kaynağını ve birkaç SELECT ifadesini okur.
 * Trigger'ı gerçekten çalıştırmak INSERT gerektirirdi; onun yerine YAYIMDAKİ
 * fonksiyonun harf tablosu doğrudan denetlenir.
 *
 * Çalıştırma (varsayılan `npm test` bu dosyayı ATLAR — bkz. vitest.config):
 *   npm run test:canli
 *   npx vitest run --config vitest.canli.config.mts lib/slug.canli.test.ts
 */

import { describe, expect, it, afterAll } from "vitest"
import { config } from "dotenv"
import { Prisma, PrismaClient } from "@prisma/client"
import { TR_FOLD_FROM, TR_FOLD_TO } from "./text/tr-fold"
import { slugify } from "./slug"

config({ path: ".env.local", override: true })
config()

const prisma = new PrismaClient()

/** Katlamanın her kuralına değen örnekler + gerçek hayattan firma/cari adları. */
const ORNEKLER = [
  "İzin",
  "İstifa Dilekçesi",
  "İŞ DÜNYASI",
  "IŞIK GIDA",
  "Çiğdem Öztürk Şahin",
  "Üçler Otomotiv",
  "Ğğ Şş Iı İi Öö Çç Üü",
  "Âlim Ticaret",
  "Kâğıthane Lojistik Ltd. Şti.",
  "Nûri Bey Gıda",
  "  --Boşluklu / Simgeli--  ",
]

/** Trigger'daki ifadenin birebir aynısı — tablo YAYIMDAKİ fonksiyondan okunur. */
async function sqlSlug(deger: string, from: string, to: string): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ s: string | null }>>(Prisma.sql`
    SELECT NULLIF(
      LEFT(
        TRIM(BOTH '-' FROM
          REGEXP_REPLACE(
            LOWER(TRANSLATE(${deger}::text, ${from}::text, ${to}::text)),
            '[^a-z0-9]+', '-', 'g'
          )
        ),
        80
      ),
    '') AS s
  `)
  return rows[0]?.s ?? ""
}

/** Yayımdaki `set_entity_slug` gövdesi. */
async function fonksiyonKaynagi(): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ src: string }>>(Prisma.sql`
    SELECT prosrc AS src FROM pg_proc WHERE proname = 'set_entity_slug'
  `)
  return rows[0]?.src ?? ""
}

describe("slugify ↔ set_entity_slug trigger", () => {
  afterAll(async () => {
    await prisma.$disconnect()
  })

  it("trigger fonksiyonu veritabanında var", async () => {
    expect(await fonksiyonKaynagi()).not.toBe("")
  })

  it("yayımdaki fonksiyon TR_FOLD tablosunu kullanıyor", async () => {
    const src = await fonksiyonKaynagi()
    const eslesme = src.match(/TRANSLATE\(NEW\."name",\s*'([^']+)',\s*'([^']+)'\)/i)
    expect(eslesme, "TRANSLATE çağrısı bulunamadı — fonksiyon değişmiş olabilir").not.toBeNull()

    // Sıra önemli değil, KÜME önemli: trigger JS'in katladığı her harfi katlamalı.
    const [, from, to] = eslesme!
    expect(from.length, "harf tabloları eşit uzunlukta olmalı").toBe(to.length)

    const sqlEslesmeleri = new Map([...from].map((h, i) => [h, to[i].toLowerCase()]))
    // Bir harf SQL tablosunda OLMAYABİLİR: `LOWER()` tek başına aynı sonucu
    // veriyorsa (ASCII "I" → "i") TRANSLATE'e yazmak gereksizdir. Eksik sayılan
    // yalnızca LOWER'ın çözemediği harftir.
    const eksik = [...TR_FOLD_FROM].filter((h, i) => {
      const hedef = TR_FOLD_TO[i].toLowerCase()
      const sqlKarsiligi = sqlEslesmeleri.get(h) ?? h.toLowerCase()
      return sqlKarsiligi !== hedef
    })
    expect(
      eksik,
      `Trigger şu harfleri JS ile aynı katlamıyor: ${eksik.join(" ")}. ` +
        "supabase/migrations/20260915000002_slug_aksan_hizalama.sql uygulanmamış olabilir.",
    ).toEqual([])
  })

  it("TRANSLATE, LOWER'dan ÖNCE çağrılıyor", async () => {
    // Sıra ters çevrilirse Postgres'in LOWER'ı 'İ' için lc_ctype'a bağlı davranır;
    // JS tarafında aynı sıra hatası "İzin" → "i-zin" üretiyordu.
    const src = await fonksiyonKaynagi()
    expect(src).toMatch(/LOWER\(\s*TRANSLATE\(/i)
  })

  it("her örnekte iki taraf AYNI slug'ı üretir", async () => {
    const src = await fonksiyonKaynagi()
    const [, from, to] = src.match(/TRANSLATE\(NEW\."name",\s*'([^']+)',\s*'([^']+)'\)/i)!
    for (const ornek of ORNEKLER) {
      expect(await sqlSlug(ornek, from, to), `örnek: "${ornek}"`).toBe(slugify(ornek))
    }
  })
})
