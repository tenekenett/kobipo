// İade faturasının atıf yaptığı ASIL FATURA numarasının kuralı — tek tanım.
//
// GİB şematronu (Mysoft'un döndürdüğü hatanın birebir metni):
//
//   "IADE, TEVKIFATIADE ve YTBIADE fatura tiplerinde iade bilgilerini içeren
//    cbc:DocumentTypeCode değeri IADE ve 16 HANELİ ID değeri olan iade fatura
//    sayısı kadar cac:BillingReference/cac:InvoiceDocumentReference elemanı
//    içermelidir."
//
// Yani atıf, Kobipo'nun İÇ numarası (SAT-2026-0205) değil, iade edilen belgenin
// GİB BELGE NUMARASI olmalı: 3 harf + 13 rakam (ör. ADM2026000000013).
// Kobipo'da bu değer `Invoice.eDocumentNo` alanında durur; iç numara
// `invoiceNo`dur ve ikisini karıştırmak belgeyi şematrondan döndürür.

/** GİB belge numarası biçimi: 3 harf (seri) + 13 rakam (yıl + sıra) = 16 hane. */
const GIB_DOC_NO = /^[A-Za-z]{3}\d{13}$/

/** Boşlukları/tireleri atıp büyük harfe çevirir — kullanıcı elle yazarken serbest bırakıyoruz. */
export function normalizeGibDocumentNo(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/[\s-]/g, "")
    .toUpperCase()
}

/** Değer GİB belge numarası mı? (normalize edilmiş hâline bakar) */
export function isGibDocumentNo(value: string | null | undefined): boolean {
  return GIB_DOC_NO.test(normalizeGibDocumentNo(value))
}

/**
 * e-Belge olarak gönderilecek bir iadenin atfı geçerli mi?
 *
 * `null` → sorun yok. Metin dönerse gönderim ENGELLENMELİ: şematron hatası
 * kullanıcıya "cbc:DocumentTypeCode" diye konuşuyor, bu mesaj ise ne yapması
 * gerektiğini söylüyor.
 */
export function returnRefError(value: string | null | undefined): string | null {
  const norm = normalizeGibDocumentNo(value)
  if (!norm) {
    return (
      "İade edilen faturanın GİB belge numarası girilmemiş. " +
      "İade faturası e-belge olarak gönderilemez — asıl faturanın 16 haneli GİB " +
      "numarasını (ör. ADM2026000000013) girin."
    )
  }
  if (!GIB_DOC_NO.test(norm)) {
    return (
      `"${value}" GİB belge numarası değil. GİB, iade faturasında asıl belgenin ` +
      "16 haneli numarasını ister (3 harf + 13 rakam, ör. ADM2026000000013). " +
      "Kobipo'nun iç numarası (SAT-2026-0205 gibi) kabul edilmez; asıl faturanın " +
      "önizlemesinde görünen GİB numarasını kullanın."
    )
  }
  return null
}
