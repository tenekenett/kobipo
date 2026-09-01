/**
 * Bir girdinin altına "yapıştırılan" açılır listenin ekrandaki yeri.
 *
 * Liste `position: fixed` ile `document.body`'ye basılır (portal): kalem satırı
 * `overflow-hidden` bir kartın içindeyken `absolute` liste satırın içinde kırpılır
 * ve alttaki satırın üzerine binemez — müşterinin "aşağı açılan pencere alt satırın
 * üzerine çıkmalı, çok dar kalıyor" şikâyeti buydu.
 *
 * Hesap SAF tutuldu: DOM'a dokunmadan sınanabilsin diye ölçüler (girdinin
 * dikdörtgeni + pencere boyu) dışarıdan verilir.
 */

export type AnchoredRect = {
  top: number
  left: number
  width: number
  maxHeight: number
}

export type AnchorBox = { top: number; bottom: number; left: number; width: number }
export type Viewport = { width: number; height: number }

export type AnchoredMenuOptions = {
  /** Liste girdiden dar kalmasın: taban genişlik. */
  minWidth?: number
  /** Liste ne kadar uzayabilir. */
  maxHeight?: number
  /** Kenar boşluğu. */
  margin?: number
  /** Aşağıda bu kadar yer yoksa yukarı açılır. */
  flipThreshold?: number
}

export function computeAnchoredRect(
  anchor: AnchorBox,
  viewport: Viewport,
  options: AnchoredMenuOptions = {}
): AnchoredRect {
  const margin = options.margin ?? 8
  const minWidth = options.minWidth ?? 360
  const maxHeightCap = options.maxHeight ?? 384
  const flipThreshold = options.flipThreshold ?? 200

  // Girdi dardır (kalem satırında bir sütun); liste en az `minWidth` olur ama
  // ekrandan da taşmaz.
  const width = Math.min(Math.max(anchor.width, minWidth), Math.max(0, viewport.width - margin * 2))
  // Sağ kenardan taşarsa içeri çekilir — ekran dışında kalan liste seçilemez.
  const left = Math.max(margin, Math.min(anchor.left, viewport.width - width - margin))

  const below = viewport.height - anchor.bottom - margin
  const above = anchor.top - margin
  // Aşağıda yer kalmadıysa yukarı açılır (sayfa sonundaki kalem satırı).
  const openUp = below < flipThreshold && above > below
  const maxHeight = Math.max(120, Math.min(maxHeightCap, openUp ? above : below))

  return {
    top: openUp ? anchor.top - 4 - maxHeight : anchor.bottom + 4,
    left,
    width,
    maxHeight,
  }
}
