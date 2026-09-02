/**
 * Taranan fişi ALIŞ FİŞİ gövdesine çevirir — saf, React'e ve Prisma'ya bağlı değil.
 *
 * NEDEN AYRI MODÜL: aynı dönüşüm iki yerde koşuyor. Onay ekranı kullanıcıya
 * "kaydedilecek tutar" göstermek için, kayıt ucu istemciden geleni doğrulamak
 * için. İkisi ayrı yazılsaydı ekranda görünen ile kaydedilen ayrışırdı.
 *
 * ANA FİKİR — ÇAPA "tutar"DIR: yazarkasa fişi KDV DAHİL basar, fatura ucu ise
 * KDV HARİÇ birim fiyat bekler. Modelin en güvenilir okuduğu alan satırın KDV
 * dahil toplamıdır (birim fiyat çoğu fişte hiç basılmaz). Bu yüzden net, birim
 * fiyattan ileri doğru DEĞİL, tutardan geri çözülür (solveNetFromTotal) —
 * böylece fişteki rakam ile faturaya yazılan rakam aynı kalır.
 *
 * KURUŞ FARKI YUTULMAZ: geri çözümden doğan artık `payableRoundingAmount`a
 * yazılır (KDV'ye girmez, yalnız ödenecek tutara eklenir — Invoice modelinde
 * tam bu iş için duruyor). Böylece kaydedilen toplam fişin genel toplamına
 * BİREBİR eşit olur; kuruşu aşan fark ise uyarı olarak döner, gömülmez.
 */

import { computeLineTax, solveNetFromTotal } from "@/lib/invoice/line-tax"
import { round2, type PaymentMethod } from "@/lib/satis/payment"
import type { Fis, FisOdemeSekli } from "./schema"

/**
 * Fişin ödeme şekli → uygulamanın tahsilat yöntemi.
 *
 * Record (Partial değil): `FisOdemeSekli` büyüdüğünde burası DERLENMEZ ve yeni
 * değer sessizce eşleşmesiz kalmaz. Yemek kartı SAĞLAYICISI fişten okunmuyor
 * (marka basılsa da güvenilir değil) — kullanıcı ekranda seçer.
 */
export const ODEME_YONTEMI: Record<FisOdemeSekli, PaymentMethod> = {
  NAKIT: "CASH",
  KREDI_KARTI: "CREDIT_CARD",
  YEMEK_KARTI: "MEAL_CARD",
  HAVALE: "BANK_TRANSFER",
}

export function fisOdemeToMethod(sekil: FisOdemeSekli | null | undefined): PaymentMethod | null {
  return sekil ? ODEME_YONTEMI[sekil] : null
}

export type FisFaturaKalemi = {
  productId?: string
  description: string
  unit: string
  quantity: number
  /** KDV HARİÇ birim fiyat — fatura ucunun beklediği biçim. */
  unitPrice: number
  vatRate: number
}

export type FisUyarisi = {
  anahtar: "oran" | "miktar" | "yuvarlama" | "negatif" | "toplam" | "kalem"
  mesaj: string
  /** Kullanıcı görmeden geçmemeli: ekran kaydı bunlarda kilitler. */
  agir?: boolean
}

export type FisFaturaGovdesi = {
  companyId: string
  type: "PURCHASE"
  invoiceType: "MANUAL"
  isReceipt: true
  /**
   * Tedarikçi OPSİYONELDİR (şemada da nullable, Hızlı Alış da böyle kesiyor).
   * Boşsa fiş kesilir ama hiçbir cari ekstresinde görünmez — ekran bunu söyler.
   */
  supplierId: string | null
  warehouseId?: string
  date: string
  currency: "TRY"
  notes: string
  items: FisFaturaKalemi[]
  payableRoundingAmount?: number
}

export type FisDonusumu = {
  body: FisFaturaGovdesi
  uyarilar: FisUyarisi[]
  /** Sunucunun yazacağı toplam. Ekranda "kaydedilecek tutar" olarak gösterilir. */
  beklenenToplam: number
}

export type DonusumSecenegi = {
  companyId: string
  supplierId: string | null
  warehouseId?: string | null
  /** Kalem adına göre eşleşen ürünler: ad (küçük harf) → productId. */
  urunEslesme?: Map<string, string>
  bugun?: Date
}

const sayi = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null

/**
 * Türkiye'de görülebilecek KDV oranları. Eskiler (8, 18) DAHİL: arşiv fişi
 * taranabiliyor ve oranı "geçersiz" sayıp 20'ye çekmek fişin KDV'sini bozardı.
 */
const OLASI_ORANLAR = [0, 1, 8, 10, 18, 20]

