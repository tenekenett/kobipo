/**
 * FATURA çıkarımı — şema ve prompt (plan §3.7). Kâğıt fatura fotoğrafı, e-Arşiv /
 * e-Fatura PDF'i (görsel ya da metin katmanı) aynı şemadan geçer.
 *
 * Tezgâh (`scripts/ai-belge-test.ts --tur fatura`) bu dosyayı doğrudan import eder.
 *
 * KAREKODLU BELGEDE model yine tam şemayı doldurur; başlık ve dip toplam
 * karekoddan gelir, modelin okuduğu değer yalnız ÇAPRAZ DENETİMDE kullanılır
 * (validate.ts). Kalemler her zaman modelden (karekodda kalem yok).
 */

export type FaturaKalem = {
  ad: string
  /** Satıcının ürün/stok kodu — alias öğrenmesinin anahtarı (eslestir/alias.ts) */
  saticiKodu: string | null
  miktar: number | null
  birim: string | null
  /** KDV HARİÇ birim fiyat */
  birimFiyat: number | null
  /** Satır iskontosu TUTARI (KDV hariç) */
  iskontoTutar: number | null
  kdvOrani: number | null
  kdvTutar: number | null
  /** Satırın KDV HARİÇ net tutarı = miktar × birimFiyat − iskonto */
  satirTutar: number | null
  /** KDV tevkifat oranı (varsa) — "2/10" biçimi ondalığa çevrilir: 0.2 */
  tevkifatOrani: number | null
}

export type FaturaKdv = { oran: number; matrah: number | null; kdv: number | null }

export type FaturaGuven = {
  satici: number
  alici: number
  tarih: number
  toplam: number
  kalemler: number
}

export type Fatura = {
  saticiUnvan: string | null
  saticiVknTckn: string | null
  saticiVergiDairesi: string | null
  saticiAdres: string | null
  aliciUnvan: string | null
  aliciVknTckn: string | null
  faturaNo: string | null
  ettn: string | null
  tarih: string | null
  vade: string | null
  /** e-belgede senaryo (TEMELFATURA/TICARIFATURA/EARSIVFATURA) ya da "KAGIT" */
  senaryo: string | null
  /** SATIS, IADE, TEVKIFAT, ISTISNA, OZELMATRAH... e-SMM ise "SMM" */
  tip: string | null
  paraBirimi: string | null
  kalemler: FaturaKalem[]
  kdvKirilimi: FaturaKdv[]
  /** Fatura altı genel iskonto (KDV hariç) */
  genelIskonto: number | null
  /** KDV'ye TABİ OLMAYAN ek tutar toplamı: damga vergisi, gecikme zammı, KDV'siz masraf */
  kdvsizEk: number | null
  /** Σ satır net (KDV hariç, satır iskontoları düşülmüş, genel iskonto düşülmemiş) */
  matrahToplam: number | null
  kdvToplam: number | null
  /** KDV tevkifatı toplamı (varsa) */
  tevkifatToplam: number | null
  /** Ödenecek tutar (belgedeki "ÖDENECEK TUTAR") */
  odenecek: number | null
  /** Belgede atıf yapılan irsaliye numaraları */
  irsaliyeNoListesi: string[]
  /** Belgede yazan ödeme bilgisi (IBAN, vade notu) — serbest metin */
  odemeNotu: string | null
  guven: FaturaGuven
}

const KALEM_SEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "ad",
    "saticiKodu",
    "miktar",
    "birim",
    "birimFiyat",
    "iskontoTutar",
    "kdvOrani",
    "kdvTutar",
    "satirTutar",
    "tevkifatOrani",
  ],
  properties: {
    ad: { type: "string" },
    saticiKodu: { type: ["string", "null"] },
    miktar: { type: ["number", "null"] },
    birim: { type: ["string", "null"], description: "ADET, KG, LT, M, SAAT, PAKET..." },
    birimFiyat: { type: ["number", "null"], description: "KDV HARİÇ birim fiyat" },
    iskontoTutar: { type: ["number", "null"], description: "satır iskontosu tutarı, KDV hariç" },
    kdvOrani: { type: ["number", "null"], description: "0, 1, 10, 20 (eski belgede 8, 18)" },
    kdvTutar: { type: ["number", "null"] },
    satirTutar: { type: ["number", "null"], description: "KDV HARİÇ satır net tutarı" },
    tevkifatOrani: { type: ["number", "null"], description: "2/10 -> 0.2" },
  },
} as const

