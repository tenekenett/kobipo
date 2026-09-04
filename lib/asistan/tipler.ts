/**
 * Asistanın ortak tipleri. İstemci de okuyor (uyarı kartları), bu yüzden burada
 * Prisma'ya HİÇ dokunulmaz — `lib/fis-ocr/models.ts`teki ayrımın aynısı: veri
 * katmanından tip çeken bir istemci bileşeni Prisma'yı tarayıcı paketine
 * sürükler ve derleme patlar.
 */

/** Uyarının aciliyeti. Kart rengi ve modele verilen sıralama bundan türer. */
export type SinyalOnem = "kritik" | "uyari" | "bilgi"

/**
 * Tek bir bulgu satırı — "TOSHIBA klima, 118 gündür satılmadı, ₺42.800 bağlı".
 *
 * `deger` EKRANA BASILACAK metindir, `sayi` ise sıralama/eşik içindir. İkisi
 * ayrı çünkü biçimlendirmeyi modele bırakmak istemiyoruz: "42800" gördüğünde
 * "42,8 bin" diye yuvarlayıp yazıyor ve kullanıcı raporla karşılaştırınca
 * tutmuyor sanıyor.
 */
export type SinyalSatiri = {
  baslik: string
  detay: string
  /** Sıralama ve eşik ölçüsü (TL, gün, adet — sinyale göre değişir). */
  sayi: number
  /** Panel içi hedef. `withCompanyHref` ile firma param'ı EKLENEREK basılır. */
  href?: string
}

export type Sinyal = {
  anahtar: string
  baslik: string
  onem: SinyalOnem
  /** Bulgunun tek cümlelik özeti — kart başlığının altında ve prompt'ta aynen geçer. */
  ozet: string
  satirlar: SinyalSatiri[]
  /** Kaç satır bulundu (satirlar kırpılmış olabilir). */
  toplam: number
}

/**
 * Sinyalin çalışabilmesi için gereken menü sayfası ve modül.
 *
 * İkisi de ŞART: modül kapalıysa firma o veriyi hiç kullanmıyordur (ürünü yok,
 * "ölü stok" uyarısı gürültüdür); sayfa kapalıysa kullanıcının o veriyi görme
 * yetkisi yoktur. İkincisi güvenlik meselesi — kısıtlı çalışan, panelde
 * göremediği kâr rakamını asistana sorarak öğrenememeli.
 */
export type SinyalKapisi = {
  modul?: string
  sayfa?: string
}

export type AsistanBrifing = {
  firmaAdi: string
  bugun: string
  sinyaller: Sinyal[]
  /** Modelin göremediği alanlar — "bunu bilmiyorum" diyebilmesi için. */
  kapaliAlanlar: string[]
}

export type SohbetMesaji = {
  rol: "kullanici" | "asistan"
  metin: string
}

/** Ölçüm ekranının ve maliyet takibinin okuduğu kullanım özeti. */
export type SohbetKullanim = {
  girdiToken: number
  ciktiToken: number
  maliyetUsd: number | null
  /** Modelin kaç tur araç çağırdığı — ölçümde "az soruyla çok bilgi" göstergesi. */
  aracTuru: number
  sureMs: number
}
