// Fişi yeni pencerede açar/yazdırır.
//
// `window.open(...) → document.write(buildReceiptHtml(...)) → focus()` üçlüsü
// kod tabanında altı yerde birebir kopyalanmıştı (satış, alış, kahveci, adisyon,
// fiş detayı, şablon önizleme). Her kopya kendi pencere ölçüsünü ve engellenme
// davranışını taşıyordu; kopyalardan biri düzeltilince diğerleri geride kalıyordu.
//
// Kararlar: docs/restoran/ADISYON-DETAY.md K4

import { buildReceiptHtml, type ReceiptData } from "@/lib/fis/receipt-html"
import { DEFAULT_RECEIPT_TEMPLATE, type ReceiptTemplate } from "@/lib/fis/receipt-template"

/** Termal fiş genişliğine yakın pencere — kullanıcı önizlemede satır kaymasını görsün. */
const WINDOW_FEATURES = "width=420,height=720"

/**
 * Fişi yeni pencerede açar. `autoPrint` ile pencere açılır açılmaz yazdırma
 * kutusu gelir.
 *
 * @returns Açılır pencere engellendiyse `false` — çağıran taraf kullanıcıya
 *   uyarı gösterir. Uyarı metni burada üretilmiyor: her ekranın kendi toast'u
 *   ve dili var.
 */
export function printReceipt(
  data: ReceiptData,
  autoPrint = false,
  template: ReceiptTemplate = DEFAULT_RECEIPT_TEMPLATE,
): boolean {
  const w = window.open("", "_blank", WINDOW_FEATURES)
  if (!w) return false
  w.document.write(buildReceiptHtml(data, autoPrint, template))
  w.document.close()
  w.focus()
  return true
}
