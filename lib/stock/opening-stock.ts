/**
 * AÇILIŞ (başlangıç) STOĞU — aritmetiği.
 *
 * Açılış stoğu ayrı bir sütun değil, ürünün ilk stok hareketidir: kart
 * oluşturulurken girilen miktar "Açılış stoğu" açıklamalı bir IN hareketi olarak
 * yazılır (app/api/stok/products/route.ts). Dolayısıyla "başlangıç stoğunu
 * değiştirmek" o hareketin miktarını değiştirmek, farkı da güncel bakiyeye
 * yansıtmaktır.
 *
 * İki tuzak bu dosyanın var olma sebebi:
 *
 * 1. ESKİ KAYITLAR — hareketsiz açılış. Tek kapı (`adjustWarehouseStock`)
 *    kurulmadan önce ürün oluşturma, girilen miktarı KARTA doğrudan yazıyordu ve
 *    hiçbir hareket üretmiyordu (bkz. commit 0775a78 öncesi). O ürünlerde açılış
 *    hareketi YOKTUR ama bakiyenin içindedir. Açılışı "0" sayıp üstüne 100
 *    yazsaydık bakiye 200 olurdu. Bu yüzden hareketi olmayan üründe açılış
 *    KALINTIDAN okunur: kart − Σ(hareketler).
 *
 * 2. HAREKETİN MİKTARI ile BAKİYE FARKI aynı sayı değildir. Hareket HEDEF
 *    miktarı taşır (açılış 100'dü, 120 oldu → hareket 120), karta ve depo
 *    satırına ise yalnızca FARK (+20) işlenir. İkisini aynı sanmak, düzeltmeyi
 *    her kaydedişte bakiyeyi yeniden şişirirdi.
 *
 * İşlemden sonra Σ(hareketler) = kart bakiyesi eşitliği KURULUR: eski kayıtta
 * kalıntı da hareketle temsil edilir hâle geldiği için defter kartla barışır.
 */

const round4 = (n: number) => Math.round(n * 10000) / 10000

export type OpeningStockPlan =
  | {
      ok: true
      /** Değişiklikten ÖNCEKİ açılış miktarı (hareket yoksa kalıntıdan). */
      previous: number
      /** Karta ve depo satırına işlenecek fark. */
      delta: number
      /** Hareketin yeni miktarı — HEDEF (fark değil). */
      movementQuantity: number
    }
  | { ok: false; error: string }

export function planOpeningStock(input: {
  /** Kullanıcının girdiği yeni açılış miktarı. */
  target: number
  /** Ürün kartındaki güncel bakiye. */
  cardQuantity: number
  /** Ürünün TÜM stok hareketlerinin toplamı (işaretli). */
  movementSum: number
  /** Açılış hareketinin miktarı; hareket yoksa null. */
  openingMovementQuantity: number | null
}): OpeningStockPlan {
  const target = round4(input.target)
  if (!Number.isFinite(target)) return { ok: false, error: "Açılış stoğu sayı olmalı" }
  if (target < 0) return { ok: false, error: "Açılış stoğu negatif olamaz" }

  const card = round4(input.cardQuantity)
  const previous =
    input.openingMovementQuantity != null
      ? round4(input.openingMovementQuantity)
      : round4(card - input.movementSum)

  const delta = round4(target - previous)
  const newBalance = round4(card + delta)

  if (newBalance < 0) {
    // Açılışı düşürmek geçmiş satışları geri almaz: kalan bakiye negatife
    // düşecekse işlem yapılmaz, kullanıcıya ALT SINIR söylenir.
    const minimum = round4(Math.max(0, previous - card))
    return {
      ok: false,
      error:
        `Açılış stoğu en fazla ${format(previous - minimum)} azaltılabilir: ` +
        `daha düşüğü güncel bakiyeyi (${format(card)}) negatife düşürür. ` +
        `En küçük açılış: ${format(minimum)}.`,
    }
  }

  return { ok: true, previous, delta, movementQuantity: target }
}

function format(n: number): string {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 4 }).format(round4(n))
}
