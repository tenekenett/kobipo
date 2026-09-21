/**
 * ÇEK / SENET çıkarımı — tek şema, `tur` ayırır. Kayıt hedefi `/api/cek-senet`
 * (`type: CHECK | PROMISSORY_NOTE`, `direction: RECEIVED | GIVEN`).
 *
 * Yön: keşideci (çeki yazan, ödeyecek olan) BİZSEK verilen çek (GIVEN, tedarikçi
 * carisi), lehtar bizsek alınan çek (RECEIVED, müşteri carisi). Karar kodda
 * (sinif/normalize.ts yön kuralıyla aynı: duzenleyen = keşideci).
 */

export type CekSenet = {
  /** CEK | SENET — kodda kümeye zorlanır */
  tur: string
  banka: string | null
  sube: string | null
  hesapNo: string | null
  /** Çek seri/no ya da senet no */
  seriNo: string | null
  tutar: number | null
  paraBirimi: string | null
  /** Keşide (düzenleme) tarihi */
  kesideTarihi: string | null
  /** Vade / ödeme tarihi */
  vadeTarihi: string | null
  kesideci: string | null
  kesideciVknTckn: string | null
  lehtar: string | null
  lehtarVknTckn: string | null
  kesideYeri: string | null
  guven: { taraflar: number; tarih: number; tutar: number }
}

export const CEK_SEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "tur",
    "banka",
    "sube",
    "hesapNo",
    "seriNo",
    "tutar",
    "paraBirimi",
    "kesideTarihi",
    "vadeTarihi",
    "kesideci",
    "kesideciVknTckn",
    "lehtar",
    "lehtarVknTckn",
    "kesideYeri",
    "guven",
  ],
  properties: {
    tur: { type: "string", description: "CEK veya SENET" },
    banka: { type: ["string", "null"] },
    sube: { type: ["string", "null"] },
    hesapNo: { type: ["string", "null"] },
    seriNo: { type: ["string", "null"], description: "çek seri numarası / senet no" },
    tutar: { type: ["number", "null"] },
    paraBirimi: { type: ["string", "null"] },
    kesideTarihi: { type: ["string", "null"], description: "YYYY-MM-DD" },
    vadeTarihi: { type: ["string", "null"], description: "YYYY-MM-DD" },
    kesideci: { type: ["string", "null"], description: "çeki/senedi düzenleyen, ödeyecek taraf" },
    kesideciVknTckn: { type: ["string", "null"], description: "yalnız rakam" },
    lehtar: { type: ["string", "null"], description: "alacaklı; 'emrine' yazan taraf" },
    lehtarVknTckn: { type: ["string", "null"], description: "yalnız rakam" },
    kesideYeri: { type: ["string", "null"] },
    guven: {
      type: "object",
      additionalProperties: false,
      required: ["taraflar", "tarih", "tutar"],
      properties: { taraflar: { type: "number" }, tarih: { type: "number" }, tutar: { type: "number" } },
    },
  },
} as const

export const CEK_PROMPT = [
  "Sen Türk banka çeklerini ve bonolarını (emre muharrer senet) okuyan bir veri çıkarma aracısın.",
  "",
  "- tur: banka çeki ise CEK, bono/senet ise SENET.",
  "- kesideci: çeki yazan/imzalayan, hesabın sahibi, ödeyecek olan taraf (çekte alt kısımdaki",
  "  hesap sahibi ünvanı; senette 'borçlu'). lehtar: '... emrine' yazan alacaklı taraf.",
  "- seriNo: çek seri numarası (çekin üstünde/altındaki uzun numara; MICR satırından da",
  "  okunabilir); senette senet no.",
  "- tutar: rakamla yazılan tutar; yazıyla yazılanla ÇELİŞİYORSA rakamı yaz ama guven.tutar'ı düşür.",
  "- kesideTarihi: düzenleme tarihi; vadeTarihi: ödeme/vade tarihi. Çekte yalnız bir tarih",
  "  varsa onu vade say ve kesideTarihi'ni null bırak.",
  '- VKN/TCKN yalnız rakam. Tarih YYYY-MM-DD. Tutarlar sayı: "1.234,56" -> 1234.56.',
  "- Okuyamadığın alana null yaz, TAHMİN ETME. guven 0-1.",
  "",
  "Yanıtın SADECE JSON olsun; açıklama veya markdown kod bloğu ekleme.",
].join("\n")

export const CEK_KOMUT = "Bu çeki/senedi çıkar."
