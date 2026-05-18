/**
 * Eskiden global bir E_INVOICE_PROVIDER env var ile çalışıyordu; şimdi her firma
 * kendi `eDonusumProvider` + `eDonusumApiUsername` + `eDonusumApiPassword`'unu DB'de
 * tutuyor. Bu yüzden global env kontrolü artık geçerli değil — her route handler
 * zaten kullanım anında firma credentials'larını doğruluyor.
 *
 * Fonksiyonu silmiyoruz çünkü 12+ yerden çağrılıyor; no-op olarak tutmak en az
 * invasive çözüm. İleride mock/staging override gerekirse buraya tekrar mantık
 * eklenir.
 */
export function assertEInvoiceRuntimeReady() {
  // no-op
}
