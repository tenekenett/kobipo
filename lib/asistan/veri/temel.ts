/**
 * Asistanın veri katmanının ortak zemini: hangi belge sayılır, dönem nasıl
 * kesilir, Decimal nasıl sayıya iner.
 *
 * Tek dosyada duruyor çünkü hem sinyaller hem sohbet araçları aynı tanımı
 * kullanmak ZORUNDA. Ayrı yazılsalardı panel "3 aydır satış yok" derken model
 * aynı ürün için "geçen ay 2 adet satılmış" diyebilirdi — ve kullanıcının
 * asistana bir daha güvenmesi için hiçbir sebep kalmazdı.
 */

import { Prisma } from "@prisma/client"

/** Decimal | number | null → number. Prisma Decimal'i JSON'a giderken string olur. */
export const sayi = (v: unknown): number => {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

/**
 * SAYILMAYAN belge durumları.
 *
 * DİKKAT — burada satış/alış RAPORUNDAN bilerek AYRILIYORUZ. `lib/raporlar/
 * satis-alis.ts` durum süzgeci uygulamaz (dosyanın kendi başlığında yazıyor:
 * iptal ve dönüştürülmüş faturalar da toplama girer). Asistan bunu KOPYALAYAMAZ:
 *
 *   CANCELLED  → iptal edilmiş satış "satış" sayılırsa, tek satışı iptal edilmiş
 *                bir ürün "hareket görüyor" görünür ve ölü stok uyarısı hiç
 *                çıkmaz. Uyarının varlık sebebi ortadan kalkar.
 *   CONVERTED  → faturaya dönüşmüş fiş, dönüştüğü faturayla İKİ KEZ sayılır.
 *                Ciro olduğundan yüksek, marj olduğundan bozuk çıkar.
 *
 * Sonuç: asistanın ciro rakamı, satış raporu ekranının rakamından FARKLI
 * çıkabilir (iptal/dönüşmüş belgesi olan firmalarda çıkar). Bu bilinçli bir
 * fark; asistan rakam verirken hangi süzgeçle saydığını söylemek zorunda
 * (bkz. lib/asistan/prompt.ts). Ekranlar bir gün düzeltilirse burası da
 * onlarla birlikte sadeleşir.
 */
export const SAYILMAYAN_DURUMLAR = ["CANCELLED", "CONVERTED"]

/** Asistanın saydığı her belgede ortak olan durum süzgeci. */
export const gecerliBelge = () => ({ status: { notIn: SAYILMAYAN_DURUMLAR } })

/**
 * Satış ailesi (satış + satış iadesi). İade tutarları çağıranda EKSİ sayılır;
 * yön kuralının tek tanımı `lib/cari/invoice-direction.ts`.
 */
export const SATIS_AILESI = () => ({
  OR: [
    { type: "SALES" },
    { type: "RETURN", OR: [{ returnKind: null }, { returnKind: { not: "PURCHASE" } }] },
  ],
})

export const ALIS_AILESI = () => ({
  OR: [{ type: "PURCHASE" }, { type: "RETURN", returnKind: "PURCHASE" }],
})

/**
 * Mükellefin BUGÜNÜ (Europe/Istanbul), gün başına oturtulmuş UTC anı.
 *
 * `new Date()` kullanılamaz: Vercel UTC'de koşar, TSİ 02:00'de "bugün" bir
 * önceki gündür ve "90 gündür satılmadı" eşiği bir gün kayar. Rapor ekranlarının
 * dönem sınırı da UTC gün başıdır (`resolveReportDateFilter`), bu yüzden eksen
 * ikisinde de aynı: İstanbul takvim günü → o günün UTC 00:00'ı.
 */
export function bugunBasi(simdi: Date = new Date()): Date {
  const istanbulGun = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
  }).format(simdi)
  return new Date(`${istanbulGun}T00:00:00.000Z`)
}

/** N gün öncesinin gün başı — eşik sorgularının `gte` sınırı. */
export function gunOnce(n: number, simdi: Date = new Date()): Date {
  const t = bugunBasi(simdi)
  t.setUTCDate(t.getUTCDate() - n)
  return t
}

/** İki tarih arasındaki tam gün farkı (negatif olabilir: vadesi gelmemiş). */
export function gunFarki(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / 86_400_000)
}

/**
 * Dönem etiketi — modele ve ekrana AYNI metinle gider.
 * "1 Haz 2026 – 3 Eyl 2026" gibi; model kendi tarih aritmetiğini yapmasın diye.
 */
export function donemEtiketi(baslangic: Date, bitis: Date): string {
  const f = new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
  return `${f.format(baslangic)} – ${f.format(bitis)}`
}

/** Prisma ham SQL'inde firma sınırı — HER sorguda zorunlu. */
export const firmaSiniri = (companyId: string) => Prisma.sql`"companyId" = ${companyId}`
