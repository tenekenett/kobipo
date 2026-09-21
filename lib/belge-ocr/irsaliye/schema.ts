/**
 * İRSALİYE çıkarımı — şema ve prompt (plan §3.7). Kâğıt sevk irsaliyesi fotoğrafı
 * ve e-İrsaliye PDF'i aynı şemadan geçer; UBL DespatchAdvice `ubl.ts`ten gelir.
 */

export type IrsaliyeKalem = {
  ad: string
  saticiKodu: string | null
  miktar: number | null
  birim: string | null
}

export type IrsaliyeGuven = { satici: number; alici: number; tarih: number; kalemler: number }

export type Irsaliye = {
  saticiUnvan: string | null
  saticiVknTckn: string | null
  aliciUnvan: string | null
  aliciVknTckn: string | null
  irsaliyeNo: string | null
  ettn: string | null
  duzenlemeTarihi: string | null
  sevkTarihi: string | null
  tasiyici: string | null
  plaka: string | null
  sofor: string | null
  sevkAdresi: string | null
  /** İrsaliyede atıf yapılan fatura no (varsa) */
  faturaNoAtfi: string | null
  kalemler: IrsaliyeKalem[]
  guven: IrsaliyeGuven
}

export const IRSALIYE_SEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "saticiUnvan",
    "saticiVknTckn",
    "aliciUnvan",
    "aliciVknTckn",
    "irsaliyeNo",
    "ettn",
    "duzenlemeTarihi",
    "sevkTarihi",
    "tasiyici",
    "plaka",
    "sofor",
    "sevkAdresi",
    "faturaNoAtfi",
    "kalemler",
    "guven",
  ],
  properties: {
    saticiUnvan: { type: ["string", "null"] },
    saticiVknTckn: { type: ["string", "null"], description: "10 hane VKN veya 11 hane TCKN, yalnız rakam" },
    aliciUnvan: { type: ["string", "null"] },
    aliciVknTckn: { type: ["string", "null"], description: "10 hane VKN veya 11 hane TCKN, yalnız rakam" },
    irsaliyeNo: { type: ["string", "null"] },
    ettn: { type: ["string", "null"] },
    duzenlemeTarihi: { type: ["string", "null"], description: "YYYY-MM-DD" },
    sevkTarihi: { type: ["string", "null"], description: "YYYY-MM-DD; fiili sevk tarihi" },
    tasiyici: { type: ["string", "null"], description: "taşıyıcı firma / nakliyeci" },
    plaka: { type: ["string", "null"] },
    sofor: { type: ["string", "null"] },
    sevkAdresi: { type: ["string", "null"], description: "teslim adresi" },
    faturaNoAtfi: { type: ["string", "null"] },
    kalemler: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ad", "saticiKodu", "miktar", "birim"],
        properties: {
          ad: { type: "string" },
          saticiKodu: { type: ["string", "null"] },
          miktar: { type: ["number", "null"] },
          birim: { type: ["string", "null"] },
        },
      },
    },
    guven: {
      type: "object",
      additionalProperties: false,
      required: ["satici", "alici", "tarih", "kalemler"],
      properties: {
        satici: { type: "number" },
        alici: { type: "number" },
        tarih: { type: "number" },
        kalemler: { type: "number" },
      },
    },
  },
} as const

export const IRSALIYE_PROMPT = [
  "Sen Türk sevk irsaliyelerini (kâğıt irsaliye, e-İrsaliye) okuyan bir veri çıkarma aracısın.",
  "Girdi bir belgenin tüm sayfalarıdır; kalemler sayfalar arasında devam edebilir, hepsini",
  "tek listede topla.",
  "",
  "TARAFLAR: SATICI/GÖNDEREN belgeyi düzenleyen (üstte), ALICI 'SAYIN' bloğu. VKN'yi MERSIS",
  "ile KARIŞTIRMA. Okuyamadığın alana null yaz, TAHMİN ETME.",
  "",
  "KALEMLER: ad, satıcının stok kodu (varsa), miktar ve birim. İrsaliyede çoğu zaman fiyat",
  "YOKTUR; varsa da okuma, bu şemada yeri yok. Toplam/ara toplam satırlarını kalem sayma.",
  "",
  "TARİHLER: duzenlemeTarihi belgenin tarihi, sevkTarihi 'Fiili Sevk Tarihi' / 'Sevk Tarihi'.",
  "Yalnız biri yazıyorsa ötekini null bırak (kopyalama).",
  "",
  "TAŞIMA: taşıyıcı (nakliye firması), plaka, şoför adı; sevk/teslim adresi.",
  "faturaNoAtfi: irsaliyede 'Fatura No' alanı doluysa.",
  "",
  "Kurallar:",
  '- Sayılar: "1.234,5" -> 1234.5. Tarih YYYY-MM-DD.',
  "- Kalem adlarını belgedeki hâliyle bırak.",
  '- "guven": her grup için 0-1; okunaksızsa düşük ver.',
  "",
  "Yanıtın SADECE JSON olsun; açıklama veya markdown kod bloğu ekleme.",
].join("\n")

export const IRSALIYE_KOMUT = "Bu irsaliyeyi çıkar."
