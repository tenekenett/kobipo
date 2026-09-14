/**
 * Türkçe duyarsız aramanın SUNUCU (SQL) tarafı.
 *
 * Aramanın kuralı `lib/text/tr-fold.ts`tedir; burada aynı harf tablosu
 * Postgres `translate()`ine verilir, yani iki taraf BİREBİR aynı anahtarı
 * üretir. `ILIKE` ve Prisma'nın `mode: "insensitive"`i Türkçe I/ı ayrımını
 * çözemediği için (`lower('I') = 'i'`) arama sorguları buradan geçmelidir.
 *
 * Neden DB'de `tr_fold()` fonksiyonu yok: ifade doğrudan sorguya gömülüyor.
 * Böylece migrasyon/deploy sırası tuzağı ("function does not exist" ile düşen
 * cari listesi) ve canlıya eklenen bir bağımlılık oluşmuyor. `LIKE '%x%'`
 * zaten index kullanamadığı için fonksiyonun performans faydası da yoktu.
 *
 * Prisma `where` içine SQL fonksiyonu sokulamadığı için Prisma sorguları iki
 * adım çalışır: önce burada ham bir ÖN SÜZGEÇ id listesi çıkarılır, sonra
 * `id: { in: ids }` verilir. Ön süzgeç DAİMA boyut tablosuna (müşteri,
 * tedarikçi, ürün, personel) kurulur — olgu tablosuna (fatura satırları)
 * kurulursa "a" araması on binlerce id üretir ve bind parametre sınırına
 * çarpar.
 */

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { TR_FOLD_FROM, TR_FOLD_TO, trFold } from "@/lib/text/tr-fold"

/**
 * Ön süzgeç tavanı. Aşılırsa liste kırpılır — kullanıcı zaten sayfalanmış
 * ekranda ilk sayfayı görür; tavansız çalışmak bind parametresi patlatır.
 */
const PREFILTER_LIMIT = 5000

/** `Prisma.raw` parametrelemez: identifier'lar sabitlerimizden gelse de doğrulanır. */
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/i
const COLUMN_REF = /^(?:[a-z_][a-z0-9_]*\.)?"?[a-z_][a-z0-9_]*"?$/i

function rawIdentifier(name: string): Prisma.Sql {
  if (!IDENTIFIER.test(name)) throw new Error(`Invalid SQL identifier: ${name}`)
  return Prisma.raw(`"${name}"`)
}

function rawColumn(column: string): Prisma.Sql {
  if (!COLUMN_REF.test(column)) throw new Error(`Invalid SQL column: ${column}`)
  return Prisma.raw(column)
}

/**
 * Sütunun (ya da herhangi bir metin ifadesinin) katlanmış hâli.
 * `btrim` JS tarafındaki `.trim()`in karşılığıdır — iki anahtar ayrışmasın.
 */
export function trFoldColumn(column: string): Prisma.Sql {
  return Prisma.sql`lower(translate(btrim(${rawColumn(column)}), ${TR_FOLD_FROM}, ${TR_FOLD_TO}))`
}

/**
 * Arama terimini LIKE desenine çevirir: katlanır, LIKE'ın joker karakterleri
 * kaçırılır (kullanıcının yazdığı `%` gerçekten `%` aramalıdır), iki yana `%`.
 * Boş terim için `null` döner — çağıran "arama yok" durumunu ayırt edebilsin.
 */
export function trLikePattern(term: string | null | undefined): string | null {
  const folded = trFold(term)
  if (!folded) return null
  const escaped = folded.replace(/[\\%_]/g, (ch) => `\\${ch}`)
  return `%${escaped}%`
}

/** `(fold(a) LIKE $1 OR fold(b) LIKE $1 ...)` — hiç sütun yoksa `FALSE`. */
export function trFoldAnyLike(columns: string[], pattern: string): Prisma.Sql {
  if (columns.length === 0) return Prisma.sql`FALSE`
  return Prisma.sql`(${Prisma.join(
    columns.map((column) => Prisma.sql`${trFoldColumn(column)} LIKE ${pattern}`),
    " OR ",
  )})`
}

