/**
 * KATEGORİ / ETİKET ÖNERİLERİ — faturaların ve kasa hareketlerinin ORTAK kümesi.
 *
 * Kategori ayrı bir tabloda tutulmaz (ürün kategorisiyle aynı desen: serbest
 * metin + mevcut değerlerden öneri). Öneri listesi yazım farklarını önlemek
 * içindir: "Akaryakıt" ve "akaryakit" iki ayrı satır olarak raporu bölerdi.
 *
 * İKİ KAYNAK BİRLEŞTİRİLİR. Fatura formu yalnız faturaların kategorilerini,
 * kasa formu yalnız hareketlerinkini önerseydi aynı gider iki ayrı adla
 * yazılırdı — gelir-gider raporunda "Kira" (faturalı) ve "kira" (faturasız)
 * ayrı satırlarda görünür, kırılım da tam olarak işe yaramaz hâle gelirdi.
 */

import { prisma } from "@/lib/db/prisma"

export type ClassificationOptions = { categories: string[]; tags: string[] }

/** Etiket önerisinde kaç kayıt taranır — öneri listesi, tam envanter değil. */
const TAG_SCAN_LIMIT = 500
const CATEGORY_LIMIT = 200

export async function loadClassificationOptions(
  companyId: string
): Promise<ClassificationOptions> {
  const [invoiceCategories, transactionCategories, invoiceTags, transactionTags] =
    await Promise.all([
      prisma.invoice.findMany({
        where: { companyId, category: { not: null } },
        select: { category: true },
        distinct: ["category"],
        orderBy: { category: "asc" },
        take: CATEGORY_LIMIT,
      }),
      prisma.transaction.findMany({
        where: { companyId, category: { not: null } },
        select: { category: true },
        distinct: ["category"],
        orderBy: { category: "asc" },
        take: CATEGORY_LIMIT,
      }),
      // `tags` String[] olduğu için `distinct` kullanılamaz; son kayıtların
      // etiketleri toplanıp bellekte tekilleştiriliyor.
      prisma.invoice.findMany({
        where: { companyId, NOT: { tags: { isEmpty: true } } },
        select: { tags: true },
        orderBy: { createdAt: "desc" },
        take: TAG_SCAN_LIMIT,
      }),
      prisma.transaction.findMany({
        where: { companyId, NOT: { tags: { isEmpty: true } } },
        select: { tags: true },
        orderBy: { createdAt: "desc" },
        take: TAG_SCAN_LIMIT,
      }),
    ])

  const categories = Array.from(
    new Set(
      [...invoiceCategories, ...transactionCategories]
        .map((row) => row.category?.trim())
        .filter((value): value is string => Boolean(value))
    )
  ).sort((a, b) => a.localeCompare(b, "tr"))

  const tags = Array.from(
    new Set([...invoiceTags, ...transactionTags].flatMap((row) => row.tags))
  ).sort((a, b) => a.localeCompare(b, "tr"))

  return { categories, tags }
}

/**
 * Formdan gelen kategoriyi normalize eder: boşluklar kırpılır, boş değer `null`
 * olur. Boş dizgi saklanırsa rapor onu "" adlı bir kategori sanır ve
 * "Kategorisiz" satırının yanında ikinci bir boş satır açılırdı.
 */
export function normalizeCategory(value: unknown): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

/** Formdan gelen etiketleri normalize eder: kırpılır, boşlar ve yinelenenler düşer. */
export function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const cleaned = value
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim())
    .filter(Boolean)
  return Array.from(new Set(cleaned))
}
