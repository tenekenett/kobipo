/**
 * KASA/BANKA HAREKETİNİN TÜRÜ — `Transaction.purpose`. Saf modül (istemci de okur).
 *
 * Bugüne kadar faturasız her para çıkışı "gider", her girişi "gelir" sayılıyordu. Oysa
 * bazı hareketler gelir/gider değildir ya da başka bir yerde zaten gider yazılmış bir
 * borcu kapatır (2026-10-09, muhasebe eksik turu B1/B2/B5):
 *
 *   tür      yön       muhasebe karşılığı          kâr/zarar (nakit esaslı raporlar)
 *   ──────── ───────── ─────────────────────────── ───────────────────────────────────
 *   (yok)    ikisi     649 gelir / 770 gider        gelir / gider (bugünkü gibi)
 *   KDV      çıkış     B 360 (ödenecek KDV)         SAYILMAZ — KDV işletmenin gideri değil
 *   TAX      çıkış     B 360 (ödenecek vergi)       gider (muhtasar maaşın parçası)
 *   SGK      çıkış     B 361 (ödenecek SGK)         gider (prim maaşın parçası)
 *   ADVANCE  ikisi     196 personel avansı          gider/gelir (maaşın peşin parçası)
 *   LOAN     ikisi     300 banka kredisi            SAYILMAZ — anapara borçtur
 *   PARTNER  ikisi     331 ortaklara borç / 131      SAYILMAZ — ortağın parası
 *
 * Muhasebede vergi/SGK ödemesi GİDER YAZILMAZ: gideri bordro tahakkuku (770) ve KDV
 * mahsubu zaten yazdı; ödeme yalnız borcu (360/361) kapatır. Eskiden 770'e düşüyor,
 * gider iki kez sayılıyor ve 360/361 hiç kapanmıyordu.
 *
 * Kâr/zarar nakit esaslı kaldığı için vergi/SGK/avans orada gider olarak SAYILMAYA
 * DEVAM EDER (bordronun yalnız neti ödeme olarak görünür; kesintiler ancak ödenince).
 * KDV, kredi ve ortak ise hiçbir esasta gelir/gider değildir.
 *
 * Cari bağı: türlü hareket bir müşteriye/tedarikçiye bağlanamaz (cari bakiyesine girerse
 * altı yerde ayrıca ele alınması gerekirdi); fatura ödemesi de olamaz.
 */

export const HAREKET_TURLERI = ["KDV", "TAX", "SGK", "ADVANCE", "LOAN", "PARTNER"] as const
export type HareketTuru = (typeof HAREKET_TURLERI)[number]

export function hareketTuruMu(v: unknown): v is HareketTuru {
  return typeof v === "string" && (HAREKET_TURLERI as readonly string[]).includes(v)
}

type Yon = "INCOME" | "EXPENSE"

export const HAREKET_TURU_BILGISI: Record<
  HareketTuru,
  {
    /** Seçicide görünen ad. */
    ad: string
    /** Seçicinin altındaki kısa açıklama. */
    aciklama: string
    /** Hangi yönde seçilebilir. */
    yonler: readonly Yon[]
    /** Yön başına ad (kredi kullanımı / kredi ödemesi …). */
    yonAdi?: Partial<Record<Yon, string>>
  }
> = {
  KDV: {
    ad: "KDV ödemesi",
    aciklama: "KDV beyannamesiyle vergi dairesine ödenen KDV. Gider sayılmaz.",
    yonler: ["EXPENSE"],
  },
  TAX: {
    ad: "Vergi ödemesi",
    aciklama: "Muhtasar (stopaj), damga, geçici/kurumlar vergisi, MTV… Muhasebede vergi borcunu kapatır.",
    yonler: ["EXPENSE"],
  },
  SGK: {
    ad: "SGK prim ödemesi",
    aciklama: "Bordrolardaki SGK primlerinin ödenmesi. Muhasebede SGK borcunu kapatır.",
    yonler: ["EXPENSE"],
  },
  ADVANCE: {
    ad: "Personel avansı",
    aciklama: "Maaştan önce verilen avans; bordroda 'Avans' olarak düşülür. Çalışan seçilmeli.",
    yonler: ["EXPENSE", "INCOME"],
    yonAdi: { EXPENSE: "Personel avansı verildi", INCOME: "Personel avansı geri alındı" },
  },
  LOAN: {
    ad: "Kredi",
    aciklama: "Bankadan kredi kullanımı ya da kredinin anapara ödemesi. Faizi ayrıca gider olarak girin.",
    yonler: ["INCOME", "EXPENSE"],
    yonAdi: { INCOME: "Kredi kullanımı", EXPENSE: "Kredi anapara ödemesi" },
  },
  PARTNER: {
    ad: "Ortak / işletme sahibi",
    aciklama: "Ortağın işletmeye koyduğu ya da işletmeden çektiği para. Gelir/gider sayılmaz.",
    yonler: ["INCOME", "EXPENSE"],
    yonAdi: { INCOME: "Ortaktan gelen para", EXPENSE: "Ortağa ödenen / çekilen para" },
  },
}

/** Kâr/zarar, gelir-gider, harcamalar ve finansal özette GELİR/GİDER SAYILMAYAN türler. */
export const KARA_GIRMEYEN_TURLER: readonly HareketTuru[] = ["KDV", "LOAN", "PARTNER"]

/** Prisma `where` parçası: kâra girmeyen türleri dışlar (NULL tür = olağan hareket, kalır). */
export const KARA_GIREN_TUR_WHERE = {
  OR: [{ purpose: null }, { purpose: { notIn: [...KARA_GIRMEYEN_TURLER] } }],
}

/** Ham SQL karşılığı (tablo takma adıyla): `(t.purpose IS NULL OR t.purpose NOT IN (...))`. */
export const KARA_GIREN_TUR_SQL = (alias: string) =>
  `(${alias}."purpose" IS NULL OR ${alias}."purpose" NOT IN (${KARA_GIRMEYEN_TURLER.map((t) => `'${t}'`).join(", ")}))`

/** Hareketin ekranda görünen türü ("Kredi kullanımı", "SGK prim ödemesi"…); türsüzse null. */
export function hareketTuruAdi(purpose: string | null | undefined, tip: string): string | null {
  if (!hareketTuruMu(purpose)) return null
  const b = HAREKET_TURU_BILGISI[purpose]
  return b.yonAdi?.[tip as Yon] ?? b.ad
}

/**
 * Yazma kuralı — form ve uç aynı fonksiyondan geçer. Döner: hata metni ya da null.
 * `purpose` boş = olağan hareket.
 */
export function hareketTuruHatasi(g: {
  purpose: string | null
  tip: string
  employeeId: string | null
  cariBagli: boolean
  faturaBagli: boolean
}): string | null {
  if (!g.purpose) return g.employeeId ? "Çalışan yalnız personel avansında seçilir." : null
  if (!hareketTuruMu(g.purpose)) return "Geçersiz hareket türü."
  const b = HAREKET_TURU_BILGISI[g.purpose]
  if (!b.yonler.includes(g.tip as Yon)) {
    return `${b.ad} ${g.tip === "INCOME" ? "para girişi" : "para çıkışı"} olarak girilemez.`
  }
  if (g.cariBagli || g.faturaBagli) return `${b.ad} bir müşteriye, tedarikçiye ya da faturaya bağlanamaz.`
  if (g.purpose === "ADVANCE" && !g.employeeId) return "Personel avansı için çalışanı seçin."
  if (g.purpose !== "ADVANCE" && g.employeeId) return "Çalışan yalnız personel avansında seçilir."
  return null
}
