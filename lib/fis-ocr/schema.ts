/**
 * Fiş görselinden veri çıkarma — şema ve prompt.
 *
 * Bu dosya, `scripts/ai-fis-test.mjs` içindeki şema/prompt'un uygulama tarafındaki
 * İKİZİDİR. Tezgâh bilerek uygulamadan bağımsız (Prisma/Next import etmez, sağlayıcı
 * kararı verilmeden koşabilsin diye) ve TypeScript modülünü node'a doğrudan
 * import edemiyor. Bedeli: prompt iki yerde yaşıyor.
 *
 * BİRİNİ DEĞİŞTİREN ÖTEKİNİ DE DEĞİŞTİRMELİ — yoksa ölçtüğün prompt ile üretimde
 * koşan prompt ayrışır ve tezgâhın sayıları yalan söylemeye başlar.
 */

export type FisKalem = {
  ad: string
  miktar: number | null
  birimFiyat: number | null
  kdvOrani: number | null
  tutar: number | null
}

/**
 * Fişin ödeme satırı — TOPLAM'ın altında basılır ("NAKİT", "KREDİ",
 * "K.KARTI/B.KARTI", yemek kartı markası). Kayıt akışında tahsilatın hangi
 * kanala (kasa / POS / banka) yazılacağını bu belirliyor; okunamadığında
 * kullanıcı ekranda seçer, TAHMİN EDİLMEZ.
 *
 * Değerler uygulamanın kendi ödeme kümesine birebir çevrilir (fisOdemeToMethod,
 * lib/fis-ocr/to-invoice.ts) — küme burada büyürse orası derlenmez.
 */
export type FisOdemeSekli = "NAKIT" | "KREDI_KARTI" | "YEMEK_KARTI" | "HAVALE"

export type FisOdeme = {
  sekil: FisOdemeSekli | null
  /** Fişte ödeme satırının yanında yazan tutar; çoğu fişte genel toplama eşit. */
  tutar: number | null
}

export type FisGuven = {
  satici: number
  tarih: number
  toplam: number
  kalemler: number
}

export type Fis = {
  saticiUnvan: string | null
  vknTckn: string | null
  tarih: string | null
  fisNo: string | null
  kalemler: FisKalem[]
  araToplam: number | null
  kdvToplam: number | null
  genelToplam: number | null
  odeme: FisOdeme | null
  guven: FisGuven | null
}

const FIS_SEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "saticiUnvan",
    "vknTckn",
    "tarih",
    "fisNo",
    "kalemler",
    "araToplam",
    "kdvToplam",
    "genelToplam",
    "odeme",
    "guven",
  ],
  properties: {
    saticiUnvan: { type: ["string", "null"] },
    vknTckn: {
      type: ["string", "null"],
      description: "10 hane VKN veya 11 hane TCKN, yalnız rakam",
    },
    tarih: { type: ["string", "null"], description: "YYYY-MM-DD" },
    fisNo: { type: ["string", "null"] },
    kalemler: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ad", "miktar", "birimFiyat", "kdvOrani", "tutar"],
        properties: {
          ad: { type: "string" },
          miktar: { type: ["number", "null"] },
          birimFiyat: { type: ["number", "null"] },
          kdvOrani: { type: ["number", "null"], description: "1, 10 veya 20" },
          tutar: { type: ["number", "null"], description: "KDV dahil satır toplamı" },
        },
      },
    },
    araToplam: { type: ["number", "null"] },
    kdvToplam: { type: ["number", "null"] },
    genelToplam: { type: ["number", "null"] },
    // Nesne NULLABLE DEĞİL, içindeki alanlar nullable: strict json_schema'da
    // nullable nesne sağlayıcıdan sağlayıcıya farklı karşılanıyor, "her zaman
    // nesne dön, bilmiyorsan içini null bırak" her yerde aynı davranıyor.
    // `sekil` enum DEĞİL: strict modda enum + null bileşimi bazı sağlayıcılarda
    // reddediliyor; küme denetimi kodda (bkz. normalizeOdeme, extract.ts).
    odeme: {
      type: "object",
      additionalProperties: false,
      required: ["sekil", "tutar"],
      properties: {
        sekil: {
          type: ["string", "null"],
          description: "NAKIT, KREDI_KARTI, YEMEK_KARTI veya HAVALE",
        },
        tutar: { type: ["number", "null"] },
      },
    },
    guven: {
      type: "object",
      additionalProperties: false,
      required: ["satici", "tarih", "toplam", "kalemler"],
      properties: {
        satici: { type: "number" },
        tarih: { type: "number" },
        toplam: { type: "number" },
        kalemler: { type: "number" },
      },
    },
  },
} as const

