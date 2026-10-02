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
 *   - ALIŞ FATURASI: kayıtlı her belge girer (ALINAN belge). Ekranda "Kayıtlı"
 *     görünür ama iç durumu DRAFT'tır. İADE faturaları (satış ve alış iadesi)
 *     bizim DÜZENLEDİĞİMİZ belgedir ve aşağıdaki satış kuralına tabidir
 *     (2026-10-01 düzeltmesi: alış iadesi önce alış gibi her zaman sayılıyordu).
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
  if (!alisAilesindenMi(b) && !satisAilesindenMi(b)) return false
  // ALIŞ FATURASI ALINAN belgedir: kaydı yeter. İADE ise (iki yönde de) bizim
  // düzenlediğimiz belgedir — satış gibi: Manuel ise kayıtla, e-belge ise ancak
  // GİB'e gidince kesilir. (Liste rozeti de alış iadesini böyle okur.)
  if (String(b.type || "").toUpperCase() === "PURCHASE") return true
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
    AND (${alisAilesiSql(alias)} OR ${satisAilesiSql(alias)})
    AND (${t}.type = 'PURCHASE' OR ${t}."invoiceType" = 'MANUAL' OR ${t}.status = 'SENT')
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

// ── Fatura altı iskonto / ilave ────────────────────────────────────────────

/**
 * Kalem tutarını BELGEDEKİ karşılığına çeviren katsayı (fatura altı iskonto ve
 * ilave). KALEMDEN KDV TOPLAYAN HER SORGU bunu kullanır.
 *
 * Kalem satırı (`invoice_items`) KDV'sini, tevkifatını ve toplamını fatura altı
 * iskonto DÜŞÜLMEDEN saklar (`createInvoiceFromBody` → `computeLineTax(net)`).
 * Faturanın başlığı ve GİB'e giden belge ise iskontoyu satırlara dağıtıp vergiyi
 * ondan sonra hesaplar (`lib/invoice/document-totals.ts`). Kalemi düz toplayan
 * KDV raporu bu yüzden iskontolu belgede FAZLA, ilaveli belgede EKSİK KDV
 * gösteriyordu (2026-10-02: SAT-2026-0120'de belge 393,11, kalem 538,50; son
 * 12 ayda 27 belgede kalem KDV'si başlıktan ~5.250 TL fazla. Gerçek müşteride:
 * Eren Forklift Eylül 2026 alış faturası ORS2026000000886 → indirilecek KDV
 * 83,04 TL fazla, yani beyan edilecek KDV o kadar EKSİK görünüyordu).
 *
 * Dağıtım satır tutarıyla ORANTILI olduğu için her satır aynı katsayıyla küçülür:
 *   f = (ara toplam − iskonto + ilave) / ara toplam
 *   ara toplam = Σ(miktar × birim fiyat − satır iskontosu)
 * Kırpma document-totals ile aynı: iskonto [0, ara toplam] aralığına çekilir,
 * ilave eksi olamaz, ara toplam sıfır ya da eksiyse belge ölçeklenmez. Fiş kuralı
 * (`receiptTotals` → `applyGlobalAdjustment`) da aynı katsayıyı kullanır. Maktu
 * GEKAP ve ondan doğan KDV/tevkifat katsayıdan MUAFTIR: `belgedekiTutarSql`.
 *
 * Kalemlerde saklı tutarlar DÜZELTİLMEDİ (karar 2026-10-02): belgeler ve PDF'ler
 * doğru, yanlış olan yalnız kalemi toplayan rapordu.
 *
 * TS karşılığı `lib/raporlar/fatura-alti.ts` (satış/alış raporunun kalem ve ürün
 * bölümleri); birini değiştiren ötekini de değiştirir. TS tarafı belgenin kendi
 * hesabıyla (document-totals) birim testte karşılaştırılır.
 *
 * Ölçüm (canlı, 2026-10-02): fatura altı iskontolu ya da ilaveli 31 belgenin
 * 31'inde Σ kalem KDV × f başlıktaki KDV'yi 5 kuruş içinde tutturuyor
 * (`kdv-kural.canli.test.ts`).
 */
export function faturaAltiCarpanSql(alias: string): Prisma.Sql {
  const t = a(alias)
  const iskonto = Prisma.sql`COALESCE(${t}."globalDiscountAmount", 0)`
  const ilave = Prisma.sql`COALESCE(${t}."globalChargeAmount", 0)`
  const brut = Prisma.sql`fa_kalem.quantity * fa_kalem."unitPrice"`
  return Prisma.sql`(CASE WHEN ${iskonto} <= 0 AND ${ilave} <= 0 THEN 1 ELSE COALESCE((
    SELECT CASE WHEN fa_toplam.ara > 0
                THEN (fa_toplam.ara - LEAST(GREATEST(${iskonto}, 0), fa_toplam.ara) + GREATEST(${ilave}, 0)) / fa_toplam.ara
           END
    FROM (
      SELECT SUM(${brut} - GREATEST(0, LEAST(COALESCE(fa_kalem."discountAmount", 0), ${brut}))) AS ara
      FROM invoice_items fa_kalem
      WHERE fa_kalem."invoiceId" = ${t}.id
    ) fa_toplam
  ), 1) END)`
}

/**
 * Kalemde saklı bir tutarın belgedeki karşılığı: `(tutar − sabit) × f + sabit`.
 * `sabit`, katsayıdan muaf kısımdır (maktu GEKAP'ın kendisi, KDV'si ya da
 * tevkifatı: `kalemGekapSql`). `applyGlobalAdjustment` ile aynı ayrım.
 */
export function belgedekiTutarSql(tutar: Prisma.Sql, sabit: Prisma.Sql, carpan: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`(((${tutar}) - (${sabit})) * ${carpan} + (${sabit}))`
}

/**
 * Kalemin maktu GEKAP'ı ve ondan doğan KDV/tevkifat: fatura altı iskonto bunları
 * küçültmez. Formül `computeLineTax`ın `gekap`/`gekapVat`/`gekapWithholding`u.
 */
export function kalemGekapSql(alias: string): { gekap: Prisma.Sql; kdv: Prisma.Sql; tevkifat: Prisma.Sql } {
  const k = a(alias)
  const gekap = Prisma.sql`COALESCE(${k}."gekapAmount", 0)`
  const kdv = Prisma.sql`(${gekap} * COALESCE(${k}."vatRate", 0) / 100)`
  return { gekap, kdv, tevkifat: Prisma.sql`(${kdv} * COALESCE(${k}."withholdingRate", 0) / 100)` }
}
