import { describe, expect, it } from "vitest"
import { computeAnchoredRect } from "./anchored-menu"

const VIEWPORT = { width: 1280, height: 800 }

describe("computeAnchoredRect", () => {
  it("dar girdide liste taban genişliğe çıkar", () => {
    // Kalem satırındaki ürün sütunu ~220px; liste 360'a genişler.
    const rect = computeAnchoredRect({ top: 300, bottom: 340, left: 100, width: 220 }, VIEWPORT)
    expect(rect.width).toBe(360)
    expect(rect.top).toBe(344)
  })

  it("girdi tabandan genişse listeyi daraltmaz", () => {
    const rect = computeAnchoredRect({ top: 300, bottom: 340, left: 100, width: 640 }, VIEWPORT)
    expect(rect.width).toBe(640)
  })

  it("sağ kenardan taşan liste içeri çekilir", () => {
    const rect = computeAnchoredRect({ top: 300, bottom: 340, left: 1150, width: 220 }, VIEWPORT)
    expect(rect.left).toBe(1280 - 360 - 8)
    expect(rect.left + rect.width).toBeLessThanOrEqual(1280 - 8)
  })

  it("aşağıda yer yoksa yukarı açılır", () => {
    // Sayfanın dibindeki satır: altta 40px, üstte 740px yer var.
    const rect = computeAnchoredRect({ top: 720, bottom: 752, left: 100, width: 220 }, VIEWPORT)
    expect(rect.top).toBeLessThan(720)
    expect(rect.top + rect.maxHeight).toBeLessThanOrEqual(720)
  })

  it("dar pencerede liste ekranı taşmaz", () => {
    const rect = computeAnchoredRect(
      { top: 100, bottom: 140, left: 10, width: 300 },
      { width: 320, height: 640 }
    )
    expect(rect.width).toBe(304)
    expect(rect.left).toBe(8)
  })

  it("çok sığ alanda bile kullanılabilir yükseklik kalır", () => {
    const rect = computeAnchoredRect(
      { top: 40, bottom: 80, left: 100, width: 220 },
      { width: 1280, height: 140 }
    )
    expect(rect.maxHeight).toBeGreaterThanOrEqual(120)
  })
})
