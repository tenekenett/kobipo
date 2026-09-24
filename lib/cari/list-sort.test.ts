import { describe, expect, it } from "vitest"
import { nextCariListSort, parseCariListSort, sortCariRows } from "@/lib/cari/list-sort"

const rows = [
  { name: "Çınar", balance: 100 },
  { name: "Ahmet", balance: -50 },
  { name: "Zeki", balance: 0.1 + 0.2 },
  { name: "Bora", balance: 0.3 },
  { name: "İpek", balance: 2500 },
]

describe("sortCariRows", () => {
  it("çoktan aza: en büyük alacak üstte, eksi bakiye en altta", () => {
    expect(sortCariRows(rows, "balance_desc").map((r) => r.name)).toEqual(["İpek", "Çınar", "Bora", "Zeki", "Ahmet"])
  })
  it("azdan çoka: tersi; kayan nokta artığı eşitliği bozmaz, eşitlikte ad belirler", () => {
    expect(sortCariRows(rows, "balance_asc").map((r) => r.name)).toEqual(["Ahmet", "Bora", "Zeki", "Çınar", "İpek"])
  })
  it("ada göre: sorgunun sırası korunur, dizi kopyalanmaz", () => {
    expect(sortCariRows(rows, "name")).toBe(rows)
  })
})

describe("sıralama döngüsü ve girdi", () => {
  it("ada göre → çoktan aza → azdan çoka → ada göre", () => {
    expect(nextCariListSort("name")).toBe("balance_desc")
    expect(nextCariListSort("balance_desc")).toBe("balance_asc")
    expect(nextCariListSort("balance_asc")).toBe("name")
  })
  it("tanınmayan değer ada göre sayılır", () => {
    expect(parseCariListSort("DROP TABLE")).toBe("name")
    expect(parseCariListSort(null)).toBe("name")
    expect(parseCariListSort("balance_asc")).toBe("balance_asc")
  })
})
