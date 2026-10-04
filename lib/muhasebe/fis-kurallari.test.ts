// Belge → taslak yevmiye fişi kural motoru (fis-kurallari.ts).
//
// Kalemler `createInvoiceFromBody` gibi saklanır (satır iskontosu düşülmüş net
// üzerinden `computeLineTax`, kuruşa yuvarlı); belge toplamı da belgenin kendi
// hesabından (`computeInvoiceTotals`) gelir — motorun fişi onunla tutmalı.

import { describe, expect, it } from "vitest"
import { computeLineTax } from "@/lib/invoice/line-tax"
import { computeInvoiceTotals } from "@/lib/invoice/document-totals"
import { belgeFisTaslagi, type FisBelgesi, type FisKalemi, type FisTaslagi, type HesapEslesmeleri } from "./fis-kurallari"

const r2 = (n: number) => Math.round(n * 100) / 100

type KalemGirdisi = {
  quantity: number
  unitPrice: number
  vatRate: number
  discountAmount?: number
  withholdingRate?: number
  exciseRate?: number
  gekapUnitAmount?: number
  productId?: string | null
  urunHizmetMi?: boolean | null
}

function kalem(g: KalemGirdisi): FisKalemi {
  const brut = g.quantity * g.unitPrice
  const disc = g.discountAmount ?? 0
  const tax = computeLineTax(brut - disc, {
    vatRate: g.vatRate,
    exciseRate: g.exciseRate ?? 0,
    withholdingRate: g.withholdingRate ?? 0,
    quantity: g.quantity,
    gekapUnitAmount: g.gekapUnitAmount ?? 0,
  })
  return {
    quantity: g.quantity,
    unitPrice: g.unitPrice,
    discountAmount: disc,
    vatRate: g.vatRate,
    withholdingRate: g.withholdingRate ?? 0,
    gekapAmount: r2(tax.gekap),
    vatAmount: r2(tax.vat),
    withholdingAmount: r2(tax.withholding),
    exciseAmount: r2(tax.excise),
    totalAmount: r2(tax.total),
    productId: g.productId ?? null,
    urunHizmetMi: g.urunHizmetMi ?? null,
  }
}

function belge(over: Partial<FisBelgesi> & { kalemGirdileri: KalemGirdisi[] }): FisBelgesi {
  const { kalemGirdileri, ...rest } = over
  const kalemler = kalemGirdileri.map(kalem)
  const toplam = computeInvoiceTotals(
    kalemGirdileri.map((k) => ({ ...k })),
    {
      globalDiscountAmount: (rest.globalDiscountAmount as number) ?? 0,
      globalChargeAmount: (rest.globalChargeAmount as number) ?? 0,
      payableRoundingAmount: (rest.payableRoundingAmount as number) ?? 0,
    },
    { receipt: rest.isReceipt ?? false },
  ).total
  return {
    id: "f1",
    no: "MTB2026000001",
    tarih: "2026-09-30T00:00:00.000Z",
    type: "SALES",
    returnKind: null,
    isReceipt: false,
    status: "DRAFT",
    invoiceType: "MANUAL",
    currency: "TRY",
    exchangeRate: null,
    totalAmount: toplam,
    cari: { id: "c1", ad: "Deneme Müşteri" },
    kalemler,
    ...rest,
  }
}

const bos: HesapEslesmeleri = { ogrenilen: {}, cariHesaplari: { c1: "120.01.0001", s1: "320.01.0001" } }

function hazir(t: FisTaslagi) {
  if (t.durum !== "hazir") throw new Error(`fiş hazır değil: ${t.durum}`)
  return t
}

/** Fişi okunur özet: "B 120.01.0001 12000" … */
const ozet = (t: FisTaslagi) => hazir(t).satirlar.map((s) => `${s.taraf} ${s.hesapKodu ?? `?${s.oneriKodu}`} ${s.tutar}`)

function dengeli(t: FisTaslagi) {
  const f = hazir(t)
  expect(f.borcToplami).toBe(f.alacakToplami)
  expect(f.satirlar.every((s) => s.tutar > 0)).toBe(true)
  expect(Math.abs(f.belgeFarki)).toBeLessThanOrEqual(0.02)
}

