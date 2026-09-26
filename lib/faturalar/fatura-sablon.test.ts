import { describe, expect, it } from "vitest"
import {
  canonicalTaxNumber,
  expectedTotalMismatch,
  faturaSablonToplami,
  parseFaturaSablonu,
  parseSablonDate,
  sablonKolonlari,
  type SablonTuru,
} from "./fatura-sablon"

const HEADER = sablonKolonlari("alis").map((c) => c.label)
const parseAlisSablonu = (rows: unknown[][]) => parseFaturaSablonu(rows, "alis")
const alisSablonToplami = faturaSablonToplami

/** Başlık sırasına göre satır kurar: { "Fatura No": "A-1", ... } */
function row(values: Record<string, unknown>): unknown[] {
  return HEADER.map((label) => (label in values ? values[label] : null))
}

const base = {
  "Fatura No": "ABC2026000000001",
  "Fatura Tarihi": "05.09.2026",
  Tedarikçi: "Işık Gıda Ltd.",
  "Tedarikçi VKN/TCKN": "1234567890",
  "Ürün/Hizmet Adı": "Un",
  Miktar: 10,
  "Birim Fiyat": 100,
  "KDV %": 1,
}

describe("parseSablonDate", () => {
  it("Excel seri numarasını UTC günüyle çözer", () => {
    // 46270 = 2026-09-05
    expect(parseSablonDate(46270)).toBe("2026-09-05")
  })
  it("GG.AA.YYYY ve YYYY-AA-GG metnini okur", () => {
    expect(parseSablonDate("5.9.2026")).toBe("2026-09-05")
    expect(parseSablonDate("05/09/2026")).toBe("2026-09-05")
    expect(parseSablonDate("2026-09-05")).toBe("2026-09-05")
  })
  it("takvimde olmayan günü ve ABD biçimini reddeder", () => {
    expect(parseSablonDate("31.02.2026")).toBeNull()
    expect(parseSablonDate("9/5/26")).toBeNull()
  })
  it("boş hücre undefined döner", () => {
    expect(parseSablonDate("")).toBeUndefined()
    expect(parseSablonDate(null)).toBeUndefined()
  })
})

