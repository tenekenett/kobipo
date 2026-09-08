import { describe, expect, it } from "vitest"
import {
  cariUpdateData,
  customerHeaderAliases,
  describeMatchConflict,
  normalizeHeader,
  parseAmountCell,
  pickMatch,
  productHeaderAliases,
  productUpdateData,
  readCell,
} from "@/lib/import/rows"

/** Bir satırı başlıklarıyla birlikte `get(anahtar)` biçimine çevirir. */
function getterFor(headerRow: string[], row: string[], aliases: Record<string, string[]>) {
  const headers = headerRow.map((value) => normalizeHeader(value))
  return (key: string) => readCell(headers, row, aliases, key)
}

/**
 * Dışa aktarımın (`lib/export/datasets/products.ts`) ürün başlıkları. İçe
 * aktarım bunları tanımak ZORUNDA: kullanıcının fiyat güncelleme yolu listeyi
 * Excel'e aktarıp düzeltip geri yüklemektir.
 */
const PRODUCT_EXPORT_HEADERS = [
  "Kod",
  "Ürün Adı",
  "Barkod",
  "Raf No",
  "Kategori",
  "Birim",
  "Stok",
  "Min. Stok",
  "Alış Fiyatı",
  "Ort. Maliyet",
  "Satış Fiyatı",
  "Döviz",
  "KDV",
  "Stok Değeri",
  "Tür",
  "Aktif",
]

const PRODUCT_EXPORT_ROW = [
  "URUN-001",
  "Örnek Ürün",
  "8690000000001",
  "A-04",
  "İçecek",
  "ADET",
  "12",
  "3",
  "100",
  "104,50",
  "180",
  "TRY",
  "20",
  "1.254,00",
  "Ürün / Menü",
  "Evet",
]

describe("readCell — dışa aktarım başlıkları", () => {
  const get = getterFor(PRODUCT_EXPORT_HEADERS, PRODUCT_EXPORT_ROW, productHeaderAliases)

  it("'Ürün Adı' sütununu ad olarak tanır", () => {
    expect(get("name")).toBe("Örnek Ürün")
  })

  it("'Stok' ve 'KDV' kısaltmalarını tanır", () => {
    expect(get("stockquantity")).toBe("12")
    expect(get("vatrate")).toBe("20")
  })

  it("şablondaki uzun adlar da geçerli kalır", () => {
    const templateGet = getterFor(
      ["Ad", "Stok Miktarı", "KDV Oranı", "Satış Fiyatı"],
      ["Örnek Ürün", "12", "20", "180"],
      productHeaderAliases,
    )
    expect(templateGet("name")).toBe("Örnek Ürün")
    expect(templateGet("stockquantity")).toBe("12")
    expect(templateGet("vatrate")).toBe("20")
  })

  it("cari dışa aktarımının 'Müşteri Ünvanı' ve 'VKN/TCKN' başlıklarını tanır", () => {
    const cariGet = getterFor(
      ["Kod", "Müşteri Ünvanı", "VKN/TCKN", "Yetkili"],
      ["CARI-001", "ABC A.Ş.", "1234567890", "Ahmet Yılmaz"],
      customerHeaderAliases,
    )
    expect(cariGet("name")).toBe("ABC A.Ş.")
    expect(cariGet("taxnumber")).toBe("1234567890")
    expect(cariGet("contactperson")).toBe("Ahmet Yılmaz")
  })

  it("bilinmeyen sütun boş döner (sessizce başka alana yazılmaz)", () => {
    expect(get("minstocklevel")).toBe("3")
    expect(getterFor(["Kod"], ["X"], productHeaderAliases)("saleprice")).toBe("")
  })
})

