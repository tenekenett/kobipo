/**
 * DEKONT çıkarımı — banka dekontu, havale/EFT/FAST makbuzu, hesap hareketi.
 * Kayıt hedefi TEK kasa/banka hareketidir (`/api/finans/transactions`): tutar
 * seçilen açık faturalara dağıtılır, artan cariye AVANS kalır (C1 kararı,
 * 2026-09-21). Bkz. `to-payment.ts`.
 */

export type Dekont = {
  banka: string | null
  islemTarihi: string | null
  tutar: number | null
  paraBirimi: string | null
  gonderenAd: string | null
  gonderenIban: string | null
  aliciAd: string | null
  aliciIban: string | null
  aciklama: string | null
  referansNo: string | null
  /** HAVALE, EFT, FAST, SWIFT, POS, DIGER — kodda kümeye zorlanır */
  islemTuru: string | null
  guven: { taraflar: number; tarih: number; tutar: number }
}

export const DEKONT_SEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "banka",
    "islemTarihi",
    "tutar",
    "paraBirimi",
    "gonderenAd",
    "gonderenIban",
    "aliciAd",
    "aliciIban",
    "aciklama",
    "referansNo",
    "islemTuru",
    "guven",
  ],
  properties: {
    banka: { type: ["string", "null"] },
    islemTarihi: { type: ["string", "null"], description: "YYYY-MM-DD" },
    tutar: { type: ["number", "null"] },
    paraBirimi: { type: ["string", "null"] },
    gonderenAd: { type: ["string", "null"], description: "parayı gönderen hesabın sahibi" },
    gonderenIban: { type: ["string", "null"], description: "TR ile başlayan 26 karakter, boşluksuz" },
    aliciAd: { type: ["string", "null"], description: "parayı alan hesabın sahibi" },
    aliciIban: { type: ["string", "null"], description: "TR ile başlayan 26 karakter, boşluksuz" },
    aciklama: { type: ["string", "null"], description: "işlem açıklaması (fatura no burada olabilir)" },
    referansNo: { type: ["string", "null"], description: "işlem / referans / fiş no" },
    islemTuru: { type: ["string", "null"], description: "HAVALE, EFT, FAST, SWIFT, POS veya DIGER" },
    guven: {
      type: "object",
      additionalProperties: false,
      required: ["taraflar", "tarih", "tutar"],
      properties: { taraflar: { type: "number" }, tarih: { type: "number" }, tutar: { type: "number" } },
    },
  },
} as const

export const DEKONT_PROMPT = [
  "Sen Türk banka dekontlarını (havale/EFT/FAST makbuzu, hesap hareketi çıktısı, POS slip)",
  "okuyan bir veri çıkarma aracısın.",
  "",
  "- gonderen = parayı YOLLAYAN hesabın sahibi ve IBAN'ı; alici = parayı ALAN hesabın sahibi",
  "  ve IBAN'ı. 'Gönderen', 'Alıcı', 'Lehtar', 'Karşı Hesap' etiketlerine bak. Hangi taraf",
  "  bankanın kendi müşterisi olursa olsun rolü değiştirme.",
  "- IBAN'ı boşluksuz ve büyük harf yaz (TR + 24 hane). Okuyamadıysan null.",
  "- tutar işlem tutarıdır; masraf/komisyon satırlarını tutara EKLEME.",
  "- islemTuru şu kümeden: HAVALE, EFT, FAST, SWIFT, POS, DIGER.",
  "- aciklama alanına işlem açıklamasını olduğu gibi yaz (fatura numarası çoğu zaman burada).",
  '- Tarih YYYY-MM-DD, saat ekleme. Tutarlar sayı: "1.234,56" -> 1234.56.',
  '- "guven": 0-1; okunaksızsa düşük ver.',
  "",
  "Yanıtın SADECE JSON olsun; açıklama veya markdown kod bloğu ekleme.",
].join("\n")

export const DEKONT_KOMUT = "Bu dekontu çıkar."

export const DEKONT_ISLEM_TURLERI = ["HAVALE", "EFT", "FAST", "SWIFT", "POS", "DIGER"] as const
