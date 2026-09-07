/**
 * K-BLG-09 · "Fatura panelde GÖNDERİLDİ görünüyor ama entegratörde hata almış."
 *
 * ── Ürünün en pahalı sessiz hatası ──────────────────────────────────────────
 * `Invoice.status = 'SENT'` kullanıcı için "bu iş bitti" demek: belge listede
 * yeşil, cariye işlendi, rapora girdi. `integrationStatus` ise entegratörün o
 * belge hakkında en son söylediği şey. İkisi AYRIŞABİLİYOR — ve ayrıştığında
 * kimse görmüyor:
 *
 *   SENT + ERROR:Bozuk UUID kaydedilmiş → belge GİB'e HİÇ ulaşmadı
 *   SENT + REJECTED:HATA                → entegratör reddetti
 *   SENT + ERROR:Giden fatura kaydı bulunamadı
 *
 * Sonucu bir "kayıt boşluğu" değil: satış yapılmış, para istenmiş, cari
 * borçlandırılmış ama ORTADA RESMÎ BELGE YOK. Fark genelde aylar sonra, ya
 * müşteri "faturam gelmedi" diye arayınca ya da beyan döneminde çıkıyor.
 *
 * ── Kart neden HER ZAMAN haklı ──────────────────────────────────────────────
 * Kartların çoğu bir eşiğe ya da türetmeye dayanıyor; bu kart hiçbirine
 * dayanmıyor. Söylediği tek şey, entegratörün KENDİ yazdığı durumu kullanıcıya
 * göstermek. Yanlış pozitif üretmesi için entegratörün yalan söylemesi gerekir.
 *
 * ── Ölçüm (2026-09-07, canlı) ──────────────────────────────────────────────
 * 6 belge bu durumda ve hepsi tek firmada (Reypo): dördü mock modda kalmış
 * bozuk UUID, ikisi gerçek Mysoft hatası (`REJECTED:HATA`,
 * `ERROR:Giden fatura kaydı bulunamadı`). Sayı düşük olduğu için kart bugün
 * neredeyse sessiz — AMA bu, kartın yazılmama sebebi değil yazılma sebebi:
 * ateşlediği gün söylediği şey geri alınamaz bir eksiklik oluyor ve bugün
 * kullanıcıya bunu söyleyen HİÇBİR ekran yok.
 *
 * `PROCESSING:*` durumları (GIBE_GONDERILDI, YANIT_BEKLENIYOR, GIBE_GONDERILECEK)
 * karta GİRMEZ: onlar yolda olan belgelerdir, hata değil. Ölçümde 90 belge bu
 * durumda; bunları "sorunlu" saymak kartı ilk gün gürültüye çevirirdi.
 */

import { prisma } from "@/lib/db/prisma"
import { sayi } from "@/lib/asistan/veri/temel"

/** Kartta adı geçecek belge sayısı. */
export const ORNEK_BELGE_SAYISI = 3

/**
 * Hata sayılan entegratör durumları — ön ek eşleşmesi.
 *
 * Mysoft durumu `DURUM:açıklama` biçiminde yazıyor (`ERROR:Bozuk UUID…`).
 * Ön eke bakmak, açıklama metni değiştiğinde kartın kör kalmamasını sağlıyor;
 * tam eşitlik yazsaydık her yeni hata mesajı sessizce süzgecin dışında kalırdı.
 */
export const HATA_ONEKLERI = ["ERROR", "REJECTED", "FAILED"] as const

/** Sorgudan gelen ham belge — saf özetin girdisi. */
export type HamBelge = {
  id: string
  slug: string | null
  invoiceNo: string
  date: Date
  totalAmount: unknown
  currency: string | null
  integrationStatus: string | null
  eDocumentNo: string | null
  customer: { name: string } | null
}

export type GonderilemeyenFatura = {
  id: string
  slug: string | null
  /**
   * LİSTEDE GÖRÜNEN numara: `eDocumentNo` varsa o, yoksa iç fatura numarası.
   *
   * Kural `lib/faturalar/list-query.ts`ten kopyalanmadı, oradan ALINDI (aynı
   * satır: `invoiceNo: r.eDocumentNo || r.invoiceNo`). Tarayıcı denetiminde
   * yakalandı: kart "SAT-2026-0185" diyordu, liste aynı belgeyi
   * "ADM2026000000012" diye gösteriyordu — kullanıcı kartın işaret ettiği satırı
   * bulamıyordu.
   */
  no: string
  /** İç numara — günlükte iz sürmek için ayrıca taşınır. */
  icNo: string
  musteri: string | null
  gun: number
  tutar: number
  /** Entegratörün yazdığı durum — kısaltılmadan günlüğe, kısaltılarak karta. */
  durum: string
  /** Resmî belge numarası alınabilmiş mi? Alınamamışsa belge GİB'e hiç ulaşmamış. */
  belgeNoVar: boolean
}

