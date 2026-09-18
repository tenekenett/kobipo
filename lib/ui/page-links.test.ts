import { describe, expect, it } from "vitest"
import { pageLinks } from "./page-links"

describe("pageLinks", () => {
  it("pencereye sığan liste olduğu gibi çıkar", () => {
    expect(pageLinks(1, 1)).toEqual([1])
    expect(pageLinks(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(pageLinks(10, 10)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it("1. sayfada 10'luk pencere, dört ileri sıçrama ve son sayfa", () => {
    expect(pageLinks(1, 26475)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 50, 26475])
  })

  it("ortada pencere geçerli sayfayı çevreler, iki yöne sıçrar", () => {
    expect(pageLinks(37, 100)).toEqual([
      1, 10, 20, 30, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 50, 60, 70, 80, 100,
    ])
  })

  it("son sayfada pencere geriye kayar, ileri sıçrama yok", () => {
    expect(pageLinks(15, 15)).toEqual([1, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
  })

  it("sıçrama pencereyle çakışmaz, son sayfayı aşmaz", () => {
    // Pencere 1..10; 20 son sayfa olduğu için tek ileri sıçrama.
    expect(pageLinks(1, 20)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20])
    // Pencere 11..20; geri 10, ileri 30 40 (50 > 45).
    expect(pageLinks(15, 45)).toEqual([1, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 30, 40, 45])
  })

  it("sınır dışı sayfa içeri çekilir", () => {
    expect(pageLinks(0, 5)).toEqual([1, 2, 3, 4, 5])
    expect(pageLinks(99, 5)).toEqual([1, 2, 3, 4, 5])
  })
})
