/**
 * Vergi beyanname hazırlık raporları: KDV, Muhtasar.
 *
 * `app/api/raporlar/{kdv-beyanname,muhtasar}/route.ts`ten ayıklandı — dışa
 * aktarma ucu da aynı fonksiyonları çağırır.
 *
 * Ba-Bs formu YOK: VUK Genel Tebliği 565 (RG 25.09.2024) ile Eylül 2024
 * döneminden itibaren bildirim kaldırıldı. Rapor 2026-10-01'de silindi; geri
 * eklemeyin — verilmeyen bir formu hazırlatmak kullanıcıyı yanıltır.
 */

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { OTHER_TAX_CODES_IN_VAT_BASE } from "@/lib/integrations/e-invoice/gib-tax-types"
import {
  alisAilesiSql,
  kdvIsaretSql,
  kdvKurSql,
  kdvyeGirerSql,
  satisAilesiSql,
} from "@/lib/raporlar/kdv-kural"

export type VatPeriod = "monthly" | "quarterly" | "yearly"

/** Bir KDV oranının satırı. */
export type VatRateRow = {
  vatRate: number
  /** KDV matrahı (TL): kalemin KDV'siz tutarı. */
  base: number
  /** Faturada yazan KDV'nin tamamı (TL). */
  vatAmount: number
  /** Tevkif edilen kısım (TL) — karşı taraf KDV-2 ile öder. */
  withheld: number
}

export type VatDeclarationResult = {
  period: VatPeriod
  year: number
  month?: number
  startDate: string
  endDate: string
  /**
   * Beyana giren HESAPLANAN KDV: satışlardaki KDV − alıcının tevkif ettiği kısım.
   * (Kısmi tevkifatta satıcı KDV'nin yalnız tevkif edilmeyen kısmını beyan eder.)
   */
  calculatedVAT: number
  /** İndirilecek KDV: alış faturalarındaki KDV'nin TAMAMI (tevkifatlı alış dahil). */
  deductibleVAT: number
  /** 1 No.lu beyanın farkı: hesaplanan − indirilecek. Eksi = sonraki aya devreden. */
  netVAT: number
  /**
   * Tevkifat (TL):
   *   sales     → satışlarımızda alıcının tevkif ettiği KDV; hesaplanandan DÜŞÜLDÜ.
   *   purchases → alışlarımızda BİZİM tevkif ettiğimiz KDV: 2 No.lu beyanla
   *               ödenir; indirilecek KDV'nin içinde zaten var (aynı ay indirilir).
   */
  withholding: { sales: number; purchases: number }
  breakdown: { sales: VatRateRow[]; purchases: VatRateRow[] }
  /** KDV'ye giren belge sayısı (iadeler dahil) — kart metinleri okur. */
  documentCounts: { sales: number; purchases: number }
  /**
   * Kuru girilmemiş dövizli belge: TL'ye çevrilemediği için toplama GİRMEDİ.
   * Sıfır değilse ekran bunu yazar — sessizce düşmez (bkz. kdv-kural.ts).
   */
  unconvertedForeign: number
}

/**
 * Dönemin sınırları — UTC gece yarısı ekseninde (`invoices.date` öyle saklanıyor;
 * canlıda 2026-10-01: 651 kaydın hepsi 00:00 UTC). `endDate` dönemin SON
 * milisaniyesidir. (2026-10-01'e kadar yerel saatle kuruluyordu: sunucu UTC'de
 * fark etmiyordu, TSİ'de çalışan geliştirme ortamında ay 3 saat kayıyordu.)
 */
export function resolveVatRange(period: VatPeriod, year: number, month: number) {
  const ay = (y: number, m0: number) => new Date(Date.UTC(y, m0, 1))
  const [bas, sonHaric] =
    period === "monthly"
      ? [ay(year, month - 1), ay(year, month)]
      : period === "quarterly"
        ? [ay(year, (month - 1) * 3), ay(year, month * 3)] // month = çeyrek (1–4)
        : [ay(year, 0), ay(year + 1, 0)]
  return { startDate: bas, endDate: new Date(sonHaric.getTime() - 1) }
}

// Kuruş: TL karşılığı çarpımı kuruş altı basamak üretebilir; satırlar ekranda ve
// Excel'de toplanacağı için kuruşa yuvarlanır.
const kurus = (n: unknown) => Math.round(Number(n ?? 0) * 100) / 100