describe("satış", () => {
  it("Aposkal örneği: danışmanlık 10.000 + %20 KDV", () => {
    const t = belgeFisTaslagi(
      belge({ kalemGirdileri: [{ quantity: 1, unitPrice: 10000, vatRate: 20, productId: "p1", urunHizmetMi: true }] }),
      bos,
    )
    expect(ozet(t)).toEqual(["B 120.01.0001 12000", "A 600 10000", "A 391 2000"])
    dengeli(t)
    // Satış ve KDV varsayılanı güvenli, cari hesabı belli → toplu onaya uygun.
    expect(hazir(t).emin).toBe(true)
  })

  it("alıcının tevkif ettiği KDV 391'e girmez; cari tevkifat düşülmüş toplamla", () => {
    const t = belgeFisTaslagi(
      belge({ kalemGirdileri: [{ quantity: 1, unitPrice: 10000, vatRate: 20, withholdingRate: 50 }] }),
      bos,
    )
    expect(ozet(t)).toEqual(["B 120.01.0001 11000", "A 600 10000", "A 391 1000"])
    dengeli(t)
  })

  it("ÖTV 360'a, KDV ÖTV dahil matrahtan", () => {
    const t = belgeFisTaslagi(
      belge({ kalemGirdileri: [{ quantity: 1, unitPrice: 1000, vatRate: 20, exciseRate: 25 }] }),
      bos,
    )
    expect(ozet(t)).toEqual(["B 120.01.0001 1500", "A 600 1000", "A 391 250", "A 360 250"])
    dengeli(t)
  })

  it("fatura altı iskonto satırlara dağıtılmış okunur (SAT-2026-0120)", () => {
    const t = belgeFisTaslagi(
      belge({ globalDiscountAmount: 726.98, kalemGirdileri: [{ quantity: 1, unitPrice: 2692.5, vatRate: 20 }] }),
      bos,
    )
    expect(ozet(t)).toEqual(["B 120.01.0001 2358.62", "A 600 1965.52", "A 391 393.1"])
    dengeli(t)
  })

  it("KDV oranı başına ayrı satır; aynı hesaba düşen satış birleşir", () => {
    const t = belgeFisTaslagi(
      belge({
        kalemGirdileri: [
          { quantity: 2, unitPrice: 100, vatRate: 20, productId: "p1" },
          { quantity: 1, unitPrice: 50, vatRate: 10, productId: "p2" },
        ],
      }),
      bos,
    )
    expect(ozet(t)).toEqual(["B 120.01.0001 295", "A 600 250", "A 391 40", "A 391 5"])
    const satis = hazir(t).satirlar.find((s) => s.rol === "SATIS")!
    expect(satis.anahtarlar).toEqual(["satis:urun:p1", "satis:urun:p2"])
    dengeli(t)
  })

  it("öğrenilen hesap varsayılanı ezer (ürün ve KDV oranı)", () => {
    const t = belgeFisTaslagi(
      belge({ kalemGirdileri: [{ quantity: 1, unitPrice: 100, vatRate: 20, productId: "p1" }] }),
      { ...bos, ogrenilen: { "satis:urun:p1": "600.01.002", "satis:kdv:20": "391.01.001" } },
    )
    expect(ozet(t)).toEqual(["B 120.01.0001 120", "A 600.01.002 100", "A 391.01.001 20"])
    expect(hazir(t).satirlar.filter((s) => s.rol !== "CARI").every((s) => s.kaynak === "ogrenilen")).toBe(true)
  })

  it("carisiz fiş: cari satırı ortak perakende alt hesabına gider (çözümde açılır)", () => {
    const t = belgeFisTaslagi(
      belge({ isReceipt: true, cari: null, kalemGirdileri: [{ quantity: 1, unitPrice: 50, vatRate: 10 }] }),
      bos,
    )
    expect(ozet(t)).toEqual(["B ?120 55", "A 600 50", "A 391 5"])
    expect(hazir(t).satirlar[0].aciklama).toBe("Perakende (cari yok)")
    expect(hazir(t).satirlar[0].alt).toEqual({ tur: "musteri", id: null, ad: "Perakende Müşteriler" })
    // Perakende alt hesabı kesin bir hesaptır; fiş tahmin içermiyor → toplu onaya girer.
    expect(hazir(t).emin).toBe(true)
    dengeli(t)
  })

  it("cari satırı carinin alt hesap referansını taşır", () => {
    const t = belgeFisTaslagi(belge({ kalemGirdileri: [{ quantity: 1, unitPrice: 100, vatRate: 20 }] }), {
      ogrenilen: {},
      cariHesaplari: {},
    })
    const cari = hazir(t).satirlar.find((s) => s.rol === "CARI")!
    expect(cari.hesapKodu).toBeNull()
    expect(cari.alt).toEqual({ tur: "musteri", id: "c1", ad: "Deneme Müşteri" })
    expect(hazir(t).emin).toBe(true)
  })

  it("belge yuvarlaması lehimize 649'a", () => {
    const t = belgeFisTaslagi(
      belge({ isReceipt: true, payableRoundingAmount: 0.02, kalemGirdileri: [{ quantity: 1, unitPrice: 100, vatRate: 10 }] }),
      bos,
    )
    expect(ozet(t)).toEqual(["B 120.01.0001 110.02", "A 600 100", "A 391 10", "A 649 0.02"])
    dengeli(t)
  })

  it("satış iadesi: 610 ve 391 borç, cari alacak", () => {
    const t = belgeFisTaslagi(
      belge({ type: "RETURN", returnKind: "SALES", kalemGirdileri: [{ quantity: 1, unitPrice: 1000, vatRate: 20 }] }),
      bos,
    )
    expect(ozet(t)).toEqual(["B 610 1000", "B 391 200", "A 120.01.0001 1200"])
    dengeli(t)
  })
})