describe("parseFaturaSablonu — alış", () => {
  it("aynı Fatura No + VKN satırlarını tek faturada toplar", () => {
    const parsed = parseAlisSablonu([
      HEADER,
      row(base),
      row({ ...base, "Ürün/Hizmet Adı": "Şeker", Miktar: 2, "Birim Fiyat": 50, "KDV %": 10 }),
    ])
    expect(parsed.fileError).toBeNull()
    expect(parsed.invoices).toHaveLength(1)
    const inv = parsed.invoices[0]
    expect(inv.errors).toEqual([])
    expect(inv.lines.map((l) => l.description)).toEqual(["Un", "Şeker"])
    expect(inv.rows).toEqual([2, 3])
    expect(inv.date).toBe("2026-09-05")
    expect(inv.currency).toBe("TRY")
  })

  it("fatura bilgisi boş satırı önceki faturanın kalemi sayar", () => {
    const parsed = parseAlisSablonu([
      HEADER,
      row(base),
      row({ "Ürün/Hizmet Adı": "Nakliye", Miktar: 1, "Birim Fiyat": 250, "KDV %": 20 }),
    ])
    expect(parsed.invoices).toHaveLength(1)
    expect(parsed.invoices[0].lines).toHaveLength(2)
  })

  it("farklı tedarikçinin aynı numarası ayrı faturadır", () => {
    const parsed = parseAlisSablonu([
      HEADER,
      row(base),
      row({ ...base, Tedarikçi: "Başka A.Ş.", "Tedarikçi VKN/TCKN": "9876543210" }),
    ])
    expect(parsed.invoices).toHaveLength(2)
  })

  it("aynı faturada çelişen tarihi hata sayar, birini seçmez", () => {
    const parsed = parseAlisSablonu([HEADER, row(base), row({ ...base, "Fatura Tarihi": "06.09.2026" })])
    expect(parsed.invoices[0].errors.join(" ")).toContain("Fatura Tarihi")
  })

  it("ünvan farkını Türkçe duyarsız karşılaştırır", () => {
    const parsed = parseAlisSablonu([HEADER, row(base), row({ ...base, Tedarikçi: "IŞIK GIDA LTD." })])
    expect(parsed.invoices[0].errors).toEqual([])
  })

  it("okunamayan sayı satırı reddeder, sessizce 0 yazmaz", () => {
    const parsed = parseAlisSablonu([HEADER, row({ ...base, "Birim Fiyat": "yüz lira" })])
    const inv = parsed.invoices[0]
    expect(inv.lines).toHaveLength(0)
    expect(inv.errors.join(" ")).toContain("Birim Fiyat")
  })

  it("TL/₺ para birimini TRY'ye çevirir, dövizde kur ister", () => {
    expect(parseAlisSablonu([HEADER, row({ ...base, "Para Birimi": "TL" })]).invoices[0].currency).toBe("TRY")
    const usd = parseAlisSablonu([HEADER, row({ ...base, "Para Birimi": "usd" })]).invoices[0]
    expect(usd.errors.join(" ")).toContain("Döviz Kuru")
  })

  it("VKN hane sayısını denetler", () => {
    const inv = parseAlisSablonu([HEADER, row({ ...base, "Tedarikçi VKN/TCKN": "12345" })]).invoices[0]
    expect(inv.errors.join(" ")).toContain("10 ya da 11")
  })

  it("zorunlu sütun eksikse hiçbir satırı okumaz", () => {
    const header = HEADER.filter((h) => h !== "Birim Fiyat")
    const parsed = parseAlisSablonu([header, header.map(() => "x")])
    expect(parsed.missingColumns).toEqual(["Birim Fiyat"])
    expect(parsed.invoices).toEqual([])
  })

  it("takma ad başlıkları ve tanınmayan sütunu bildirir", () => {
    const parsed = parseAlisSablonu([
      ["Fatura No", "Tarih", "Cari Ünvanı", "Ürün Adı", "Adet", "Fiyat", "KDV Oranı", "Depo"],
      ["F-1", "01.09.2026", "Deneme", "Kalem", 1, 10, 20, "Merkez"],
    ])
    expect(parsed.missingColumns).toEqual([])
    expect(parsed.unknownColumns).toEqual(["Depo"])
    expect(parsed.invoices[0].errors).toEqual([])
  })

  it("İskonto % doluysa yüzde, yalnız tutar doluysa tutar iskontosu", () => {
    const parsed = parseAlisSablonu([
      HEADER,
      row({ ...base, "İskonto %": 10, "İskonto Tutarı": 100 }),
      row({ ...base, "Ürün/Hizmet Adı": "Şeker", "İskonto Tutarı": 25 }),
    ])
    const [a, b] = parsed.invoices[0].lines
    expect(a).toMatchObject({ discountMode: "PERCENT", discountRate: 10, discountAmount: 0 })
    expect(b).toMatchObject({ discountMode: "AMOUNT", discountRate: 0, discountAmount: 25 })
  })
})

describe("faturaSablonToplami / expectedTotalMismatch", () => {
  it("toplamı belge kuralıyla hesaplar ve Genel Toplam'ı denetler", () => {
    const parsed = parseAlisSablonu([
      HEADER,
      row({ ...base, "Genel Toplam": 1010 }),
      row({ "Ürün/Hizmet Adı": "Nakliye", Miktar: 1, "Birim Fiyat": 250, "KDV %": 20 }),
    ])
    const inv = parsed.invoices[0]
    const totals = alisSablonToplami(inv)
    // 1000 + %1 = 1010; 250 + %20 = 300
    expect(totals).toEqual({ net: 1250, vat: 60, total: 1310 })
    expect(expectedTotalMismatch(inv, totals.total)).toContain("1.010,00")
    expect(expectedTotalMismatch({ ...inv, expectedTotal: 1310 }, totals.total)).toBeNull()
    expect(expectedTotalMismatch({ ...inv, expectedTotal: null }, totals.total)).toBeNull()
  })

  it("fatura altı iskonto matrahtan düşer", () => {
    const inv = parseAlisSablonu([HEADER, row({ ...base, "Fatura Altı İskonto": 100 })]).invoices[0]
    expect(alisSablonToplami(inv)).toEqual({ net: 900, vat: 9, total: 909 })
  })
})