/**
 * Kalemin toplamında duran ama KDV matrahına girmeyen "diğer vergi" tutarı.
 * Kod listesi tek yerden (`OTHER_TAX_CODES_IN_VAT_BASE`); kodu bilinmeyen vergi
 * matraha girmez sayılır — `isOtherTaxInVatBase` ile aynı varsayım.
 */
const matrahDisiVergiSql = Prisma.sql`(CASE WHEN TRIM(COALESCE(ii."otherTaxCode", '')) IN (${Prisma.join(
  OTHER_TAX_CODES_IN_VAT_BASE,
)}) THEN 0 ELSE COALESCE(ii."otherTaxAmount", 0) END)`

export async function computeVatDeclaration(args: {
  companyId: string
  period?: VatPeriod
  year: number
  month: number
}): Promise<VatDeclarationResult> {
  const period = args.period ?? "monthly"
  const { startDate, endDate } = resolveVatRange(period, args.year, args.month)

  // Hangi belgenin KDV'ye girdiği ve dövizin TL'ye çevrimi TEK YERDE:
  // lib/raporlar/kdv-kural.ts. (İptal ve faturaya dönüşmüş fiş girmez —
  // CONVERTED fiş süzülmezse KDV'si hem fişte hem faturada sayılırdı; Reypo
  // Medya'da 6 fiş / 8.616 TL fazladan ölçülmüştü.)
  //
  // İADELER kendi ailesinin toplamını AZALTIR (satış iadesi hesaplananı, alış
  // iadesi indirilecek KDV'yi). Oran kırılımı ilgili tarafta netlenir ki satış
  // ve iade aynı satırda görünsün; iade oranı faturada yoksa eksi satır kalır.
  //
  // MATRAH kalemden türetilir: `totalAmount` KDV dahil ve tevkifat DÜŞÜLMÜŞ
  // ödenecek tutardır (lib/invoice/line-tax.ts), KDV'siz tutar ona KDV'yi çıkarıp
  // tevkifatı geri ekleyerek bulunur. (2026-10-01'e kadar oran tablosunun
  // "Tutar" sütunu bu KDV dahil rakamı gösteriyordu.) Kısmi tevkifatta da matrah
  // KDV hariç bedelin TAMAMIdır — tevkif edilen KDV matrahı küçültmez.
  //
  // Toplamda KDV matrahına GİRMEYEN "diğer vergi" de durur: ÖİV (6802 s. K.) ve
  // Konaklama Vergisi kendi kanunlarıyla matrah dışıdır, ayrı kalem olarak
  // eklenir. Matrah sütunundan düşülür; kural `isOtherTaxInVatBase` ile aynı
  // liste (ÖTV ve GEKAP matraha girer, kalır).
  const where = Prisma.sql`
    i."companyId" = ${args.companyId}
    AND i.date >= ${startDate} AND i.date <= ${endDate}
    AND ${kdvyeGirerSql("i")}
  `
  const isaretKur = Prisma.sql`${kdvIsaretSql("i")} * ${kdvKurSql("i")}`
  const [rateRows, countRows] = await Promise.all([
    prisma.$queryRaw<
      Array<{ aile: string; vatRate: unknown; vat: unknown; withheld: unknown; base: unknown }>
    >(Prisma.sql`
      SELECT CASE WHEN ${satisAilesiSql("i")} THEN 'S' ELSE 'P' END AS aile,
             ii."vatRate" AS "vatRate",
             COALESCE(SUM(${isaretKur} * ii."vatAmount"), 0) AS vat,
             COALESCE(SUM(${isaretKur} * COALESCE(ii."withholdingAmount", 0)), 0) AS withheld,
             COALESCE(SUM(${isaretKur} * (
               ii."totalAmount" - ii."vatAmount" + COALESCE(ii."withholdingAmount", 0) - ${matrahDisiVergiSql}
             )), 0) AS base
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii."invoiceId"
      WHERE ${where} AND ${kdvKurSql("i")} IS NOT NULL
      GROUP BY 1, 2
      ORDER BY 2
    `),
    prisma.$queryRaw<Array<{ satis: bigint; alis: bigint; kursuz: bigint }>>(Prisma.sql`
      SELECT COUNT(*) FILTER (WHERE ${satisAilesiSql("i")} AND ${kdvKurSql("i")} IS NOT NULL) AS satis,
             COUNT(*) FILTER (WHERE ${alisAilesiSql("i")} AND ${kdvKurSql("i")} IS NOT NULL) AS alis,
             COUNT(*) FILTER (WHERE ${kdvKurSql("i")} IS NULL) AS kursuz
      FROM invoices i
      WHERE ${where}
    `),
  ])

  const toRows = (aile: string): VatRateRow[] =>
    rateRows
      .filter((r) => r.aile === aile)
      .map((r) => ({
        vatRate: Number(r.vatRate),
        base: kurus(r.base),
        vatAmount: kurus(r.vat),
        withheld: kurus(r.withheld),
      }))
      .sort((a, b) => a.vatRate - b.vatRate)

  const sales = toRows("S")
  const purchases = toRows("P")
  const sum = (rows: VatRateRow[], key: "vatAmount" | "withheld") =>
    kurus(rows.reduce((t, r) => t + r[key], 0))

  const withheldOnSales = sum(sales, "withheld")
  const calculatedVAT = kurus(sum(sales, "vatAmount") - withheldOnSales)
  const deductibleVAT = sum(purchases, "vatAmount")
  const counts = countRows[0]

  return {
    period,
    year: args.year,
    month: period === "monthly" ? args.month : undefined,
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    calculatedVAT,
    deductibleVAT,
    netVAT: kurus(calculatedVAT - deductibleVAT),
    withholding: { sales: withheldOnSales, purchases: sum(purchases, "withheld") },
    breakdown: { sales, purchases },
    documentCounts: { sales: Number(counts?.satis ?? 0), purchases: Number(counts?.alis ?? 0) },
    unconvertedForeign: Number(counts?.kursuz ?? 0),
  }
}