/**
 * Fişin baskın KDV oranı — oranı okunamayan satırlar buna düşer.
 *
 * TUTARA GÖRE ağırlıklı, satır SAYISINA göre değil: market fişinde bir sürü %1
 * gıda satırının yanında tek bir %20 deterjan satırı olabilir; oranı okunamayan
 * satırın hangi gruba ait olduğu sorusunun cevabı adette değil parada.
 */
export function baskinKdvOrani(fis: Fis): {
  oran: number
  kaynak: "kalem" | "toplam" | "varsayilan"
} {
  const agirlik = new Map<number, number>()
  for (const k of fis.kalemler) {
    const oran = sayi(k.kdvOrani)
    if (oran == null || oran < 0) continue
    const tutar = Math.abs(sayi(k.tutar) ?? 0)
    agirlik.set(oran, (agirlik.get(oran) ?? 0) + (tutar || 1))
  }
  if (agirlik.size > 0) {
    const [oran] = [...agirlik.entries()].sort((a, b) => b[1] - a[1])[0]
    return { oran, kaynak: "kalem" }
  }

  // Hiçbir satırda oran yoksa dip toplamdan geri türet: KDV / (toplam − KDV).
  const toplam = sayi(fis.genelToplam)
  const kdv = sayi(fis.kdvToplam)
  if (toplam != null && kdv != null && toplam - kdv > 0) {
    const ham = (kdv / (toplam - kdv)) * 100
    const yakin = OLASI_ORANLAR.find((o) => Math.abs(o - ham) < 0.6)
    if (yakin != null) return { oran: yakin, kaynak: "toplam" }
  }
  return { oran: 20, kaynak: "varsayilan" }
}

