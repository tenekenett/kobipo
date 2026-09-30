/**
 * KDV'YE GİREN BELGE kuralı — TEK YER.
 *
 * 2026-09-30'a kadar iki ayrı kural vardı ve aynı ay için farklı rakam
 * üretiyordu:
 *   - vergi raporu (`computeVatDeclaration`): taslak satışları da sayıyor,
 *     para birimine bakmıyordu (dövizli faturanın KDV'si TL'ymiş gibi toplanırdı);
 *   - KDV otomasyon kartı (`kdv-donemi.ts`): yalnız GÖNDERİLMİŞ satışı ve yalnız
 *     TL faturayı sayıyordu.
 * Pano KDV kartı eklenince iki ekran aynı dönem için iki rakam gösterecekti.
 *
 * ── Kural (karar: 2026-09-30) ───────────────────────────────────────────────
 * İptal (CANCELLED) ve faturaya dönüşmüş fiş (CONVERTED) hiçbir zaman girmez.
 * Kalanlar:
 *   - ALIŞ ailesi (alış, alış iadesi): kayıtlı her belge girer. Alış faturası
 *     ekranda "Kayıtlı" görünür ama iç durumu DRAFT'tır.
 *   - MATBU (MANUAL) satış faturası ve FİŞ: kaydedildiği an kesilmiştir, girer.
 *     "Onayla" (DRAFT → SENT) yalnız bir onay adımıdır; ölçüm (son 12 ay,
 *     canlı): 32 matbu fatura ve 54 fişin HEPSİ taslakta, yalnız 4 matbu
 *     fatura onaylanmış. "Yalnız SENT" kuralı 130.000 TL'yi aşan KDV'yi
 *     beyandan sessizce düşürürdü.
 *   - e-Fatura / e-Arşiv satış: yalnız GİB'e GÖNDERİLDİYSE (SENT) girer.
 *     Gönderilmemiş taslak ve Mysoft taslağı (GIB_DRAFT) henüz belge değildir.
 *
 * DÖVİZ: KDV TL karşılığıyla sayılır — faturadaki kur (`exchangeRate`). Kuru
 * olmayan dövizli belge ÇEVRİLEMEZ; toplamdan sessizce düşmez, sayısı ayrıca
 * döner ve ekran yazar.
 *
 * SQL ile TS karşılığı aynı kuralı iki dilde yazar: TS tarafı (`kdvyeGirerMi`)
 * kuralın matrisini testte sabitler, SQL tarafı sorgulara gömülür. Birini
 * değiştiren ötekini de değiştirir (kdv-kural.test.ts ikisini yan yana okur).
 */

import { Prisma } from "@prisma/client"
import { kaydedildigindeKesinlesir } from "@/lib/invoice/status-label"

export type KdvBelgesi = {
  type: string
  returnKind?: string | null
  status: string
  invoiceType: string
}

/** Satış ailesi: satış ve satış iadesi (yönü boş eski iadeler satış iadesidir). */
export function satisAilesindenMi(b: Pick<KdvBelgesi, "type" | "returnKind">): boolean {
  const t = String(b.type || "").toUpperCase()
  if (t === "SALES") return true
  return t === "RETURN" && String(b.returnKind || "SALES").toUpperCase() !== "PURCHASE"
}

/** Alış ailesi: alış ve alış iadesi. */
export function alisAilesindenMi(b: Pick<KdvBelgesi, "type" | "returnKind">): boolean {
  const t = String(b.type || "").toUpperCase()
  if (t === "PURCHASE") return true
  return t === "RETURN" && String(b.returnKind || "").toUpperCase() === "PURCHASE"
}

/**
 * Belge KDV'ye girer mi — kuralın TS karşılığı (bkz. başlık). "Kaydedildiği an
 * kesinleşen belge" tanımı ekrandaki "Kayıtlı" rozetiyle ORTAK
 * (`kaydedildigindeKesinlesir`): rozet "Kayıtlı" derken KDV saymasın, ya da tersi,
 * olmasın.
 */
export function kdvyeGirerMi(b: KdvBelgesi): boolean {
  const status = String(b.status || "").toUpperCase()
  if (status === "CANCELLED" || status === "CONVERTED") return false
  if (alisAilesindenMi(b)) return true
  if (!satisAilesindenMi(b)) return false
  if (kaydedildigindeKesinlesir({ invoiceType: b.invoiceType })) return true
  return status === "SENT"
}

// ── SQL karşılığı ──────────────────────────────────────────────────────────
// `alias` yalnız kod içi sabit bir tablo takma adıdır ("i"); kullanıcı girdisi
// buraya ASLA gelmez (Prisma.raw kaçış yapmaz).

const ALIAS = /^[a-z_][a-z0-9_]*$/

function a(alias: string): Prisma.Sql {
  if (!ALIAS.test(alias)) throw new Error(`Geçersiz tablo takma adı: ${alias}`)
  return Prisma.raw(alias)
}

export function satisAilesiSql(alias: string): Prisma.Sql {
  const t = a(alias)
  return Prisma.sql`(${t}.type = 'SALES' OR (${t}.type = 'RETURN' AND COALESCE(${t}."returnKind", 'SALES') <> 'PURCHASE'))`
}

export function alisAilesiSql(alias: string): Prisma.Sql {
  const t = a(alias)
  return Prisma.sql`(${t}.type = 'PURCHASE' OR (${t}.type = 'RETURN' AND ${t}."returnKind" = 'PURCHASE'))`
}

/** `kdvyeGirerMi`nin SQL karşılığı. */
export function kdvyeGirerSql(alias: string): Prisma.Sql {
  const t = a(alias)
  return Prisma.sql`(
    ${t}.status NOT IN ('CANCELLED', 'CONVERTED')
    AND (
      ${alisAilesiSql(alias)}
      OR (${satisAilesiSql(alias)} AND (${t}."invoiceType" = 'MANUAL' OR ${t}.status = 'SENT'))
    )
  )`
}

/**
 * KESİLMİŞ belge — KDV'ye giren belgeyle AYNI küme, anlamını söyleyen adla.
 * Ciro/müşteri analizi gibi KDV dışı sorgular bunu kullanır: "taslak satış"ı
 * elle `status NOT IN ('DRAFT', ...)` diye yazmak Manuel (kâğıt/matbu) faturayı
 * da dışarıda bırakıyordu.
 */
export const kesilmisBelgeSql = kdvyeGirerSql

/**
 * TL karşılığı çarpanı: TL belgede 1, dövizli belgede faturadaki kur. Kuru
 * olmayan dövizli belgede NULL — o belge toplama girmez, ayrıca sayılır.
 */
export function kdvKurSql(alias: string): Prisma.Sql {
  const t = a(alias)
  return Prisma.sql`(CASE WHEN COALESCE(${t}.currency, 'TRY') = 'TRY' THEN 1 ELSE NULLIF(${t}."exchangeRate", 0) END)`
}

/** Belgenin KDV'ye yazılacağı işaret: iade kendi ailesinin toplamını AZALTIR. */
export function kdvIsaretSql(alias: string): Prisma.Sql {
  const t = a(alias)
  return Prisma.sql`(CASE WHEN ${t}.type = 'RETURN' THEN -1 ELSE 1 END)`
}
