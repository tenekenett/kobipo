/**
 * BAKİYE KAPAMA / İSKONTO — kasaya dokunmadan cari bakiyeyi kapatan kayıt.
 *
 * Müşteri 10.000'lik faturaya 9.950 ödedi ve 50'den vazgeçildi; ya da
 * tedarikçi kalan 12,40'ı sildi. Para hareketi YOKTUR, ama fatura kapanmalı ve
 * cari bakiye düşmelidir. Bu kayıt bir `InvoicePayment`tır:
 *
 *   paymentMethod = "WRITE_OFF"   accountId = null   transactionId = null
 *
 * Neden ayrı tablo değil: bakiye/ekstre/yaşlandırma/açık fatura okumaları
 * "kasa hareketine bağlı olmayan ödeme"yi (transactionId IS NULL) baştan beri
 * düşüyor; kasa tarafı ise `accountId IS NULL` ödemeyi hiç saymıyor
 * (lib/finans/nakit-hareket.ts → LEGACY_CASH_PAYMENT_WHERE). Yeni tablo, altı
 * ayrı bakiye kurucusuna altıncı bir kaynak eklemek olurdu — biri unutulduğu
 * an liste "kapalı" derken kart "borçlu" derdi.
 *
 * Neden faturaya bağlı: kapatılan şey belirli bir alacak/borçtur. Faturasız
 * bakiyeyi (avans, açılış devri) bu yolla kapatmak, neyin silindiğini
 * söylemeyen bir rakam bırakırdı.
 *
 * Saf modül: istemci (tahsilat penceresi, ödeme listesi) ve sunucu (uç, ekstre,
 * rapor) aynı sabiti okur.
 */

export const BAKIYE_KAPAMA_METHOD = "WRITE_OFF"

export const BAKIYE_KAPAMA_LABEL = "Bakiye Kapama / İskonto"

export function isBakiyeKapama(paymentMethod: string | null | undefined): boolean {
  return String(paymentMethod || "").toUpperCase() === BAKIYE_KAPAMA_METHOD
}
