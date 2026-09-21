/**
 * Geçiş A — SINIFLANDIRICI şeması ve prompt'u (plan §3.2).
 *
 * Girdi: bir dosyanın tüm sayfaları (görsel) ya da metin katmanı. Çıktı: dosyada
 * bulunan belgelerin listesi — türü, hangi sayfalarda olduğu, iki tarafın
 * kimliği, belge no, tarih, toplam. Kalem OKUMAZ; kalemleri türe özel geçiş
 * (fatura/irsaliye/...) okur.
 *
 * YÖN SORULMAZ: "bu firma biz miyiz" bilgisini model bilmez. Yön, taraf
 * VKN/ünvanının firmayla karşılaştırılmasından kodda türetilir (normalize.ts).
 *
 * Tezgâh (`scripts/ai-belge-test.ts --tur sinif`) bu dosyayı DOĞRUDAN import
 * eder — fiş tezgâhındaki "ikiz prompt" sorunu burada yok.
 */

import { BELGE_TURLERI } from "../turler"

export type SinifBelgesi = {
  /** BELGE_TURLERI'nden biri; küme dışı değer normalize'da DIGER olur */
  tur: string
  /** 1 tabanlı sayfa numaraları (tek kare = [1]) */
  sayfalar: number[]
  /** Düzenleyen: fatura/irsaliyede SATICI, çek/senette KEŞİDECİ (borçlu), dekontta GÖNDEREN */
  duzenleyenUnvan: string | null
  duzenleyenVknTckn: string | null
  /** Muhatap: fatura/irsaliyede ALICI, çek/senette LEHTAR, dekontta ALICI hesap sahibi */
  muhatapUnvan: string | null
  muhatapVknTckn: string | null
  belgeNo: string | null
  tarih: string | null
  toplam: number | null
  /** Tür kararına güven 0–1 */
  guven: number
  /** Kısa gerekçe — "ÖKC fatura bilgi fişi", "proforma" gibi sınır durumları için */
  not: string | null
}

export type SinifSonucu = { belgeler: SinifBelgesi[] }

const BELGE_SEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "tur",
    "sayfalar",
    "duzenleyenUnvan",
    "duzenleyenVknTckn",
    "muhatapUnvan",
    "muhatapVknTckn",
    "belgeNo",
    "tarih",
    "toplam",
    "guven",
    "not",
  ],
  properties: {
    // enum DEĞİL: strict json_schema'da enum + null bileşimi bazı sağlayıcılarda
    // reddediliyor (fiş şemasında ölçüldü). Küme denetimi kodda (normalize.ts).
    tur: { type: "string", description: BELGE_TURLERI.join(", ") },
    sayfalar: { type: "array", items: { type: "integer" } },
    duzenleyenUnvan: { type: ["string", "null"] },
    duzenleyenVknTckn: { type: ["string", "null"], description: "10 hane VKN veya 11 hane TCKN, yalnız rakam" },
    muhatapUnvan: { type: ["string", "null"] },
    muhatapVknTckn: { type: ["string", "null"], description: "10 hane VKN veya 11 hane TCKN, yalnız rakam" },
    belgeNo: { type: ["string", "null"] },
    tarih: { type: ["string", "null"], description: "YYYY-MM-DD" },
    toplam: { type: ["number", "null"], description: "belgenin genel toplamı / tutarı" },
    guven: { type: "number" },
    not: { type: ["string", "null"] },
  },
} as const

export const SINIF_SEMA = {
  type: "object",
  additionalProperties: false,
  required: ["belgeler"],
  properties: { belgeler: { type: "array", items: BELGE_SEMA } },
} as const