// ── Beyan öncesi kontrol listesi ───────────────────────────────────────────

export type AktarilmamisGelen = {
  /** Kabul edilmiş, alış faturasına AKTARILMAMIŞ gelen e-fatura (TL). */
  adet: number
  kdv: number
  /** İçlerindeki en büyük tek KDV — çöp kayıt toplamı ele geçirirse görünsün. */
  enBuyuk: number
  /** Dövizli olanlar: KDV'leri toplamda YOK (kur gelen kayıtta tutulmuyor). */
  dovizli: number
}

/**
 * Aktarılmamış gelen e-faturalar — beyan öncesi en sık kaçan indirim.
 * K-BLG-07 kartı ile vergi raporu AYNI sorguyu kullanır; aralık `[bas, sonHaric)`,
 * ikisi de bir TAKVİM GÜNÜNÜN UTC gece yarısı (`Date.UTC(y, m, 1)`).
 *
 * `docDate` İstanbul gece yarısı olarak saklanıyor (21:00 UTC — canlıda
 * 2026-10-01: 2.386 kaydın hepsi), faturaların `date`i ise 00:00 UTC. Ham
 * karşılaştırma ayın 1'indeki gelen faturayı ÖNCEKİ aya yazıyordu; gün bu
 * yüzden İstanbul takvimine çevrilip karşılaştırılır.
 */
/** İstanbul takvim günü — `lib/restoran/reports.ts` → `localDay` ile aynı dönüşüm. */
const istanbulGunuSql = (col: Prisma.Sql) =>
  Prisma.sql`((${col}) AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Istanbul')::date`

/** UTC gece yarısı Date → "YYYY-MM-DD" (SQL'de `::date` ile karşılaştırılır). */
const gunMetni = (d: Date) => d.toISOString().slice(0, 10)

export async function aktarilmamisGelenFaturalar(args: {
  companyId: string
  bas: Date
  sonHaric: Date
}): Promise<AktarilmamisGelen> {
  const rows = await prisma.$queryRaw<
    Array<{ adet: bigint; kdv: unknown; en_buyuk: unknown; dovizli: bigint }>
  >(Prisma.sql`
    SELECT COUNT(*) FILTER (WHERE COALESCE(ii."currencyCode", 'TRY') = 'TRY') AS adet,
           COALESCE(SUM(ii."vatAmount") FILTER (WHERE COALESCE(ii."currencyCode", 'TRY') = 'TRY'), 0) AS kdv,
           COALESCE(MAX(ii."vatAmount") FILTER (WHERE COALESCE(ii."currencyCode", 'TRY') = 'TRY'), 0) AS en_buyuk,
           COUNT(*) FILTER (WHERE COALESCE(ii."currencyCode", 'TRY') <> 'TRY') AS dovizli
    FROM incoming_invoices ii
    WHERE ii."companyId" = ${args.companyId}
      AND ii.status = 'KABUL'
      AND ii."isLinkedToPurchase" = false
      AND ii."isArchived" = false
      AND ${istanbulGunuSql(Prisma.sql`ii."docDate"`)} >= ${gunMetni(args.bas)}::date
      AND ${istanbulGunuSql(Prisma.sql`ii."docDate"`)} < ${gunMetni(args.sonHaric)}::date
  `)
  const r = rows[0]
  return {
    adet: Number(r?.adet ?? 0),
    kdv: kurus(r?.kdv),
    enBuyuk: kurus(r?.en_buyuk),
    dovizli: Number(r?.dovizli ?? 0),
  }
}

