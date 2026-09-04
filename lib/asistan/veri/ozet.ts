/**
 * Dönem özeti: ciro, alış, brüt kâr ve bir önceki dönemle karşılaştırma.
 *
 * Kâr-zarar raporu (`lib/raporlar/kar-zarar.ts`) yerine ayrı bir hesap var
 * çünkü sorulan soru farklı: o rapor muhasebe eksenli tam bir gelir tablosu
 * çıkarır (gider kalemleri, KDV, dönem sonu). Asistanın ihtiyacı ise "ciro
 * geçen aya göre ne yaptı" — TİCARİ brüt kâr. İkisini tek fonksiyona sıkıştırmak
 * ya raporu bozardı ya da asistanı yavaşlatırdı.
 *
 * DİKKAT: bu yüzden asistanın "brüt kâr" rakamı, Kâr-Zarar ekranının "net kâr"
 * rakamı DEĞİLDİR ve olmamalıdır. Model hangisini söylediğini yazmak zorunda.
 */

import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { avgCostCte } from "@/lib/stock/cost"
import { donemEtiketi, gunFarki, sayi } from "./temel"

export type DonemOzeti = {
  etiket: string
  baslangic: Date
  bitis: Date
  /** Net satış (satış − satış iadesi), KDV hariç. */
  ciro: number
  /** Net alış (alış − alış iadesi), KDV hariç. */
  alis: number
  /** Satılan malın AVCO maliyeti — maliyeti bilinen kalemler üzerinden. */
  satilanMaliyet: number
  /** ciro − satilanMaliyet. Maliyeti eksik ürün varsa OLDUĞUNDAN YÜKSEK çıkar. */
  brutKar: number
  marjYuzde: number | null
  faturaSayisi: number
  /** Ortalama fatura tutarı (net). */
  ortalamaFatura: number
  /** Maliyeti girilmemiş ürün içeren kalem sayısı — brüt kârın güven payı. */
  maliyetsizKalem: number
}

async function tekDonem(
  companyId: string,
  baslangic: Date,
  bitis: Date
): Promise<DonemOzeti> {
  const [satis, alis, kalem] = await Promise.all([
    // Satış ailesi: satış (+) ve satış iadesi (−) aynı toplama girer.
    prisma.$queryRaw<Array<{ net: unknown; adet: unknown }>>(Prisma.sql`
      SELECT
        SUM(CASE WHEN i.type = 'SALES' THEN i."netAmount" ELSE -i."netAmount" END) AS net,
        COUNT(*) FILTER (WHERE i.type = 'SALES') AS adet
      FROM invoices i
      WHERE i."companyId" = ${companyId}
        AND i.status NOT IN ('CANCELLED', 'CONVERTED')
        AND i.date >= ${baslangic}
        AND i.date < ${bitis}
        AND (
          i.type = 'SALES'
          OR (i.type = 'RETURN' AND (i."returnKind" IS NULL OR i."returnKind" <> 'PURCHASE'))
        )
    `),
    prisma.$queryRaw<Array<{ net: unknown }>>(Prisma.sql`
      SELECT SUM(CASE WHEN i.type = 'PURCHASE' THEN i."netAmount" ELSE -i."netAmount" END) AS net
      FROM invoices i
      WHERE i."companyId" = ${companyId}
        AND i.status NOT IN ('CANCELLED', 'CONVERTED')
        AND i.date >= ${baslangic}
        AND i.date < ${bitis}
        AND (
          i.type = 'PURCHASE'
          OR (i.type = 'RETURN' AND i."returnKind" = 'PURCHASE')
        )
    `),
    prisma.$queryRaw<Array<{ maliyet: unknown; maliyetsiz: unknown }>>(Prisma.sql`
      WITH ${avgCostCte(companyId)}
      SELECT
        SUM(CASE WHEN ac.unit_cost IS NOT NULL THEN ii.quantity * ac.unit_cost ELSE 0 END) AS maliyet,
        COUNT(*) FILTER (WHERE ac.unit_cost IS NULL) AS maliyetsiz
      FROM invoice_items ii
      JOIN invoices i ON i.id = ii."invoiceId"
      LEFT JOIN avg_cost ac ON ac.product_id = ii."productId"
      LEFT JOIN products p ON p.id = ii."productId"
      WHERE i."companyId" = ${companyId}
        AND i.type = 'SALES'
        AND i.status NOT IN ('CANCELLED', 'CONVERTED')
        AND i.date >= ${baslangic}
        AND i.date < ${bitis}
        AND ii."productId" IS NOT NULL
        AND COALESCE(p."isService", false) = false
    `),
  ])

  const ciro = sayi(satis[0]?.net)
  const faturaSayisi = sayi(satis[0]?.adet)
  const satilanMaliyet = sayi(kalem[0]?.maliyet)
  const brutKar = ciro - satilanMaliyet

  return {
    etiket: donemEtiketi(baslangic, bitis),
    baslangic,
    bitis,
    ciro,
    alis: sayi(alis[0]?.net),
    satilanMaliyet,
    brutKar,
    marjYuzde: ciro > 0 ? (brutKar / ciro) * 100 : null,
    faturaSayisi,
    ortalamaFatura: faturaSayisi > 0 ? ciro / faturaSayisi : 0,
    maliyetsizKalem: sayi(kalem[0]?.maliyetsiz),
  }
}

export type DonemKarsilastirma = {
  simdi: DonemOzeti
  onceki: DonemOzeti
  ciroDegisimYuzde: number | null
  karDegisimYuzde: number | null
}

/**
 * Dönemi ve HEMEN ÖNCESİNDEKİ eşit uzunluktaki dönemi birlikte döner.
 *
 * Karşılaştırma dönemi "geçen ay" değil, "aynı uzunlukta bir önceki aralık":
 * kullanıcı 12 günlük bir aralık seçtiyse onu 30 günlük bir ayla kıyaslamak
 * %60 düşüş uydurur. Uzunluk eşitliği tek şart.
 */
export async function donemKarsilastirma(
  companyId: string,
  baslangic: Date,
  bitis: Date
): Promise<DonemKarsilastirma> {
  const gun = Math.max(gunFarki(bitis, baslangic), 1)
  const oncekiBitis = new Date(baslangic)
  const oncekiBaslangic = new Date(baslangic)
  oncekiBaslangic.setUTCDate(oncekiBaslangic.getUTCDate() - gun)

  const [simdi, onceki] = await Promise.all([
    tekDonem(companyId, baslangic, bitis),
    tekDonem(companyId, oncekiBaslangic, oncekiBitis),
  ])

  // Sıfırdan yükselişin yüzdesi tanımsızdır (∞). null dönüp "önceki dönemde
  // satış yoktu" dedirtmek, ekranda "%∞ artış" basmaktan iyi.
  const oran = (yeni: number, eski: number) =>
    eski === 0 ? null : ((yeni - eski) / Math.abs(eski)) * 100

  return {
    simdi,
    onceki,
    ciroDegisimYuzde: oran(simdi.ciro, onceki.ciro),
    karDegisimYuzde: oran(simdi.brutKar, onceki.brutKar),
  }
}

export { tekDonem as donemOzeti }