/** Yerel gün — `toISOString()` UTC'ye çevirip günü kaydırıyor. */
function toGunString(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * Fişi fatura gövdesine çevirir.
 *
 * Miktar Decimal(10,2) olarak saklanıyor; burada da 2 haneye yuvarlanır ki
 * ekranda görünen miktar ile veritabanına yazılan aynı olsun. Hassasiyet kaybı
 * birim fiyata taşınır (Decimal(15,6)) — satırın TOPLAMI korunur.
 */
export function fisToInvoiceBody(fis: Fis, secenek: DonusumSecenegi): FisDonusumu {
  const uyarilar: FisUyarisi[] = []
  const { oran: baskin, kaynak } = baskinKdvOrani(fis)

  let oransiz = 0
  let miktarsiz = 0
  let negatif = 0

  const items: FisFaturaKalemi[] = []
  for (const k of fis.kalemler) {
    const ad = (k.ad || "").trim() || "Mal/Hizmet"
    const tutar = sayi(k.tutar)
    // Tutarsız satır faturaya yazılamaz: net çözülemez ve 0 TL'lik satır
    // eklemek fişi kirletir. Sessizce atmıyoruz — ağır uyarı üretiyor.
    if (tutar == null || tutar === 0) {
      uyarilar.push({
        anahtar: "kalem",
        mesaj: `"${ad}" tutarsız okundu, faturaya alınmadı.`,
        agir: true,
      })
      continue
    }

    let oran = sayi(k.kdvOrani)
    if (oran == null || oran < 0) {
      oran = baskin
      oransiz++
    }

    const hamMiktar = sayi(k.miktar)
    let miktar = hamMiktar != null && hamMiktar > 0 ? round2(hamMiktar) : 0
    if (miktar <= 0) {
      // Departman satırı (restoran fişinde "IZGARA %10 *650,00") miktar basmaz.
      miktar = 1
      if (hamMiktar == null) miktarsiz++
    }
    if (tutar < 0) negatif++

    // Net'i TUTARDAN geri çöz. İskonto satırında tutar negatif; solveNetFromTotal
    // negatif hedefte null döner, bu yüzden işaret ayrılıp mutlak değerle
    // çözülüyor ve sonra geri veriliyor.
    const isaret = tutar < 0 ? -1 : 1
    const net = solveNetFromTotal(Math.abs(tutar), { vatRate: oran })
    if (net == null) {
      uyarilar.push({
        anahtar: "kalem",
        mesaj: `"${ad}" için net tutar çözülemedi, faturaya alınmadı.`,
        agir: true,
      })
      continue
    }

    const eslesen = secenek.urunEslesme?.get(ad.toLocaleLowerCase("tr"))
    items.push({
      ...(eslesen ? { productId: eslesen } : {}),
      description: ad,
      // Birim fişte basılmıyor (akaryakıtta LT, markette KG olabilir). Tahmin
      // etmiyoruz: yanlış birim stok miktarını sessizce bozar, ADET nötrdür.
      unit: "ADET",
      quantity: miktar,
      unitPrice: (isaret * net) / miktar,
      vatRate: oran,
    })
  }

  if (oransiz > 0) {
    const nereden =
      kaynak === "kalem"
        ? "fişteki baskın oran"
        : kaynak === "toplam"
          ? "dip toplamdan türetildi"
          : "varsayılan"
    uyarilar.push({
      anahtar: "oran",
      mesaj: `${oransiz} satırda KDV oranı okunamadı, %${baskin} uygulandı (${nereden}).`,
      // Oran hiçbir yerden türetilemediyse %20 bir TAHMİNDİR; kullanıcı görmeli.
      agir: kaynak === "varsayilan",
    })
  }
  if (miktarsiz > 0) {
    uyarilar.push({
      anahtar: "miktar",
      mesaj: `${miktarsiz} satırda miktar basılmamış, 1 kabul edildi.`,
    })
  }
  if (negatif > 0) {
    uyarilar.push({
      anahtar: "negatif",
      mesaj: `${negatif} satır negatif (iskonto/promosyon) olarak yazıldı.`,
    })
  }

  // Sunucunun kuracağı toplamı BİREBİR aynı sırayla kur: gross = miktar × birim,
  // toplam = Σ computeLineTax(net).total. Formülü burada tekrar yazmıyoruz;
  // aynı modülü çağırmak, kural değişince ikisinin birlikte değişmesini sağlıyor.
  const hesaplanan = items.reduce(
    (acc, it) => acc + computeLineTax(it.quantity * it.unitPrice, { vatRate: it.vatRate }).total,
    0
  )

  const genelToplam = sayi(fis.genelToplam)
  let yuvarlama = 0
  if (genelToplam == null) {
    uyarilar.push({
      anahtar: "toplam",
      mesaj: "Fişin genel toplamı okunamadı; kalemlerden hesaplanan tutar kaydedilecek.",
      agir: true,
    })
  } else {
    yuvarlama = round2(genelToplam - hesaplanan)
    if (Math.abs(yuvarlama) >= 0.5) {
      // Kuruş artığı değil GERÇEK sapma: kalemlerin toplamı fişin dip toplamını
      // tutmuyor (eksik ya da fazla okunan satır). Yuvarlamaya gömüp kaydetmek
      // farkı görünmez kılardı — kaydı kilitleyen uyarı üretiyoruz.
      uyarilar.push({
        anahtar: "yuvarlama",
        mesaj:
          `Kalemlerin toplamı ${round2(hesaplanan).toFixed(2)} TL, fişin genel toplamı ` +
          `${genelToplam.toFixed(2)} TL — ${Math.abs(yuvarlama).toFixed(2)} TL fark var. ` +
          "Kalemleri kontrol edin.",
        agir: true,
      })
    }
  }

  // Notta "Fotoğraftan tarandı (<model adı>)" ibaresi VARDI, kaldırıldı: hangi
  // modelin okuduğu bir üretim ayrıntısıdır ve kullanıcının belgesinde işi yok.
  // Kayıt tarihi kalıyor — fişin kendi tarihinden (Invoice.date) farklı olabilir,
  // yani "bu fiş sisteme ne zaman girildi" sorusunu yanıtlayan tek yer burası.
  const notSatirlari = [
    fis.fisNo ? `Fiş No: ${fis.fisNo}` : null,
    fis.saticiUnvan ? `Satıcı: ${fis.saticiUnvan}` : null,
    (secenek.bugun ?? new Date()).toLocaleDateString("tr-TR"),
  ].filter(Boolean)

  return {
    body: {
      companyId: secenek.companyId,
      type: "PURCHASE",
      invoiceType: "MANUAL",
      isReceipt: true,
      // Boş dize değil NULL: fatura ucu `supplierId || null` yapıyor ama gövdeyi
      // okuyan (ve doğrulayan) herkes için "seçilmedi" tek biçimde görünsün.
      supplierId: secenek.supplierId || null,
      ...(secenek.warehouseId ? { warehouseId: secenek.warehouseId } : {}),
      // Fişin kendi tarihi; okunamadıysa bugün. "YYYY-MM-DD" biçimi fatura
      // editörünün gönderdiğiyle aynı — saat eklemek gün kaymasına yol açıyor.
      date: (fis.tarih || "").slice(0, 10) || toGunString(secenek.bugun ?? new Date()),
      currency: "TRY",
      notes: notSatirlari.join("\n"),
      items,
      ...(yuvarlama !== 0 ? { payableRoundingAmount: yuvarlama } : {}),
    },
    uyarilar,
    beklenenToplam: round2(hesaplanan + yuvarlama),
  }
}
