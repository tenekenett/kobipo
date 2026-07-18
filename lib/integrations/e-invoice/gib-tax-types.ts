/**
 * GİB (UBL-TR) vergi türü kod listeleri — ÖTV listeleri + KDV/ÖTV dışı "diğer
 * vergiler". Fatura editöründeki vergi türü seçicilerinin GÖMÜLÜ (fallback)
 * veri kaynağıdır: /api/e-donusum/tax-types ucu önce Mysoft'tan canlı liste
 * çekmeyi dener; Mysoft'ta liste yoksa/ulaşılamazsa bu listeler servis edilir.
 *
 * Bu modül bilinçli olarak bağımlılıksızdır (saf veri) — hem sunucu route'u
 * hem "use client" fatura editörü tarafından import edilir.
 */

export type GibTaxType = { code: string; name: string; rate?: number }

// GİB ÖTV Vergi Türü Kodları (liste-bazlı). ÖTV oranı ürüne göre değiştiğinden
// SABİT DEĞİL — oran elle girilir; liste seçilince kod otomatik gelir. Oranı
// boşsa gönderimde son çare DEFAULT_EXCISE_CODE (IV. Liste) kullanılır.
export const GIB_EXCISE_TAX_TYPES: GibTaxType[] = [
  { code: "0074", name: "IV. Liste (dayanıklı tüketim / diğer mallar)" },
  { code: "0071", name: "I. Liste (petrol / doğalgaz ürünleri)" },
  { code: "9077", name: "II. Liste (motorlu taşıt araçları - tescile tabi)" },
  { code: "0073", name: "III. Liste (kolalı gazoz, alkollü içecek, tütün)" },
  { code: "0075", name: "III-A Liste (alkollü içecekler)" },
  { code: "0076", name: "III-B Liste (tütün mamülleri)" },
  { code: "0077", name: "III-C Liste (kolalı gazozlar)" },
]

export const DEFAULT_EXCISE_CODE = "0074"

// GİB "Diğer Vergiler" (KDV/ÖTV dışı) Vergi Türü Kodları (UBL-TR kod listesi).
// Yalnız MATRAHA EKLENEN türler listelenir — stopaj/tevkifat türleri (0003 GV
// stopajı, 9015 KDV tevkifatı, 4171 ÖTV tevkifatı) toplamı DÜŞÜRDÜĞÜ için bu
// seçiciye ait değildir (tevkifat kendi seçicisinden yönetilir). Standart oranı
// olan türde `rate` dolu → seçilince oran otomatik dolar; değişken oranlı (ör.
// Elektrik %1/%5) ya da maktu tutarlı türlerde `rate` bilinçli boştur.
export const GIB_OTHER_TAX_TYPES: GibTaxType[] = [
  { code: "0059", name: "Konaklama Vergisi", rate: 2 },
  { code: "4080", name: "Özel İletişim Vergisi (ÖİV)", rate: 10 },
  { code: "4081", name: "Özel İletişim Vergisi (5035 SK)", rate: 10 },
  { code: "4071", name: "Elektrik ve Havagazı Tüketim Vergisi" },
  { code: "8005", name: "Elektrik Tüketim Vergisi" },
  { code: "8002", name: "Enerji Fonu" },
  { code: "8004", name: "TRT Payı" },
  { code: "0021", name: "Banka Muameleleri Vergisi (BMV)" },
  { code: "0022", name: "Sigorta Muameleleri Vergisi" },
  { code: "9021", name: "Banka Sigorta Muameleleri Vergisi (4961)" },
  { code: "0061", name: "Kaynak Kullanımı Destekleme Fonu (KKDF)" },
  { code: "1047", name: "Damga Vergisi" },
  { code: "1048", name: "Damga Vergisi (5035 SK)" },
  { code: "8001", name: "Borsa Tescil Ücreti" },
  { code: "8006", name: "Telsiz Kullanım Ücreti" },
  { code: "8007", name: "Telsiz Ruhsat Ücreti" },
  { code: "8008", name: "Çevre Temizlik Vergisi" },
  { code: "9040", name: "Mera Fonu" },
  { code: "9944", name: "Belediyelere Ödenen Hal Rüsumu" },
]