describe("alış", () => {
  const alis = (over: Partial<FisBelgesi> & { kalemGirdileri: KalemGirdisi[] }) =>
    belge({ type: "PURCHASE", cari: { id: "s1", ad: "Kırtasiye Ltd." }, ...over })

  it("Aposkal örneği: kırtasiye 1.000 + %20, kartsız kalem → 770 (tahmin)", () => {
    const t = belgeFisTaslagi(alis({ kalemGirdileri: [{ quantity: 1, unitPrice: 1000, vatRate: 20 }] }), bos)
    expect(ozet(t)).toEqual(["B 770 1000", "B 191 200", "A 320.01.0001 1200"])
    const gider = hazir(t).satirlar.find((s) => s.rol === "ALIS")!
    expect(gider.kaynak).toBe("varsayilan")
    expect(gider.anahtarlar).toEqual(["alis:cari-kdv:s1:20"])
    // Alış varsayılanı tahmindir → toplu onaya girmez.
    expect(hazir(t).emin).toBe(false)
    dengeli(t)
  })

  it("öğrenilen cari + KDV oranı eşleşmesiyle fiş emin olur", () => {
    const t = belgeFisTaslagi(alis({ kalemGirdileri: [{ quantity: 1, unitPrice: 1000, vatRate: 20 }] }), {
      ...bos,
      ogrenilen: { "alis:cari-kdv:s1:20": "770.01.003" },
    })
    expect(ozet(t)).toEqual(["B 770.01.003 1000", "B 191 200", "A 320.01.0001 1200"])
    expect(hazir(t).emin).toBe(true)
  })

  it("stoklu ürün 153'e; ürün eşleşmesi cari eşleşmesinin önündedir", () => {
    const kalemler = [{ quantity: 10, unitPrice: 50, vatRate: 20, productId: "u1", urunHizmetMi: false }]
    expect(ozet(belgeFisTaslagi(alis({ kalemGirdileri: kalemler }), bos))).toEqual([
      "B 153 500",
      "B 191 100",
      "A 320.01.0001 600",
    ])
    const t = belgeFisTaslagi(alis({ kalemGirdileri: kalemler }), {
      ...bos,
      ogrenilen: { "alis:urun:u1": "150", "alis:cari-kdv:s1:20": "770" },
    })
    expect(ozet(t)[0]).toBe("B 150 500")
  })

  it("bizim tevkif ettiğimiz KDV: 191 tamamı, 320 tevkifat düşülmüş, 360 tevkifat", () => {
    const t = belgeFisTaslagi(
      alis({ kalemGirdileri: [{ quantity: 1, unitPrice: 10000, vatRate: 20, withholdingRate: 50 }] }),
      bos,
    )
    expect(ozet(t)).toEqual(["B 770 10000", "B 191 2000", "A 320.01.0001 11000", "A 360 1000"])
    dengeli(t)
  })

  it("alışta ÖTV ve GEKAP maliyete girer", () => {
    const t = belgeFisTaslagi(
      alis({
        kalemGirdileri: [
          { quantity: 1, unitPrice: 1000, vatRate: 20, exciseRate: 25, productId: "u1", urunHizmetMi: false },
          { quantity: 100, unitPrice: 2, vatRate: 20, gekapUnitAmount: 0.25, productId: "u2", urunHizmetMi: false },
        ],
      }),
      bos,
    )
    // 1.000 + 250 ÖTV + 200 + 25 GEKAP = 1.475 maliyet; KDV (1.250 + 225) × %20 = 295.
    expect(ozet(t)).toEqual(["B 153 1475", "B 191 295", "A 320.01.0001 1770"])
    dengeli(t)
  })

  it("eksi fiyatlı indirim kalemi atılmaz, netleşir (canlı: FS-ALI-2026-0009)", () => {
    const t = belgeFisTaslagi(
      alis({
        isReceipt: true,
        kalemGirdileri: [
          { quantity: 15, unitPrice: 116.666667, vatRate: 20 },
          { quantity: 1, unitPrice: -83.333333, vatRate: 20 },
        ],
      }),
      bos,
    )
    expect(ozet(t)).toEqual(["B 770 1666.67", "B 191 333.33", "A 320.01.0001 2000"])
    dengeli(t)
  })

  it("alış iadesi alışın tersidir", () => {
    const t = belgeFisTaslagi(
      alis({ type: "RETURN", returnKind: "PURCHASE", kalemGirdileri: [{ quantity: 1, unitPrice: 1000, vatRate: 20 }] }),
      bos,
    )
    expect(ozet(t)).toEqual(["B 320.01.0001 1200", "A 770 1000", "A 191 200"])
    dengeli(t)
  })
})