/**
 * Kök DİZİ: kullanıcı fişleri masaya dizip tek kare çekiyor. Tek fiş dönen şema
 * bu girdide ya birini kaybeder ya ikisini birbirine karıştırır.
 */
export const TARAMA_SEMA = {
  type: "object",
  additionalProperties: false,
  required: ["fisler"],
  properties: { fisler: { type: "array", items: FIS_SEMA } },
} as const

export const TARAMA_PROMPT = [
  "Sen Türkçe yazarkasa fişi ve perakende satış fişi okuyan bir veri çıkarma aracısın.",
  "",
  "Görselde BİRDEN FAZLA fiş olabilir (masaya yan yana dizilmiş). Her mali fiş için",
  '"fisler" dizisine ayrı bir nesne ekle. Tek fiş varsa dizi tek elemanlı olur.',
  "",
  "BANKA SLİPİ AYRI BELGE DEĞİLDİR: mali fişin altında çoğu zaman POS slipi basılıdır",
  "(TERMİNAL NO, ONAY KODU, REFERANS NO, KART TURU, SATIS, banka logosu). Bu slip",
  "AYRI bir fiş DEĞİLDİR, içindeki TUTAR satırı bir kalem DEĞİLDİR ve bankanın ya da",
  'POS sağlayıcısının adı ("TEB", "Ödeal") bir kalem DEĞİLDİR. Slipten okunacak TEK',
  "şey ödeme şeklidir; geri kalanını yok say.",
  "",
  "ÖDEME ŞEKLİ: mali fişte TOPLAM'ın altında ödemenin nasıl yapıldığı yazar —",
  '"NAKİT", "KREDİ", "K.KARTI/B.KARTI", "BANKA KARTI", yemek kartı markası',
  '(Multinet, Sodexo, Ticket, Setcard...). Bunu "odeme" alanına şu kümeden yaz:',
  "  NAKIT · KREDI_KARTI · YEMEK_KARTI · HAVALE",
  "Mali fişte ödeme satırı YOKSA ama altta POS slipi varsa ödeme KREDI_KARTI'dır.",
  "Hiçbir ipucu yoksa sekil alanına null yaz — ÖDEME ŞEKLİNİ TAHMİN ETME.",
  "",
  "VKN'Yİ MERSIS NUMARASIYLA KARIŞTIRMA: fişte çoğu zaman ikisi de yazar ve MERSIS",
  "numarası VKN'yi İÇİNDE barındırır (MERSIS 0660004943800011 -> VKN 6600049438).",
  '"VKN/TCKN" veya "VD"/"VERGİ DAİRESİ" satırındaki numarayı al; MERSIS satırından',
  "hane sayarak VKN türetmeye çalışma.",
  "",
  "Kurallar:",
  "- SADECE fişte GÖRÜNEN veriyi çıkar. Okuyamadığın alana null yaz, TAHMİN ETME.",
  '- Tutarlar sayı olsun: "1.234,56" -> 1234.56 (Türkçe binlik nokta, ondalık virgül).',
  '- Tarih YYYY-MM-DD olsun, saat EKLEME. İki haneli yıl 26 -> 2026.',
  '- KDV oranı Türkiye\'de 1, 10 veya 20\'dir. Fişte "%08" gibi eski oran varsa olduğu gibi yaz.',
  "- TOPKDV ve TOPLAM'ı KARIŞTIRMA. Yazarkasa fişlerinde tutar, etiketinin bir üst",
  "  satırında basılabilir. Kontrol et: TOPKDV = TOPLAM x oran / (100 + oran).",
  "  Tutmuyorsa satırları yanlış eşlemişsindir, yeniden bak.",
  "- Kalem adlarını fişteki KISALTILMIŞ haliyle bırak, açmaya çalışma.",
  "- İskonto/promosyon satırlarını da kalem olarak yaz (tutarı negatif).",
  '- "guven" alanına her grup için 0-1 arası kendi güvenini yaz. Okunaksızsa düşük ver;',
  "  bu skor insan kontrolüne yönlendirmek için kullanılıyor, iyimser olma.",
  "",
  "Yanıtın SADECE JSON olsun; açıklama veya markdown kod bloğu ekleme.",
].join("\n")