export type VatChecklist = {
  aktarilmamis: AktarilmamisGelen
  /**
   * Dönemde düzenlenmiş ama GİB'e gönderilmemiş e-belge (satış, iade): KDV
   * kuralının tam TÜMLEYENİ — iptal/dönüşmüş değil, ama KDV'ye de girmiyor.
   * `kdv`: gönderilince HESAPLANAN KDV'ye eklenecek tutar — satış ailesinin
   * kalem KDV'si, alıcının tevkif edeceği kısım düşülmüş (iade eksi). Beyan
   * hesabıyla aynı tanım (`computeVatDeclaration`); başlıktaki KDV'yi toplamak
   * tevkifatlı taslakta fazlasını gösteriyordu.
   */
  gonderilmemis: { adet: number; kdv: number }
}

/** Beyandan önce yapılması gerekenler — vergi raporu sayfasının uyarıları. */
export async function computeVatChecklist(args: {
  companyId: string
  year: number
  month: number
}): Promise<VatChecklist> {
  const { startDate, endDate } = resolveVatRange("monthly", args.year, args.month)
  const sonHaric = new Date(endDate.getTime() + 1)

  const [aktarilmamis, taslak] = await Promise.all([
    aktarilmamisGelenFaturalar({ companyId: args.companyId, bas: startDate, sonHaric }),
    prisma.$queryRaw<Array<{ adet: bigint; kdv: unknown }>>(Prisma.sql`
      SELECT COUNT(*) AS adet,
             COALESCE(SUM(k.kdv * ${kdvIsaretSql("i")} * ${kdvKurSql("i")})
                      FILTER (WHERE ${satisAilesiSql("i")}), 0) AS kdv
      FROM invoices i
      LEFT JOIN LATERAL (
        SELECT SUM(ii."vatAmount" - COALESCE(ii."withholdingAmount", 0)) AS kdv
        FROM invoice_items ii
        WHERE ii."invoiceId" = i.id
      ) k ON true
      WHERE i."companyId" = ${args.companyId}
        AND i.date >= ${startDate} AND i.date <= ${endDate}
        AND i.status NOT IN ('CANCELLED', 'CONVERTED')
        AND (${satisAilesiSql("i")} OR ${alisAilesiSql("i")})
        AND NOT ${kdvyeGirerSql("i")}
    `),
  ])

  return {
    aktarilmamis,
    gonderilmemis: { adet: Number(taslak[0]?.adet ?? 0), kdv: kurus(taslak[0]?.kdv) },
  }
}

// ── Muhtasar (bordrodan) ───────────────────────────────────────────────────

export type MuhtasarCalisani = {
  /** Personel kartının adresi (slug ya da id). */
  ref: string
  ad: string
  /** Brüt ücret + prim/ek ödeme. */
  brut: number
  /** SGK + işsizlik, işçi payı. */
  sgkIsci: number
  /** Gelir vergisi + damga vergisi (bordroda tek alan). */
  gelirDamga: number
  net: number
  odendi: boolean
}

export type MuhtasarResult = {
  period: { year: number; month: number }
  bordroSayisi: number
  brut: number
  sgkIsci: number
  gelirDamga: number
  net: number
  /** Henüz "ödendi" işaretlenmemiş bordro. */
  odenmemis: number
  /**
   * Dönemde çalışan ama bordrosu girilmemiş personel: muhtasar rakamı onlar
   * OLMADAN hesaplandı. `adlar` yalnız çalışan dökümünü görebilene doludur.
   */
  bordrosuz: { sayi: number; adlar: string[] | null }
  /** Çalışan bazında döküm; maaş yetkisi yoksa null (yalnız toplamlar). */
  calisanlar: MuhtasarCalisani[] | null
}

