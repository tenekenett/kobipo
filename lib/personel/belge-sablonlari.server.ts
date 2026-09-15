import { prisma } from "@/lib/db/prisma"
import { trFold } from "@/lib/text/tr-fold"
import { govdeTemizle, govdeDuzMetin } from "@/lib/personel/belge-govde"

/**
 * İK belge şablonu kataloğu — sunucu tarafı ortak kuralları.
 *
 * İki kapsam tek tablodadır (`document_templates`): `companyId` boşsa KOBİPO
 * KATALOĞU, doluysa FİRMANIN kendi şablonu. Kapsam ayrımını okuyan/yazan her uç
 * buradan geçmeli — "firma kataloğu düzenleyebiliyor" hatası tek bir unutulmuş
 * `where` ile doğar.
 */

export type SablonKapsami = "KATALOG" | "FIRMA"

export type SablonGirdisi = {
  title: string
  body: string
  category?: string | null
  description?: string | null
  sortOrder?: number
  isActive?: boolean
}

/**
 * Prisma istemcisindeki model — YOKSA undefined.
 *
 * `prisma generate` sonrası yeniden başlatılmamış bir `next dev` modeli tanımaz ve
 * çağrı "undefined okunamıyor" diye patlar; o mesaj migrasyonu uygulamış olan
 * yöneticiyi yanlış yere bakmaya gönderiyor (bkz. role-templates.server.ts).
 */
export function documentTemplateModel() {
  return (prisma as { documentTemplate?: typeof prisma.documentTemplate }).documentTemplate
}

/** Tablo henüz yok mu? Prisma P2021, ham sürücü 42P01 ile bildirir. */
function isMissingTableError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return code === "P2021" || code === "42P01"
}

/** Katalog okunamadığında AYIRT EDİCİ sebep. */
export function describeSablonError(error: unknown): string {
  if (!documentTemplateModel()) {
    return "Sunucudaki Prisma istemcisi document_templates tablosunu tanımıyor. `npx prisma generate` sonrası geliştirme sunucusunu yeniden başlatın."
  }
  if (isMissingTableError(error)) {
    return "document_templates tablosu yok: supabase/migrations/20260915000001_document_templates.sql uygulanmamış."
  }
  return error instanceof Error ? error.message : "Şablonlar okunamadı"
}

/**
 * Panelden/uçtan gelen şablon gövdesini yazılabilir hâle getirir.
 *
 * Gövde HER İKİ kapsamda da aynı süzgeçten geçer: sistem yöneticisinin yazdığı
 * HTML de kullanıcı tarayıcısında önizleniyor, ayrıcalıklı sayılamaz.
 */
export function normalizeSablon(girdi: SablonGirdisi): {
  hata?: string
  veri?: Required<Pick<SablonGirdisi, "title" | "body">> & {
    category: string | null
    description: string | null
    sortOrder: number
    isActive: boolean
  }
} {
  const title = String(girdi.title ?? "").trim()
  if (!title) return { hata: "Şablon adı zorunlu" }
  if (title.length > 160) return { hata: "Şablon adı en fazla 160 karakter olabilir" }

  const body = govdeTemizle(String(girdi.body ?? ""))
  // Etiketten arınmış hâli boşsa gövde gerçekten boştur: `<p></p>` kaydedilip
  // sonra bomboş bir belge basılmasın.
  if (!govdeDuzMetin(body)) return { hata: "Şablon metni boş olamaz" }
  if (body.length > 60_000) return { hata: "Şablon metni çok uzun (en fazla 60.000 karakter)" }

  return {
    veri: {
      title,
      body,
      category: girdi.category ? String(girdi.category).trim().slice(0, 60) || null : null,
      description: girdi.description ? String(girdi.description).trim().slice(0, 300) || null : null,
      sortOrder: Number.isFinite(Number(girdi.sortOrder)) ? Number(girdi.sortOrder) : 0,
      isActive: girdi.isActive === undefined ? true : Boolean(girdi.isActive),
    },
  }
}