describe("parseAmountCell — sessiz sıfır yok", () => {
  it("para birimi simgesi/eki taşıyan hücreyi okur", () => {
    // 2026-09-08: 518 ürün tam da bu yüzden 0 fiyatla açıldı. XLSX `raw: false`
    // ile okunuyor, yani Excel'de para birimi biçimli sütun buraya böyle geliyor.
    expect(parseAmountCell("2.094,70 ₺", "Alış Fiyatı")).toBe(2094.7)
    expect(parseAmountCell("₺2.094,70", "Alış Fiyatı")).toBe(2094.7)
    expect(parseAmountCell("2.094,70 TL", "Alış Fiyatı")).toBe(2094.7)
    expect(parseAmountCell("2,094.70", "Alış Fiyatı")).toBe(2094.7)
    expect(parseAmountCell("1 234,56", "Alış Fiyatı")).toBe(1234.56)
  })

  it("yüzde işaretli KDV hücresini okur", () => {
    expect(parseAmountCell("%20", "KDV Oranı")).toBe(20)
    expect(parseAmountCell("20,00%", "KDV Oranı")).toBe(20)
  })

  it("muhasebe biçiminin tiresi sıfırdır", () => {
    expect(parseAmountCell("-", "Satış Fiyatı")).toBe(0)
  })

  it("boş hücre undefined döner (varsayılan/değiştirme)", () => {
    expect(parseAmountCell("", "Satış Fiyatı")).toBeUndefined()
    expect(parseAmountCell("  ", "Satış Fiyatı")).toBeUndefined()
    expect(parseAmountCell("₺", "Satış Fiyatı")).toBeUndefined()
  })

  it("okunamayan hücre 0 YAZMAZ, sütun adıyla hata verir", () => {
    expect(() => parseAmountCell("fiyat yok", "Satış Fiyatı")).toThrow(
      /"Satış Fiyatı" sütunu sayı değil: "fiyat yok"/,
    )
  })
})

const ELMA = { id: "p1", name: "Elma", barcode: "111", code: "URUN-1" }
const ARMUT = { id: "p2", name: "Armut", barcode: "222", code: "URUN-2" }

const productRules = (row: { name?: string; barcode?: string; code?: string }) => [
  { by: "ad", value: row.name ?? "", of: (record: typeof ELMA) => record.name },
  { by: "barkod", value: row.barcode ?? "", of: (record: typeof ELMA) => record.barcode },
  { by: "kod", value: row.code ?? "", of: (record: typeof ELMA) => record.code },
]

describe("pickMatch", () => {
  it("hiçbir anahtar tutmazsa yeni kayıt", () => {
    expect(pickMatch([ELMA], productRules({ name: "Muz" })).status).toBe("new")
  })

  it("kod ve barkod boşken ada göre eşleşir", () => {
    const outcome = pickMatch([ELMA, ARMUT], productRules({ name: "Elma" }))
    expect(outcome).toMatchObject({ status: "match", by: "ad", record: { id: "p1" } })
  })

  it("ad değişmişse barkoddan bulur (yeniden adlandırma)", () => {
    const outcome = pickMatch([ELMA], productRules({ name: "Elma (Granny)", barcode: "111" }))
    expect(outcome).toMatchObject({ status: "match", by: "barkod", record: { id: "p1" } })
  })

  it("ad ve barkod yoksa koda düşer", () => {
    const outcome = pickMatch([ELMA], productRules({ name: "Yeşil Elma", code: "URUN-1" }))
    expect(outcome).toMatchObject({ status: "match", by: "kod", record: { id: "p1" } })
  })

  it("büyük/küçük harf ve boşluk farkı aynı kayıttır", () => {
    const outcome = pickMatch([ELMA], productRules({ name: "  ELMA " }))
    expect(outcome).toMatchObject({ status: "match", by: "ad" })
  })

  it("ad bir kaydı, barkod başka kaydı tutuyorsa karar verilmez", () => {
    const outcome = pickMatch([ELMA, ARMUT], productRules({ name: "Elma", barcode: "222" }))
    expect(outcome.status).toBe("conflict")
    if (outcome.status !== "conflict") return
    expect(describeMatchConflict(outcome.hits)).toContain("barkod")
    expect(describeMatchConflict(outcome.hits)).toContain("Armut")
  })

  it("aynı kaydı gösteren iki anahtar çakışma değildir", () => {
    const outcome = pickMatch([ELMA], productRules({ name: "Elma", barcode: "111", code: "URUN-1" }))
    expect(outcome).toMatchObject({ status: "match", by: "ad", record: { id: "p1" } })
  })
})