const KDV_SEMA = {
  type: "object",
  additionalProperties: false,
  required: ["oran", "matrah", "kdv"],
  properties: {
    oran: { type: "number" },
    matrah: { type: ["number", "null"] },
    kdv: { type: ["number", "null"] },
  },
} as const

export const FATURA_SEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "saticiUnvan",
    "saticiVknTckn",
    "saticiVergiDairesi",
    "saticiAdres",
    "aliciUnvan",
    "aliciVknTckn",
    "faturaNo",
    "ettn",
    "tarih",
    "vade",
    "senaryo",
    "tip",
    "paraBirimi",
    "kalemler",
    "kdvKirilimi",
    "genelIskonto",
    "kdvsizEk",
    "matrahToplam",
    "kdvToplam",
    "tevkifatToplam",
    "odenecek",
    "irsaliyeNoListesi",
    "odemeNotu",
    "guven",
  ],
  properties: {
    saticiUnvan: { type: ["string", "null"] },
    saticiVknTckn: { type: ["string", "null"], description: "10 hane VKN veya 11 hane TCKN, yalnız rakam" },
    saticiVergiDairesi: { type: ["string", "null"] },
    saticiAdres: { type: ["string", "null"] },
    aliciUnvan: { type: ["string", "null"] },
    aliciVknTckn: { type: ["string", "null"], description: "10 hane VKN veya 11 hane TCKN, yalnız rakam" },
    faturaNo: { type: ["string", "null"] },
    ettn: { type: ["string", "null"], description: "UUID biçiminde ETTN" },
    tarih: { type: ["string", "null"], description: "YYYY-MM-DD" },
    vade: { type: ["string", "null"], description: "YYYY-MM-DD; son ödeme tarihi" },
    senaryo: { type: ["string", "null"] },
    tip: { type: ["string", "null"] },
    paraBirimi: { type: ["string", "null"], description: "TRY, USD, EUR" },
    kalemler: { type: "array", items: KALEM_SEMA },
    kdvKirilimi: { type: "array", items: KDV_SEMA },
    genelIskonto: { type: ["number", "null"] },
    kdvsizEk: { type: ["number", "null"] },
    matrahToplam: { type: ["number", "null"] },
    kdvToplam: { type: ["number", "null"] },
    tevkifatToplam: { type: ["number", "null"] },
    odenecek: { type: ["number", "null"] },
    irsaliyeNoListesi: { type: "array", items: { type: "string" } },
    odemeNotu: { type: ["string", "null"] },
    guven: {
      type: "object",
      additionalProperties: false,
      required: ["satici", "alici", "tarih", "toplam", "kalemler"],
      properties: {
        satici: { type: "number" },
        alici: { type: "number" },
        tarih: { type: "number" },
        toplam: { type: "number" },
        kalemler: { type: "number" },
      },
    },
  },
} as const

