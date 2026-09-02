/**
 * Online tahsilat linkleri — GEÇİCİ OLARAK KAPALI.
 *
 * `/pay/<token>` sayfasındaki "Ödemeyi Tamamla" düğmesi GERÇEK bir tahsilat yapmıyordu:
 * hiçbir ödeme sağlayıcısına uğramadan doğrudan `InvoicePayment` yazıp linki PAID'e
 * çekiyordu. Yani linki eline geçiren herkes, tek tıkla, parayı ödemeden faturayı
 * "ödenmiş" gösterebiliyordu — üstelik uç oturum aramadığı için tarayıcı bile gerekmez.
 *
 * Sanal POS (PayTR) akışı bu uca bağlanana kadar özellik pasif:
 *
 *   - link üretimi   → POST /api/faturalar/[id]/payment-link  503
 *   - link kullanımı → GET + POST /api/pay/[token]            503
 *   - fatura ödemeleri ekranındaki "Online Tahsilat Linkleri" kartı hiç basılmaz.
 *
 * Mevcut `payment_links` kayıtlarına DOKUNULMAZ. Açmak için bu bayrağı true yapmak
 * yetmez: önce POST'un ödemeyi sağlayıcıdan DOĞRULAMASI gerekir.
 */
// Tip `boolean` olarak YAZILI: `false` literal'i olsa TypeScript bayrağın arkasındaki
// kodu erişilmez sayar ve özellik açıldığında derleyici oradaki hataları göstermez.
export const PAYMENT_LINKS_ENABLED: boolean = false

export const PAYMENT_LINKS_DISABLED_MESSAGE =
  "Online tahsilat linkleri geçici olarak kullanım dışıdır."