export const SINIF_PROMPT = [
  "Sen Türk ticari belgelerini TANIYAN bir sınıflandırma aracısın. Kalemleri okumazsın;",
  "yalnız belgenin NE olduğunu, hangi sayfalarda durduğunu ve başlık bilgilerini çıkarırsın.",
  "",
  "Girdi bir ya da birden çok sayfa/görsel olabilir. Bir sayfada BİRDEN ÇOK belge",
  "(masaya dizilmiş fişler) ya da bir belgenin BİRDEN ÇOK sayfası olabilir. Her ayrı",
  '"belgeler" nesnesi TEK bir belgedir; sayfalar alanına o belgenin sayfa numaralarını yaz.',
  "",
  "TÜRLER:",
  "- FIS: yazarkasa / ÖKC / perakende satış fişi. Termal kâğıt, 'MALİ DEĞER', 'EKÜ NO',",
  "  'Z NO', 'TOPKDV' gibi ibareler. DİKKAT: başlığında 'FATURA BİLGİ FİŞİ' yazan ÖKC",
  "  çıktısı da FIS'tir (fatura değildir; asıl fatura ayrıca kesilir).",
  "- FATURA: e-Fatura, e-Arşiv Fatura ya da kâğıt (matbu) fatura. Satıcı ve alıcı",
  "  ünvan/VKN, fatura no, ETTN, kalemler, KDV kırılımı, 'ÖDENECEK TUTAR'.",
  "  Elektrik/su/doğalgaz/telekom faturaları da FATURA'dır. e-SMM (serbest meslek",
  "  makbuzu) da FATURA olarak işaretle, not alanına 'e-SMM' yaz.",
  "  PROFORMA, TEKLİF, SİPARİŞ TEYİDİ, İRSALİYELİ FATURA DEĞİL 'SEVK İRSALİYESİ' başlığı",
  "  taşıyan belge FATURA DEĞİLDİR: proforma/teklif → DIGER (not'a yaz).",
  "- IRSALIYE: sevk irsaliyesi / e-İrsaliye. 'İRSALİYE', 'SEVK TARİHİ', taşıyıcı, plaka,",
  "  kalemler var ama fiyat/KDV çoğu zaman yok. 'İRSALİYE YERİNE GEÇER' yazan fatura",
  "  yine FATURA'dır.",
  "- DEKONT: banka dekontu, havale/EFT makbuzu, hesap hareketi çıktısı. Banka logosu,",
  "  gönderen/alıcı IBAN, açıklama, işlem tarihi, tutar.",
  "- CEK: banka çeki. Banka adı/şube, çek seri no, keşideci, lehtar, vade/keşide tarihi.",
  "- SENET: bono / emre muharrer senet. 'BONO', 'ödeyeceğim', borçlu, alacaklı, vade.",
  "- DIGER: yukarıdakilerden hiçbiri (proforma, sipariş, sözleşme, poliçe, tahakkuk, kart",
  "  ekstresi, okunmaz görüntü). not alanına ne olduğunu kısaca yaz.",
  "",
  "TARAFLAR:",
  "- duzenleyen = belgeyi çıkaran taraf: faturada/irsaliyede SATICI, çek/senette KEŞİDECİ",
  "  (ödeyecek olan, hesap sahibi), dekontta GÖNDEREN (parayı yollayan).",
  "- muhatap = karşı taraf: faturada/irsaliyede ALICI (müşteri), çek/senette LEHTAR",
  "  (alacaklı), dekontta ALICI hesap sahibi.",
  "- VKN/TCKN yalnız rakam. VKN'yi MERSIS numarasıyla KARIŞTIRMA (MERSIS 16 hanedir ve",
  "  VKN'yi içinde barındırır); 'VKN', 'VD', 'VERGİ DAİRESİ', 'TCKN' satırındaki numarayı al.",
  "- Okuyamadığın alana null yaz, TAHMİN ETME.",
  "",
  "Kurallar:",
  '- Tutarlar sayı: "1.234,56" -> 1234.56. Tarih YYYY-MM-DD, saat ekleme.',
  "- toplam = belgenin ödenecek/genel toplamı (çek ve senette çekin tutarı, dekontta işlem tutarı).",
  "- belgeNo: fatura no / irsaliye no / çek seri no / dekont işlem-referans no / fiş no.",
  '- "guven" tür kararına güvenin (0-1). Emin değilsen düşük ver; bu skor insana yönlendirmek için.',
  "- Sayfa numaraları 1'den başlar ve girdideki sırayı izler.",
  "",
  "Yanıtın SADECE JSON olsun; açıklama veya markdown kod bloğu ekleme.",
].join("\n")

export const SINIF_KOMUT = "Bu sayfalardaki belgeleri sınıflandır."