/** `fold(a) = $1 OR fold(b) = $2 ...` — eşitlik araması (içe aktarım eşleştirmesi). */
export function trFoldAnyEquals(matches: Array<{ column: string; value: string }>): Prisma.Sql {
  if (matches.length === 0) return Prisma.sql`FALSE`
  return Prisma.sql`(${Prisma.join(
    matches.map((match) => Prisma.sql`${trFoldColumn(match.column)} = ${match.value}`),
    " OR ",
  )})`
}

type PrefilterOptions = {
  /** Fiziksel tablo adı (`@@map`): "customers", "products", "employees"… */
  table: string
  /** Aranacak sütunlar; tırnaklı yazım gerekiyorsa çağıran yazar: `"taxNumber"`. */
  columns: string[]
  companyId: string
  term: string | null | undefined
  /** Ek koşul (ör. `AND "archivedAt" IS NULL`). */
  extra?: Prisma.Sql
  limit?: number
}

/**
 * Terimi içeren kayıtların id'leri. Terim boşsa `null` döner — çağıran
 * "süzme yok" ile "hiçbir şey eşleşmedi" (boş dizi) durumlarını ayırmalı:
 * boş diziyi `id: { in: [] }` olarak vermek doğru sonuçtur, `null`ı vermek
 * TÜM kayıtları döker.
 */
export async function trContainsIds(options: PrefilterOptions): Promise<string[] | null> {
  const pattern = trLikePattern(options.term)
  if (!pattern) return null
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM ${rawIdentifier(options.table)}
    WHERE "companyId" = ${options.companyId}
      AND ${trFoldAnyLike(options.columns, pattern)}
      ${options.extra ?? Prisma.empty}
    LIMIT ${options.limit ?? PREFILTER_LIMIT}
  `)
  return rows.map((row) => row.id)
}

/**
 * Verilen alanlardan HERHANGİ BİRİ eşit olan kayıtların id'leri — içe aktarımın
 * aday havuzu ("SEKER" satırı "Şeker" ürününü günceller, ikinci kez açmaz).
 * Her alanın kendi değeri vardır (ad/barkod/kod); boş değerler atılır, hepsi
 * boşsa `null` döner.
 */
export async function trEqualsIds(options: {
  table: string
  companyId: string
  matches: Array<{ column: string; value: string | null | undefined }>
  extra?: Prisma.Sql
  limit?: number
}): Promise<string[] | null> {
  const folded = options.matches
    .map((match) => ({ column: match.column, value: trFold(match.value) }))
    .filter((match) => match.value.length > 0)
  if (folded.length === 0) return null
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM ${rawIdentifier(options.table)}
    WHERE "companyId" = ${options.companyId}
      AND ${trFoldAnyEquals(folded)}
      ${options.extra ?? Prisma.empty}
    LIMIT ${options.limit ?? PREFILTER_LIMIT}
  `)
  return rows.map((row) => row.id)
}

/**
 * Terimi içeren FARKLI sütun değerleri (id'si olmayan alanlar için:
 * gelen faturanın `senderName`i gibi). `column IN (...)` olarak kullanılır.
 */
export async function trSearchDistinctValues(options: {
  table: string
  column: string
  companyId: string
  term: string | null | undefined
  extra?: Prisma.Sql
  limit?: number
}): Promise<string[] | null> {
  const pattern = trLikePattern(options.term)
  if (!pattern) return null
  const rows = await prisma.$queryRaw<Array<{ value: string | null }>>(Prisma.sql`
    SELECT DISTINCT ${rawColumn(options.column)} AS value
    FROM ${rawIdentifier(options.table)}
    WHERE "companyId" = ${options.companyId}
      AND ${trFoldAnyLike([options.column], pattern)}
      ${options.extra ?? Prisma.empty}
    LIMIT ${options.limit ?? PREFILTER_LIMIT}
  `)
  return rows.map((row) => row.value).filter((value): value is string => Boolean(value))
}