export type GonderilemeyenOzeti = {
  adet: number
  toplamTutar: number
  belgesizAdet: number
  /** En eski belgenin yaşı — aksiyon linkinin penceresi bundan türer. */
  enEskiGun: number
  ornekler: GonderilemeyenFatura[]
}

export async function gonderilemeyenOzeti(
  companyId: string
): Promise<GonderilemeyenOzeti | null> {
  const kayitlar = await prisma.invoice.findMany({
    where: {
      companyId,
      type: "SALES",
      // Kullanıcıya "gitti" diyen durum bu; DRAFT'ta hata zaten ekranda görünür.
      status: "SENT",
      invoiceType: { in: ["E_INVOICE", "E_ARCHIVE"] },
      OR: HATA_ONEKLERI.map((onek) => ({ integrationStatus: { startsWith: onek } })),
    },
    select: {
      id: true,
      slug: true,
      invoiceNo: true,
      date: true,
      totalAmount: true,
      currency: true,
      integrationStatus: true,
      eDocumentNo: true,
      customer: { select: { name: true } },
    },
    orderBy: { date: "asc" },
  })

  if (kayitlar.length === 0) return null
  return gonderilemeyenSec(kayitlar)
}

/**
 * ÖZET — saf fonksiyon, veritabanı bilmez.
 *
 * Buradaki tek karar tarayıcı denetiminde doğdu: kart, kullanıcının listede
 * GÖRDÜĞÜ numarayı yazmalı (`eDocumentNo || invoiceNo`). Kural bozulursa hiçbir
 * sorgu hata vermez; kart "SAT-2026-0185" der, liste "ADM2026000000012" gösterir
 * ve kullanıcı işaret edilen satırı bulamaz.
 */
export function gonderilemeyenSec(
  kayitlar: HamBelge[],
  simdiTarih: Date = new Date()
): GonderilemeyenOzeti | null {
  if (kayitlar.length === 0) return null

  const gunMs = 86_400_000
  const simdi = simdiTarih.getTime()

  const satirlar: GonderilemeyenFatura[] = kayitlar.map((f) => ({
    id: f.id,
    slug: f.slug || null,
    no: f.eDocumentNo || f.invoiceNo,
    icNo: f.invoiceNo,
    musteri: f.customer?.name ?? null,
    gun: Math.floor((simdi - f.date.getTime()) / gunMs),
    // Tutar yalnız TRY'den toplanacağı için para birimi burada işaretlenmiyor;
    // toplam aşağıda süzülüyor (K-BLG-01 ile aynı kural).
    tutar: (f.currency ?? "TRY") === "TRY" ? sayi(f.totalAmount) : 0,
    durum: f.integrationStatus ?? "",
    belgeNoVar: Boolean(f.eDocumentNo),
  }))

  return {
    adet: satirlar.length,
    toplamTutar: satirlar.reduce((t, f) => t + f.tutar, 0),
    belgesizAdet: satirlar.filter((f) => !f.belgeNoVar).length,
    enEskiGun: Math.max(...satirlar.map((f) => f.gun)),
    // En eski önce: en uzun süredir "gönderildi" sanılan belge en acili.
    ornekler: satirlar.slice(0, ORNEK_BELGE_SAYISI),
  }
}

/**
 * Entegratör durumunu karta yazılabilir tek satıra indirger.
 *
 * Mysoft bazı hataları şematron çıktısıyla birlikte döndürüyor ve o metin
 * ekranlarca sürüyor; kartın gerekçesi okunamaz hâle gelirdi. Kod kısmı
 * (`ERROR`) ve ilk cümle yeterli — tamamı `olcum` içinde günlüğe yazılıyor.
 */
export function durumOzeti(durum: string, uzunluk = 70): string {
  const tekSatir = durum.replace(/\s+/g, " ").trim()
  return tekSatir.length > uzunluk ? `${tekSatir.slice(0, uzunluk)}…` : tekSatir
}