describe("productUpdateData", () => {
  const priceOnly = getterFor(
    ["Ad", "Satış Fiyatı"],
    ["Örnek Ürün", "199,90"],
    productHeaderAliases,
  )

  it("yalnızca dolu gelen sütunları yazar", () => {
    expect(productUpdateData(priceOnly, { updateStock: false, matchedByName: false })).toEqual({
      name: "Örnek Ürün",
      salePrice: 199.9,
    })
  })

  it("ada göre eşleşen satırda adı YENİDEN YAZMAZ", () => {
    // Eşleştirme büyük/küçük harfe bakmıyor; ad yine yazılsaydı ürünleri "ELMA"
    // diye yazan bir fiyat listesi bütün kartları büyük harfe çevirirdi.
    const bagiran = getterFor(["Ad", "Satış Fiyatı"], ["ÖRNEK ÜRÜN", "199,90"], productHeaderAliases)
    expect(productUpdateData(bagiran, { updateStock: false, matchedByName: true })).toEqual({
      salePrice: 199.9,
    })
  })

  it("barkoddan eşleşen satırda ad yazılır (kasıtlı yeniden adlandırma)", () => {
    expect(productUpdateData(priceOnly, { updateStock: false, matchedByName: false })).toMatchObject(
      { name: "Örnek Ürün" },
    )
  })

  it("dosyada olmayan sütun için alanı boşaltmaz", () => {
    const data = productUpdateData(priceOnly, { updateStock: false, matchedByName: false })
    expect(data).not.toHaveProperty("barcode")
    expect(data).not.toHaveProperty("shelfCode")
    expect(data).not.toHaveProperty("vatRate")
  })

  it("boş hücre 'değiştirme' demektir", () => {
    const get = getterFor(
      ["Ad", "Satış Fiyatı", "Barkod"],
      ["Örnek Ürün", "199,90", ""],
      productHeaderAliases,
    )
    expect(productUpdateData(get, { updateStock: false, matchedByName: false })).not.toHaveProperty("barcode")
  })

  it("stok miktarı varsayılan olarak YAZILMAZ", () => {
    const get = getterFor(PRODUCT_EXPORT_HEADERS, PRODUCT_EXPORT_ROW, productHeaderAliases)
    expect(productUpdateData(get, { updateStock: false, matchedByName: false })).not.toHaveProperty("stockQuantity")
  })

  it("istendiğinde stok miktarı da yazılır", () => {
    const get = getterFor(PRODUCT_EXPORT_HEADERS, PRODUCT_EXPORT_ROW, productHeaderAliases)
    expect(productUpdateData(get, { updateStock: true, matchedByName: false })).toMatchObject({ stockQuantity: 12 })
  })

  it("Türkçe binlik/ondalık ayracını çözer", () => {
    const get = getterFor(["Ad", "Alış Fiyatı"], ["X", "1.234,56"], productHeaderAliases)
    expect(productUpdateData(get, { updateStock: false, matchedByName: false })).toMatchObject({ purchasePrice: 1234.56 })
  })
})

describe("cariUpdateData", () => {
  it("açılış bakiyesi gelmediyse bakiye türüne dokunmaz", () => {
    const get = getterFor(["Ad", "Telefon"], ["ABC A.Ş.", "0212"], customerHeaderAliases)
    const data = cariUpdateData(get, { matchedByName: false })
    expect(data).toEqual({ name: "ABC A.Ş.", phone: "0212" })
    expect(data).not.toHaveProperty("openingBalanceType")
  })

  it("açılış bakiyesi geldiyse tür de birlikte yazılır", () => {
    const get = getterFor(
      ["Ad", "Açılış Bakiyesi", "Bakiye Türü"],
      ["ABC A.Ş.", "15.000,00", "Alacak"],
      customerHeaderAliases,
    )
    expect(cariUpdateData(get, { matchedByName: false })).toMatchObject({
      openingBalanceAmount: 15000,
      openingBalanceType: "CREDIT",
    })
  })

  it("vade gün tam sayıya iner ve negatif olmaz", () => {
    const get = getterFor(["Ad", "Vade (gün)"], ["ABC", "-4,7"], customerHeaderAliases)
    expect(cariUpdateData(get, { matchedByName: false })).toMatchObject({ paymentDueDays: 0 })
  })
})
