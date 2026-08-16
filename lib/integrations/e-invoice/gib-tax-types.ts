/**
 * GİB (UBL-TR) vergi türü kod listeleri — ÖTV listeleri + KDV/ÖTV dışı "diğer
 * vergiler". Fatura editöründeki vergi türü seçicilerinin GÖMÜLÜ (fallback)
 * veri kaynağıdır: /api/e-donusum/tax-types ucu önce Mysoft'tan canlı liste
 * çekmeyi dener; Mysoft'ta liste yoksa/ulaşılamazsa bu listeler servis edilir.
 *
 * Bu modül bilinçli olarak bağımlılıksızdır (saf veri) — hem sunucu route'u
 * hem "use client" fatura editörü tarafından import edilir.
 */

export type GibTaxType = {
  code: string
  name: string
  rate?: number
  /**
   * Bu vergi/pay KDV MATRAHINA girer mi? true ise satırın KDV'si
   * (net + bu tutar) üzerinden hesaplanır — bkz. lib/invoice/line-tax.ts.
   * Varsayılan false: mevcut "Diğer Vergiler" matrahın ÜSTÜNE eklenir.
   */
  vatBase?: boolean
  /**
   * GİB'e vergi (TaxTypeCode) olarak DEĞİL, satır masrafı (UBL
   * cac:AllowanceCharge, chargeIndicator=true) olarak gider. UBL-TR "Vergi
   * Kodları Listesi"nde karşılığı olmayan kalemler için — bkz. GEKAP.
   */
  charge?: boolean
}

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

/**
 * GEKAP'ın UBL-TR "Vergi Kodları Listesi"nde KARŞILIĞI YOKTUR (v1.42, Mart 2026
 * listesi kontrol edildi: 0003…9944 arasında geri kazanım katılım payı yok).
 * Bu yüzden GİB'e vergi olarak gönderilemez; satır masrafı (AllowanceCharge,
 * chargeIndicator=true) olarak gider ve KDV matrahını artırır — GİB'in KDVK
 * 24/b yorumuyla GEKAP zaten KDV matrahına dahildir.
 *
 * Kod alanı bilinçli olarak 4 haneli sayı DEĞİLDİR: sağlayıcıya vergi kodu diye
 * sızmasın (mysoft-provider kod formatını sayı olarak doğruluyor).
 */
export const GEKAP_TAX_CODE = "GEKAP"

// GİB "Diğer Vergiler" (KDV/ÖTV dışı) Vergi Türü Kodları (UBL-TR kod listesi).
// Yalnız MATRAHA EKLENEN türler listelenir — stopaj/tevkifat türleri (0003 GV
// stopajı, 9015 KDV tevkifatı, 4171 ÖTV tevkifatı) toplamı DÜŞÜRDÜĞÜ için bu
// seçiciye ait değildir (tevkifat kendi seçicisinden yönetilir). Standart oranı
// olan türde `rate` dolu → seçilince oran otomatik dolar; değişken oranlı (ör.
// Elektrik %1/%5) ya da maktu tutarlı türlerde `rate` bilinçli boştur.
//
// `vatBase` YALNIZ GEKAP'ta açıktır. ÖİV (4080/4081) ve Konaklama (0059) kendi
// kanunlarıyla KDV matrahının DIŞINDA bırakılmıştır; elektrik/enerji fonu gibi
// matraha giren kalemler ise bugüne dek "Fatura Altı İlave" ile modelleniyor
// (bkz. Invoice.globalChargeAmount) — davranışları bilerek değiştirilmedi.
export const GIB_OTHER_TAX_TYPES: GibTaxType[] = [
  { code: GEKAP_TAX_CODE, name: "Geri Kazanım Katılım Payı (GEKAP)", vatBase: true, charge: true },
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

const OTHER_TAX_BY_CODE = new Map(GIB_OTHER_TAX_TYPES.map((t) => [t.code, t] as const))

/**
 * Satıra girilen "Diğer Vergi" KDV matrahına dahil mi? Kod bilinmiyorsa (Mysoft'un
 * canlı listesinden gelen ya da içe aktarımdan türetilmiş bir kod) HAYIR — matrahı
 * kendiliğinden şişirmek, düzeltmesi zor bir KDV farkı yaratır.
 */
export function isOtherTaxInVatBase(code?: string | null): boolean {
  return OTHER_TAX_BY_CODE.get(String(code ?? "").trim())?.vatBase === true
}

/** GİB'e vergi olarak değil, satır masrafı (AllowanceCharge) olarak gidenler. */
export function isOtherTaxCharge(code?: string | null): boolean {
  return OTHER_TAX_BY_CODE.get(String(code ?? "").trim())?.charge === true
}
