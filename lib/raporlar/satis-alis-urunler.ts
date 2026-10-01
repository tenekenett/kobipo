/**
 * Alış raporunun "Alınan Ürünler" bölümü — fatura KALEMLERİNİ ürün bazında
 * toplayan SAF kural (sorgu `satis-alis.ts`te, ekran ve Excel aynı sonucu okur).
 *
 * Soru: "dönemde hangi üründen ne kadar aldık, kaça aldık, en son kimden aldık".
 * "Detaylı Faturalar" her kalemi ayrı satır basıyordu; aynı ürünün on alışı on
 * satırdı ve toplamı ancak Excel'de pivotla çıkıyordu.
 *
 * Kurallar:
 *  - Gruplama ürün KARTINA göredir (ad değişse de aynı kart tek satır). Karta
 *    bağlı olmayan serbest kalem, Türkçe duyarsız katlanmış ad + birim ile
 *    gruplanır ("Nakliye" ile "NAKLİYE" tek satır).
 *  - İadeler EKSİ girer (miktar ve tutar): satırlar net alıştır, Faturalar
 *    sayfasıyla aynı işaret.
 *  - Tutar (KDV hariç) = miktar × birim fiyat − satır iskontosu. Toplam (KDV
 *    dahil) satırın kayıtlı toplamıdır; sütunun toplamı "Detaylı Faturalar"ın
 *    toplamına eşittir. Fatura GENELİ iskontosu kalemlere dağıtılmadığı için
 *    Faturalar sayfasından farkı ekran ayrıca açıklar (`describeLineTotalGap`).
 *  - Ortalama birim fiyat = net tutar ÷ net miktar; net miktar sıfırsa (tamamı
 *    iade) tanımsızdır, null döner — sıfıra bölüp "∞" basmayız.
 *  - "Son alış" İADE OLMAYAN en yeni kalemdir: iade faturası alış fiyatı değildir.
 */

import { trFold } from "@/lib/text/tr-fold"

export type ProductLineInput = {
  invoiceId: string
  /** ISO tarih. */
  date: string
  /** +1 alış, −1 iade. */
  sign: number
  counterpartyName: string
  product: { id: string; slug: string | null; code: string | null; name: string; isService: boolean } | null
  description: string
  unit: string
  quantity: number
  unitPrice: number
  discountAmount: number
  vatAmount: number
  totalAmount: number
}

export type SalesPurchaseProduct = {
  /** Gruplama anahtarı: kart id'si ya da `serbest:<katlanmış ad>|<birim>`. */
  key: string
  /** Ürün kartının adresi (slug ya da id); serbest kalemde null. */
  productRef: string | null
  productCode: string
  name: string
  kind: "Stok" | "Hizmet" | "Serbest kalem"
  unit: string
  /** Net miktar (iadeler düşülmüş). */
  quantity: number
  /** KDV hariç net tutar. */
  netAmount: number
  vatAmount: number
  /** Satır toplamları (KDV dahil). */
  totalAmount: number
  /** KDV hariç ortalama birim fiyat; net miktar 0 ise null. */
  avgUnitPrice: number | null
  /** İade olmayan en yeni kalemin birim fiyatı, tarihi ve carisi. */
  lastUnitPrice: number | null
  lastDate: string | null
  lastCounterpartyName: string
  /** Ürünün geçtiği belge adedi (iade dahil). */
  invoiceCount: number
  /** Kaç farklı cariden alındı. */
  counterpartyCount: number
}

const round2 = (n: number) => Math.round(n * 100) / 100
const round4 = (n: number) => Math.round(n * 10000) / 10000

export function productKeyOf(line: Pick<ProductLineInput, "product" | "description" | "unit">): string {
  if (line.product) return line.product.id
  return `serbest:${trFold(line.description.trim())}|${trFold(line.unit.trim())}`
}

export function aggregateProductLines(lines: ProductLineInput[]): SalesPurchaseProduct[] {
  type Acc = SalesPurchaseProduct & { invoices: Set<string>; parties: Set<string>; lastTime: number }
  const map = new Map<string, Acc>()

  for (const line of lines) {
    const key = productKeyOf(line)
    let acc = map.get(key)
    if (!acc) {
      acc = {
        key,
        productRef: line.product ? line.product.slug || line.product.id : null,
        productCode: line.product?.code || "",
        name: line.product?.name || line.description,
        kind: line.product ? (line.product.isService ? "Hizmet" : "Stok") : "Serbest kalem",
        unit: line.unit,
        quantity: 0,
        netAmount: 0,
        vatAmount: 0,
        totalAmount: 0,
        avgUnitPrice: null,
        lastUnitPrice: null,
        lastDate: null,
        lastCounterpartyName: "",
        invoiceCount: 0,
        counterpartyCount: 0,
        invoices: new Set(),
        parties: new Set(),
        lastTime: Number.NEGATIVE_INFINITY,
      }
      map.set(key, acc)
    }

    const lineNet = round2(line.quantity * line.unitPrice) - line.discountAmount
    acc.quantity += line.sign * line.quantity
    acc.netAmount += line.sign * lineNet
    acc.vatAmount += line.sign * line.vatAmount
    acc.totalAmount += line.sign * line.totalAmount
    acc.invoices.add(line.invoiceId)
    acc.parties.add(line.counterpartyName)

    const time = new Date(line.date).getTime()
    if (line.sign > 0 && time >= acc.lastTime) {
      acc.lastTime = time
      acc.lastUnitPrice = line.unitPrice
      acc.lastDate = line.date
      acc.lastCounterpartyName = line.counterpartyName
      // Birim en yeni alıştan: kart birimi sonradan değiştiyse güncel olan görünür.
      acc.unit = line.unit
    }
  }

  return Array.from(map.values())
    .map(({ invoices, parties, lastTime: _lastTime, ...row }) => {
      const quantity = round4(row.quantity)
      const netAmount = round2(row.netAmount)
      return {
        ...row,
        quantity,
        netAmount,
        vatAmount: round2(row.vatAmount),
        totalAmount: round2(row.totalAmount),
        avgUnitPrice: quantity !== 0 ? round4(netAmount / quantity) : null,
        invoiceCount: invoices.size,
        counterpartyCount: parties.size,
      }
    })
    .sort((a, b) => b.totalAmount - a.totalAmount || a.name.localeCompare(b.name, "tr"))
}