describe("parseFaturaSablonu — satış ve ihracat", () => {
  const header = (tur: SablonTuru) => sablonKolonlari(tur).map((c) => c.label)
  const srow = (tur: SablonTuru, values: Record<string, unknown>) =>
    header(tur).map((label) => (label in values ? values[label] : null))
  const sale = {
    "Fatura No": "SAT2026000000001",
    "Fatura Tarihi": "10.09.2026",
    Müşteri: "Örnek Müşteri",
    "Müşteri VKN/TCKN": "9876543210",
    "Ürün/Hizmet Adı": "Silindir",
    Miktar: 2,
    "Birim Fiyat": 100,
    "KDV %": 20,
  }

  it("alış şablonu satış içe aktarımında reddedilir (Müşteri sütunu yok)", () => {
    const parsed = parseFaturaSablonu([HEADER, row(base)], "satis")
    expect(parsed.missingColumns).toContain("Müşteri")
    expect(parsed.invoices).toEqual([])
  })

  it("satışta aynı numara tek fatura; farklı müşteri hata", () => {
    const parsed = parseFaturaSablonu(
      [header("satis"), srow("satis", sale), srow("satis", { ...sale, Müşteri: "Başka", "Müşteri VKN/TCKN": "1111111111" })],
      "satis",
    )
    expect(parsed.invoices).toHaveLength(1)
    expect(parsed.invoices[0].errors.join(" ")).toContain("Müşteri")
  })

  it("istisna kodu yalnız %0 KDV'li kalemde", () => {
    const parsed = parseFaturaSablonu([header("satis"), srow("satis", { ...sale, "KDV İstisna Kodu": "351" })], "satis")
    expect(parsed.invoices[0].errors.join(" ")).toContain("yalnız %0")
    const ok = parseFaturaSablonu(
      [header("satis"), srow("satis", { ...sale, "KDV %": 0, "KDV İstisna Kodu": "351" })],
      "satis",
    )
    expect(ok.invoices[0].errors).toEqual([])
    expect(ok.invoices[0].lines[0].exemptionCode).toBe("351")
  })

  it("ihracat: KDV boşsa 0, istisna boşsa 301; yabancı vergi no kabul", () => {
    const parsed = parseFaturaSablonu(
      [
        header("ihracat"),
        srow("ihracat", {
          ...sale,
          "KDV %": null,
          Müşteri: "Example GmbH",
          "Müşteri VKN/TCKN": "de 123 456 789",
          Ülke: "Almanya",
          "Para Birimi": "EUR",
          "Döviz Kuru": 38.5,
        }),
      ],
      "ihracat",
    )
    const inv = parsed.invoices[0]
    expect(inv.errors).toEqual([])
    expect(inv.counterpartyTaxNumber).toBe("DE123456789")
    expect(inv.country).toBe("Almanya")
    expect(inv.lines[0]).toMatchObject({ vatRate: 0, exemptionCode: "301" })
  })

  it("ihracat: sıfırdan farklı KDV reddedilir", () => {
    const parsed = parseFaturaSablonu([header("ihracat"), srow("ihracat", sale)], "ihracat")
    expect(parsed.invoices[0].errors.join(" ")).toContain("KDV %0")
    // Hatalı kaleme varsayılan 301 yazılmaz → ikinci ("yalnız %0") hata çıkmaz.
    expect(parsed.invoices[0].errors).toHaveLength(1)
  })

  it("satışta VKN harf içeremez", () => {
    const parsed = parseFaturaSablonu([header("satis"), srow("satis", { ...sale, "Müşteri VKN/TCKN": "DE123456789" })], "satis")
    expect(parsed.invoices[0].errors.join(" ")).toContain("10 ya da 11")
  })

  it("canonicalTaxNumber boşluk/ayraç atar, harfi korur", () => {
    expect(canonicalTaxNumber(" 123-456 7890 ")).toBe("1234567890")
    expect(canonicalTaxNumber("atu12345678")).toBe("ATU12345678")
  })
})