describe("belge kuralları", () => {
  it("dövizli belge faturadaki kurla TL'ye çevrilir; kur yoksa fiş kurulmaz", () => {
    const kalemGirdileri = [{ quantity: 1, unitPrice: 100, vatRate: 20 }]
    const t = belgeFisTaslagi(belge({ currency: "USD", exchangeRate: 30, kalemGirdileri }), bos)
    expect(ozet(t)).toEqual(["B 120.01.0001 3600", "A 600 3000", "A 391 600"])
    dengeli(t)
    expect(belgeFisTaslagi(belge({ currency: "USD", exchangeRate: null, kalemGirdileri }), bos).durum).toBe("kur-yok")
  })

  it("fişe giren belge = KDV'ye giren belge (iptal ve GİB'e gitmemiş e-belge girmez)", () => {
    const kalemGirdileri = [{ quantity: 1, unitPrice: 100, vatRate: 20 }]
    expect(belgeFisTaslagi(belge({ status: "CANCELLED", kalemGirdileri }), bos).durum).toBe("fise-girmez")
    expect(belgeFisTaslagi(belge({ invoiceType: "E_INVOICE", status: "DRAFT", kalemGirdileri }), bos).durum).toBe(
      "fise-girmez",
    )
    expect(belgeFisTaslagi(belge({ invoiceType: "E_INVOICE", status: "SENT", kalemGirdileri }), bos).durum).toBe(
      "hazir",
    )
    // Alış faturası kaydıyla (DRAFT = "Kayıtlı") fişe girer.
    expect(belgeFisTaslagi(belge({ type: "PURCHASE", status: "DRAFT", kalemGirdileri }), bos).durum).toBe("hazir")
  })

  it("çok kalemli, iskontolu, karışık oranlı belge her zaman dengeli ve belgeyle tutar", () => {
    const t = belgeFisTaslagi(
      belge({
        globalDiscountAmount: 151.37,
        kalemGirdileri: [
          { quantity: 4, unitPrice: 125.5, vatRate: 20, discountAmount: 20, productId: "a" },
          { quantity: 7, unitPrice: 33.333, vatRate: 10, productId: "b" },
          { quantity: 2, unitPrice: 80, vatRate: 1, withholdingRate: 20 },
          { quantity: 3, unitPrice: 999.99, vatRate: 20, exciseRate: 10, productId: "c" },
        ],
      }),
      bos,
    )
    dengeli(t)
  })
})