export const FATURA_PROMPT = [
  "Sen Türk faturalarını (e-Fatura, e-Arşiv Fatura, kâğıt fatura, elektrik/su/doğalgaz/",
  "telekom faturası, e-SMM) okuyan bir veri çıkarma aracısın. Girdi bir belgenin tüm",
  "sayfalarıdır; çok sayfalı faturada kalemler sayfalar arasında devam eder — hepsini tek",
  "listede topla, sayfa sonundaki 'devamı var' satırlarını kalem sayma.",
  "",
  "TARAFLAR: SATICI belgeyi düzenleyen (üstte, logo yanında, 'VKN', 'VD' ile), ALICI 'SAYIN'",
  "ile başlayan blok. VKN'yi MERSIS numarasıyla KARIŞTIRMA (MERSIS 16 hanedir ve VKN'yi",
  "içinde barındırır). Okuyamadığın alana null yaz, TAHMİN ETME.",
  "",
  "KALEMLER — KDV HARİÇ çalış:",
  "- birimFiyat KDV HARİÇ'tir. Belge yalnız KDV dahil fiyat basıyorsa (nadiren) birimFiyat'ı",
  "  null bırak ve satirTutar'ı KDV HARİÇ olarak yaz (satır KDV'sini düş).",
  "- satirTutar = miktar × birimFiyat − iskontoTutar (KDV hariç net). Belgedeki 'Mal Hizmet",
  "  Tutarı' sütunu genelde budur.",
  "- iskontoTutar satır iskontosunun TUTARIDIR; belge yalnız oran basıyorsa tutarı hesapla.",
  "- Elektrik/su/telekom faturasında her bedel satırı (tüketim, dağıtım, sayaç, TRT payı,",
  "  enerji fonu, ETV, güç bedeli) AYRI KALEMDİR; KDV oranı olarak o satıra uygulanan oranı yaz.",
  "- KDV'ye TABİ OLMAYAN ekler (damga vergisi, gecikme zammı/faizi, tahsilat masrafı) kalem",
  "  DEĞİLDİR: toplamlarını kdvsizEk alanına yaz.",
  "- saticiKodu: satıcının stok/ürün kodu sütunu varsa (kod, SKU, ürün no) yaz; yoksa null.",
  "- tevkifatOrani: '2/10', '5/10', '7/10', '9/10' gibi kesirleri ondalığa çevir (0.2, 0.5...).",
  "",
  "DİP TOPLAM:",
  "- matrahToplam = Σ satirTutar (genel iskonto düşülmeden). kdvKirilimi: oran başına matrah",
  "  ve KDV — belgedeki 'KDV %20 matrahı / hesaplanan KDV' satırlarından.",
  "- genelIskonto: fatura altı toplam iskonto (satır iskontolarının toplamı DEĞİL, ayrıca",
  "  düşülen). Yoksa null.",
  "- odenecek: 'ÖDENECEK TUTAR'. Tevkifatlı faturada ödenecek = vergiler dahil − tevkifat.",
  "- Kontrol et: odenecek ≈ matrahToplam − genelIskonto + kdvToplam − tevkifatToplam + kdvsizEk.",
  "  Tutmuyorsa satırları yanlış okumuşsundur, yeniden bak.",
  "",
  "BAŞLIK:",
  "- faturaNo: e-belgede 3 harf + 13 rakam (ABC2026000000001); kâğıt faturada seri+sıra no.",
  "- ettn: UUID (8-4-4-4-12). Yoksa null. senaryo/tip e-belgenin üstünde yazar; kâğıt",
  "  faturada senaryo 'KAGIT'. e-SMM ise tip 'SMM'.",
  "- vade: 'Son Ödeme Tarihi' / 'Vade'. Yoksa null.",
  "- irsaliyeNoListesi: 'İrsaliye No' alanındaki numaralar (birden çok olabilir).",
  "- odemeNotu: IBAN, banka, 'peşin/vadeli' gibi ödeme bilgisi serbest metin.",
  "",
  "Kurallar:",
  '- Tutarlar sayı: "1.234,56" -> 1234.56. Tarih YYYY-MM-DD, saat EKLEME. Yıl iki haneliyse 26 -> 2026.',
  "- KDV oranı Türkiye'de 0, 1, 10, 20 (eski belgede 8, 18) — belgede ne yazıyorsa onu yaz.",
  "- Kalem adlarını belgedeki hâliyle bırak.",
  '- "guven": her grup için 0-1 arası kendi güvenin; okunaksızsa düşük ver, iyimser olma.',
  "",
  "Yanıtın SADECE JSON olsun; açıklama veya markdown kod bloğu ekleme.",
].join("\n")

export const FATURA_KOMUT = "Bu faturayı çıkar."