/**
 * Muhtasar ve Prim Hizmet Beyannamesi hazırlığı — Personel → Maaş'ta girilen
 * bordrolardan (`PayrollRecord`): çalışandan kesilen gelir + damga vergisi ve
 * SGK işçi payı.
 *
 * 2026-10-01'e kadar bu rapor açıklamasında "maaş" geçen gider hareketlerinin
 * %15'ini "stopaj" diye gösteriyordu: ücret stopajı %15 değildir (dilimli gelir
 * vergisi + damga) ve canlıda son 12 ayda tek firmada tek kayıt eşleşmemişti.
 *
 * BİLEREK yok (ekran yazar): işveren SGK payı ve teşvikler (bordroda
 * tutulmuyor), kira/serbest meslek stopajı (Kobipo'da belgesi yok).
 *
 * `calisanDetayi`: kişi başı maaş, vergi raporunu görebilen herkese açılmaz —
 * yalnız Maaş sayfasını açabilene (uç `canViewPage(..., "/personel/maas")` ile
 * karar verir; Personel Raporları da diğer rollere yalnız toplam gösteriyor).
 */
export async function computeMuhtasar(args: {
  companyId: string
  year: number
  month: number
  calisanDetayi: boolean
}): Promise<MuhtasarResult> {
  const ayBas = new Date(Date.UTC(args.year, args.month - 1, 1))
  const aySon = new Date(Date.UTC(args.year, args.month, 0, 23, 59, 59))

  const [bordrolar, personel] = await Promise.all([
    prisma.payrollRecord.findMany({
      where: { companyId: args.companyId, periodYear: args.year, periodMonth: args.month },
      include: { employee: { select: { firstName: true, lastName: true, slug: true, id: true } } },
    }),
    prisma.employee.findMany({
      where: { companyId: args.companyId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        hireDate: true,
        terminationDate: true,
        status: true,
      },
    }),
  ])

  const calisanlar: MuhtasarCalisani[] = bordrolar
    .map((p) => ({
      ref: p.employee.slug || p.employee.id,
      ad: `${p.employee.firstName} ${p.employee.lastName}`.trim(),
      brut: kurus(Number(p.grossSalary) + Number(p.bonus)),
      sgkIsci: kurus(p.sgkDeduction),
      gelirDamga: kurus(p.taxDeduction),
      net: kurus(p.netSalary),
      odendi: p.status === "PAID",
    }))
    .sort((a, b) => a.ad.localeCompare(b.ad, "tr"))

  // Dönemde çalışıyor mu: işe giriş ay sonundan önce, çıkış ay başından sonra.
  // Çıkış tarihi olmayan "TERMINATED" kayıt bilinemez → sayılmaz (dürtmeyiz).
  // İZİNLİ (ON_LEAVE) çalışan BİLEREK sayılır: ücretsiz izindeki sigortalı da
  // MPHB'de yer alır, eksik gün nedeniyle (kod 21 "diğer ücretsiz izin") — ay boyu
  // izinli kişinin de o ay bir bordro satırı olmalı.
  const bordrosuOlan = new Set(bordrolar.map((p) => p.employeeId))
  const bordrosuz = personel.filter((e) => {
    if (bordrosuOlan.has(e.id)) return false
    if (e.hireDate && e.hireDate > aySon) return false
    if (e.terminationDate) return e.terminationDate >= ayBas
    return e.status !== "TERMINATED"
  })

  const topla = (key: "brut" | "sgkIsci" | "gelirDamga" | "net") =>
    kurus(calisanlar.reduce((t, c) => t + c[key], 0))

  return {
    period: { year: args.year, month: args.month },
    bordroSayisi: calisanlar.length,
    brut: topla("brut"),
    sgkIsci: topla("sgkIsci"),
    gelirDamga: topla("gelirDamga"),
    net: topla("net"),
    odenmemis: calisanlar.filter((c) => !c.odendi).length,
    bordrosuz: {
      sayi: bordrosuz.length,
      adlar: args.calisanDetayi
        ? bordrosuz.map((e) => `${e.firstName} ${e.lastName}`.trim()).sort((a, b) => a.localeCompare(b, "tr"))
        : null,
    },
    calisanlar: args.calisanDetayi ? calisanlar : null,
  }
}