/**
 * Başlıktan anahtar tabanı.
 *
 * `lib/slug.ts`'teki `slugify` BİLEREK kullanılmıyor: orası önce `toLowerCase()`
 * çağırıyor ve `"İ".toLowerCase()` Türkçe'de "i" değil "i" + U+0307 (iki kod birimi)
 * üretiyor; birleşen nokta sonra `[^a-z0-9]` süzgecine takılıp tireye dönüşüyor.
 * Sonuç: "Yıllık İzin Talep Formu" → "yillik-i-zin-talep-formu". Anahtar dosya adına
 * ve kopya izine (`sourceKey`) giriyor, bozuk üretilemez. Katlama tek yerden gelir:
 * `trFold` (bkz. CLAUDE.md → Türkçe duyarsız arama).
 */
export function sablonAnahtarTabani(title: string): string {
  return (
    trFold(title)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "sablon"
  )
}

/**
 * Kapsam içinde benzersiz anahtar üretir.
 *
 * Anahtar KOPYANIN İZİDİR (`sourceKey`), o yüzden ad değişse bile değişmez; yalnız
 * oluştururken bir kez hesaplanır.
 */
export async function benzersizSablonAnahtari(title: string, companyId: string | null): Promise<string> {
  const model = documentTemplateModel()
  const taban = sablonAnahtarTabani(title)
  if (!model) return taban

  const mevcut = await model.findMany({
    where: { companyId, key: { startsWith: taban } },
    select: { key: true },
  })
  const kullanilan = new Set(mevcut.map((m) => m.key))
  if (!kullanilan.has(taban)) return taban
  for (let i = 2; i < 1000; i++) {
    const aday = `${taban}-${i}`
    if (!kullanilan.has(aday)) return aday
  }
  return `${taban}-${Date.now()}`
}

export type SablonSatiri = {
  id: string
  key: string
  sourceKey: string | null
  title: string
  category: string | null
  description: string | null
  body: string
  sortOrder: number
  isActive: boolean
  /** Bu satır Kobipo kataloğundan mı geliyor yoksa firmanın kendisinden mi? */
  kapsam: SablonKapsami
  /** Katalog satırı firmanın kopyasıyla gizlenmiş mi? (yalnız yönetim ekranı için) */
  kopyalanmis?: boolean
}

/**
 * Firmanın GÖRDÜĞÜ şablon listesi: kendi şablonları + kopyalanmamış katalog satırları.
 *
 * KOPYA KATALOĞU GİZLER: firma bir kalıbı kopyaladıysa katalog satırı listede
 * çıkmaz, yoksa aynı belge iki kez görünür ve kullanıcı hangisinin kendi düzenlediği
 * olduğunu ayırt edemez. Eşleşme `sourceKey` üzerindendir.
 */
export async function firmaSablonlari(
  companyId: string,
  options?: { includeInactive?: boolean },
): Promise<SablonSatiri[]> {
  const model = documentTemplateModel()
  if (!model) throw new Error("stale-client")

  const [firma, katalog] = await Promise.all([
    model.findMany({
      where: { companyId, ...(options?.includeInactive ? {} : { isActive: true }) },
      orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
    }),
    model.findMany({
      where: { companyId: null, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
    }),
  ])

  const kopyalanan = new Set(firma.map((f) => f.sourceKey).filter(Boolean) as string[])

  const satir = (t: (typeof firma)[number], kapsam: SablonKapsami): SablonSatiri => ({
    id: t.id,
    key: t.key,
    sourceKey: t.sourceKey,
    title: t.title,
    category: t.category,
    description: t.description,
    body: t.body,
    sortOrder: t.sortOrder,
    isActive: t.isActive,
    kapsam,
  })

  return [
    ...katalog.filter((k) => !kopyalanan.has(k.key)).map((k) => satir(k, "KATALOG")),
    ...firma.map((f) => satir(f, "FIRMA")),
  ].sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, "tr"))
}

/**
 * Firmanın belge basmak için kullanabileceği TEK şablonu çözer.
 *
 * `id` hem katalog hem firma satırına ait olabilir; kapsam denetimi burada yapılır.
 * Uçlar bu fonksiyonu çağırmalı — `findUnique({ id })` demek, başka firmanın
 * şablonunu okumak demektir.
 */
export async function firmaIcinSablonBul(id: string, companyId: string) {
  const model = documentTemplateModel()
  if (!model) throw new Error("stale-client")

  const kayit = await model.findUnique({ where: { id } })
  if (!kayit) return null
  // Katalog satırı herkese açık; firma satırı YALNIZ sahibine.
  if (kayit.companyId !== null && kayit.companyId !== companyId) return null
  return kayit
}
