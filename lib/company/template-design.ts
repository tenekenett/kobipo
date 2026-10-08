/**
 * TASARIMI BAŞKA KAYITTA DURAN ŞABLON — logo (`logo.ts`) ve kaşe (`stamp.ts`) ortak kuralı.
 *
 * Belge Şablonları listesi Mysoft'tan (mükellefin hesabından) gelir; firma, aynı Mysoft
 * hesabını kullanan BAŞKA bir Kobipo kaydında tasarlanmış şablonu da görür ve aktif
 * yapabilir. O zaman firmanın satırında tasarım (`options`) yoktur; logo/kaşe tasarımın
 * yapıldığı kayıttadır — Eren Forklift'in üç kaydı aynı VKN ve Mysoft kullanıcısını
 * paylaşıyor (2026-10-08).
 *
 * Tasarım yalnız AYNI mükellef VKN'si + AYNI Mysoft kullanıcısı + aynı ortamdaki kayıttan
 * alınır: "aktif yap" ucu Mysoft'a sormadan satır açtığı için yalnız VKN eşleşmesi,
 * başkasının VKN'sini giren birine o firmanın logosunu/kaşesini verirdi. Aynı ad birden
 * çok kayıtta tasarlandıysa en son güncellenen — Mysoft'a en son o yüklendi.
 *
 * Saf modül: sorgu `template-design.server.ts`te.
 */

/**
 * İki kaydın şablonları aynı Mysoft hesabında mı: mükellef VKN'si, API kullanıcısı ve
 * ortam (test/canlı adresi). Biri eksikse kimlik YOKTUR — eşleşme kurulmaz.
 */
export function designIdentity(args: {
  tenantVkn: string
  username: string | null | undefined
  baseUrl: string | null | undefined
}): string | null {
  const username = (args.username || "").trim().toLowerCase()
  if (!args.tenantVkn || !username) return null
  return `${args.tenantVkn}|${username}|${(args.baseUrl || "").trim().replace(/\/+$/, "").toLowerCase()}`
}

export type DesignRow = {
  id: string
  companyId: string
  eDocumentType: number
  xsltName: string
  hidden: boolean
  /** Satırda tasarım (`options`) var mı — yoksa şablon Mysoft listesinden seçilmiştir. */
  hasDesign: boolean
}

export type DesignCandidate = {
  id: string
  companyId: string
  eDocumentType: number
  xsltName: string
  updatedAt: Date
}

/**
 * Tasarımsız her satır için kardeş kayıttaki tasarım satırının id'si (satır id → tasarım id).
 * `identityOf`: firma id → Mysoft kimliği (`designIdentity`); kimliği olmayan eşleşmez.
 */
export function matchForeignDesigns(
  rows: DesignRow[],
  designs: DesignCandidate[],
  identityOf: (companyId: string) => string | null | undefined,
): Map<string, string> {
  const sorted = [...designs].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || a.id.localeCompare(b.id),
  )
  const result = new Map<string, string>()
  for (const row of rows) {
    if (row.hasDesign || row.hidden) continue
    const identity = identityOf(row.companyId)
    if (!identity) continue
    const design = sorted.find(
      (d) =>
        d.companyId !== row.companyId &&
        d.eDocumentType === row.eDocumentType &&
        d.xsltName === row.xsltName &&
        identityOf(d.companyId) === identity,
    )
    if (design) result.set(row.id, design.id)
  }
  return result
}
