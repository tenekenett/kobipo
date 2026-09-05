import { describe, expect, it } from "vitest"
import {
  UNCATEGORIZED_EXPENSE_LABEL,
  buildExpenseTree,
  splitCategory,
  type ExpenseTreeEntry,
} from "./harcamalar-kirilim"

function entry(category: string | null, amount: number, count = 1): ExpenseTreeEntry {
  return { category, amount, count }
}

describe("kategori ayrıştırma", () => {
  it("ayraç varsa ana ve alt kategoriye böler", () => {
    expect(splitCategory("Personel > Maaş")).toEqual({ main: "Personel", sub: "Maaş" })
  })

  it("ayraç yoksa tek seviyeli kalır", () => {
    expect(splitCategory("Kira")).toEqual({ main: "Kira", sub: null })
  })

  it("boşluksuz yazım da çalışır", () => {
    expect(splitCategory("Ofis>Kırtasiye")).toEqual({ main: "Ofis", sub: "Kırtasiye" })
  })

  /** Kullanıcının yarım bıraktığı metin adı boş bir alt kategori üretmemeli. */
  it("ayracın bir tarafı boşsa o taraf yok sayılır", () => {
    expect(splitCategory("Personel >")).toEqual({ main: "Personel", sub: null })
    expect(splitCategory("> Maaş")).toEqual({ main: "Maaş", sub: null })
  })

  it("iki seviyeden derini alt kategoride toplanır", () => {
    expect(splitCategory("Personel > Maaş > İkramiye")).toEqual({
      main: "Personel",
      sub: "Maaş > İkramiye",
    })
  })

  it("boş/eksik kategori 'Kategorisiz'e düşer", () => {
    expect(splitCategory(null).main).toBe(UNCATEGORIZED_EXPENSE_LABEL)
    expect(splitCategory("   ").main).toBe(UNCATEGORIZED_EXPENSE_LABEL)
  })
})

describe("harcama kategori ağacı", () => {
  /**
   * Ağacın var oluş sebebi: gelir-gider raporunun düz listesinde "Personel >
   * Maaş" ve "Personel > SGK" iki ayrı satırdır ve "personele toplam ne
   * ödedim" sorusu cevapsız kalır.
   */
  it("aynı ana kategorinin altlarını tek başlıkta toplar", () => {
    const tree = buildExpenseTree([
      entry("Personel > Maaş", 40_000),
      entry("Personel > SGK", 10_000),
      entry("Ofis > Kira", 25_000),
    ])

    expect(tree.total).toBe(75_000)
    const personel = tree.groups.find((group) => group.label === "Personel")
    expect(personel?.amount).toBe(50_000)
    expect(personel?.count).toBe(2)
    expect(personel?.children.map((child) => child.label)).toEqual(["Maaş", "SGK"])
  })

  it("ana kategoriler ve altları tutara göre sıralanır", () => {
    const tree = buildExpenseTree([
      entry("Ofis > Kira", 25_000),
      entry("Personel > SGK", 10_000),
      entry("Personel > Maaş", 40_000),
    ])

    expect(tree.groups.map((group) => group.label)).toEqual(["Personel", "Ofis"])
    expect(tree.groups[0].children.map((child) => child.label)).toEqual(["Maaş", "SGK"])
  })

  it("pay GENEL TOPLAMA göre hesaplanır — alt satırlar da kıyaslanabilsin", () => {
    const tree = buildExpenseTree([
      entry("Personel > Maaş", 40_000),
      entry("Personel > SGK", 10_000),
      entry("Ofis > Kira", 50_000),
    ])

    const personel = tree.groups.find((group) => group.label === "Personel")!
    expect(personel.sharePct).toBe(50)
    expect(personel.children.find((child) => child.label === "Maaş")?.sharePct).toBe(40)
  })

  it("tek seviyeli kategorinin çocuğu olmaz", () => {
    const tree = buildExpenseTree([entry("Kira", 12_000)])
    expect(tree.groups[0].children).toEqual([])
  })

  /** Farklı ana kategorilerin aynı adlı altları tek satıra düşmemeli. */
  it("iki ana kategorinin 'Diğer' altları ayrı satırlardır", () => {
    const tree = buildExpenseTree([
      entry("Personel > Diğer", 1_000),
      entry("Ofis > Diğer", 2_000),
    ])

    const keys = tree.groups.flatMap((group) => group.children.map((child) => child.key))
    expect(new Set(keys).size).toBe(2)
  })

  /** Alış iadesi gideri AZALTIR: eksi tutar kategoriden düşülmeli. */
  it("iade tutarı kategoriyi azaltır", () => {
    const tree = buildExpenseTree([
      entry("Hammadde", 30_000),
      entry("Hammadde", -5_000),
    ])

    expect(tree.groups[0].amount).toBe(25_000)
    expect(tree.total).toBe(25_000)
  })

  it("toplam sıfırken pay hesaplanmaz, 0 kalır", () => {
    const tree = buildExpenseTree([entry("Kira", 1_000), entry("Kira", -1_000)])
    expect(tree.total).toBe(0)
    expect(tree.groups[0].sharePct).toBe(0)
  })

  it("kategorisiz harcamalar kendi başlığında toplanır", () => {
    const tree = buildExpenseTree([entry(null, 500), entry("", 700)])
    expect(tree.groups).toHaveLength(1)
    expect(tree.groups[0]).toMatchObject({ label: UNCATEGORIZED_EXPENSE_LABEL, amount: 1_200, count: 2 })
  })

  it("grup toplamları genel toplamı tutar", () => {
    const tree = buildExpenseTree([
      entry("Personel > Maaş", 40_000),
      entry("Ofis > Kira", 25_000),
      entry("Yakıt", 7_500),
      entry(null, 1_250),
    ])
    const sum = tree.groups.reduce((acc, group) => acc + group.amount, 0)
    expect(sum).toBe(tree.total)
  })
})
