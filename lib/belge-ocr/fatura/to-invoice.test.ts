/**
 * Okunan fatura → `/api/e-donusum/invoices` gövdesi. Plan Faz 1'de "birim test
 * YOK" diye bırakılmıştı; kart (önizleme) ve sunucu aynı fonksiyonu çağırdığı
 * için buradaki bir sapma "ekranda gördüğüm tutar kaydedilmedi" olarak çıkar.
 */

import { describe, expect, it } from "vitest"
import type { Fatura, FaturaKalem } from "./schema"
import { faturaToInvoiceBody } from "./to-invoice"

const BIZ = "7352344835"
const TEDARIKCI = "3531285187"
const BUGUN = new Date("2026-09-21T10:00:00Z")
const SECENEK = { companyId: "c1", yon: "ALIS" as const, supplierId: "s1", bugun: BUGUN }

function kalem(p: Partial<FaturaKalem> = {}): FaturaKalem {
  return { ad: "Ürün A", saticiKodu: null, miktar: 10, birim: "ADET", birimFiyat: 10, iskontoTutar: null, kdvOrani: 20, kdvTutar: 20, satirTutar: 100, tevkifatOrani: null, ...p }
}

function fatura(p: Partial<Fatura> = {}): Fatura {
  return {
    saticiUnvan: "EREN FORKLİFT", saticiVknTckn: TEDARIKCI, saticiVergiDairesi: null, saticiAdres: null,
    aliciUnvan: "REYPO", aliciVknTckn: BIZ, faturaNo: "EFT2026000000123", ettn: null,
    tarih: "2026-09-01", vade: null, senaryo: "TEMELFATURA", tip: "SATIS", paraBirimi: "TRY",
    kalemler: [kalem()], kdvKirilimi: [{ oran: 20, matrah: 100, kdv: 20 }],
    genelIskonto: null, kdvsizEk: null, matrahToplam: 100, kdvToplam: 20, tevkifatToplam: null,
    odenecek: 120, irsaliyeNoListesi: [], odemeNotu: null,
    guven: { satici: 0.9, alici: 0.9, tarih: 0.9, toplam: 0.9, kalemler: 0.9 },
    ...p,
  }
}

const uyari = <T extends { anahtar: string }>(u: T[], a: string) => u.find((x) => x.anahtar === a)

describe("faturaToInvoiceBody — yön", () => {
  it("ALIS → PURCHASE + supplierId, SATIS → SALES + customerId", () => {
    const alis = faturaToInvoiceBody(fatura(), SECENEK).body
    expect(alis.type).toBe("PURCHASE")
    expect(alis.supplierId).toBe("s1")
    expect(alis).not.toHaveProperty("customerId")

    const satis = faturaToInvoiceBody(fatura(), { companyId: "c1", yon: "SATIS", customerId: "m1", bugun: BUGUN }).body
    expect(satis.type).toBe("SALES")
    expect(satis.customerId).toBe("m1")
    expect(satis).not.toHaveProperty("supplierId")
  })

  it("belge dışarıdan geldiği için MANUAL, fiş değil, gönderilmez", () => {
    const b = faturaToInvoiceBody(fatura(), SECENEK).body
    expect(b.invoiceType).toBe("MANUAL")
    expect(b.isReceipt).toBe(false)
    expect(b.sendInvoice).toBe(false)
    expect(b.invoiceNo).toBe("EFT2026000000123")
    expect(b.date).toBe("2026-09-01")
  })
})

describe("faturaToInvoiceBody — kalemler", () => {
  it("birim fiyat basılmamışsa satır netinden geri türetilir (iskonto geri eklenir)", () => {
    const { body } = faturaToInvoiceBody(fatura({ kalemler: [kalem({ birimFiyat: null, iskontoTutar: 10, satirTutar: 90 })], odenecek: 108 }), SECENEK)
    expect(body.items[0].unitPrice).toBe(10)
    expect(body.items[0].discountAmount).toBe(10)
  })

  it("ne fiyat ne tutar okunan satır faturaya ALINMAZ ve ağır uyarı verir", () => {
    const { body, uyarilar } = faturaToInvoiceBody(fatura({ kalemler: [kalem(), kalem({ ad: "Boş satır", birimFiyat: null, satirTutar: null })] }), SECENEK)
    expect(body.items).toHaveLength(1)
    expect(uyari(uyarilar, "kalem")?.agir).toBe(true)
  })

  it("0 TL satır düşer ama ağır değildir", () => {
    const { body, uyarilar } = faturaToInvoiceBody(fatura({ kalemler: [kalem(), kalem({ ad: "Promosyon", birimFiyat: 0, satirTutar: 0 })] }), SECENEK)
    expect(body.items).toHaveLength(1)
    expect(uyari(uyarilar, "kalem")?.agir).toBeUndefined()
  })

  it("KDV oranı okunamadıysa %20 TAHMİN EDİLMEZ: %0 yazılır ve ağır uyarı verilir", () => {
    const { body, uyarilar } = faturaToInvoiceBody(fatura({ kalemler: [kalem({ kdvOrani: null })] }), SECENEK)
    expect(body.items[0].vatRate).toBe(0)
    expect(uyari(uyarilar, "oran")?.agir).toBe(true)
  })

  it("birim kodu uygulamanın kümesine çevrilir, boşsa ADET", () => {
    const birim = (b: string | null) => faturaToInvoiceBody(fatura({ kalemler: [kalem({ birim: b })] }), SECENEK).body.items[0].unit
    expect(birim("C62")).toBe("ADET")
    expect(birim("KGM")).toBe("KG")
    expect(birim("ltr")).toBe("LT")
    expect(birim(null)).toBe("ADET")
    expect(birim("kutu")).toBe("KUTU")
  })

  it("tevkifat oranı yüzdeye çevrilir ve söylenir", () => {
    const { body, uyarilar } = faturaToInvoiceBody(fatura({ kalemler: [kalem({ tevkifatOrani: 0.2 })] }), SECENEK)
    expect(body.items[0].withholdingRate).toBe(20)
    expect(uyari(uyarilar, "tevkifat")).toBeTruthy()
  })

  it("kartta eşleşen ürün satıra bağlanır, eşleşmeyen satır productId'siz gider", () => {
    const { body } = faturaToInvoiceBody(fatura({ kalemler: [kalem(), kalem({ ad: "Ürün B" })] }), { ...SECENEK, urunEslesme: new Map([[1, "p9"]]) })
    expect(body.items[0]).not.toHaveProperty("productId")
    expect(body.items[1].productId).toBe("p9")
  })
})

describe("faturaToInvoiceBody — KDV'siz ek", () => {
  it("damga vergisi %0 KDV'li ayrı satır olur: ödenecek değişmez, KDV'ye dokunulmaz", () => {
    const { body, beklenenToplam } = faturaToInvoiceBody(fatura({ kdvsizEk: 12.5, odenecek: 132.5 }), SECENEK)
    expect(body.items).toHaveLength(2)
    expect(body.items[1]).toMatchObject({ vatRate: 0, quantity: 1, unitPrice: 12.5 })
    expect(beklenenToplam).toBe(132.5)
    expect(body).not.toHaveProperty("payableRoundingAmount")
  })
})

describe("faturaToInvoiceBody — dip toplam ve kuruş farkı", () => {
  it("kuruş farkı payableRoundingAmount'a yazılır, kaydedilecek tutar belgeyle aynı kalır", () => {
    const { body, uyarilar, beklenenToplam } = faturaToInvoiceBody(fatura({ odenecek: 120.03 }), SECENEK)
    expect(body.payableRoundingAmount).toBe(0.03)
    expect(beklenenToplam).toBe(120.03)
    expect(uyari(uyarilar, "yuvarlama")).toBeUndefined()
  })

  it("50 kuruşu aşan fark ağır uyarıdır (kalem okuması şüphelidir)", () => {
    const { body, uyarilar } = faturaToInvoiceBody(fatura({ odenecek: 150 }), SECENEK)
    expect(body.payableRoundingAmount).toBe(30)
    expect(uyari(uyarilar, "yuvarlama")?.agir).toBe(true)
  })

  it("ödenecek okunamadıysa kalemlerden hesaplanan tutar kaydedilir", () => {
    const { body, uyarilar, beklenenToplam } = faturaToInvoiceBody(fatura({ odenecek: null }), SECENEK)
    expect(body).not.toHaveProperty("payableRoundingAmount")
    expect(beklenenToplam).toBe(120)
    expect(uyari(uyarilar, "toplam")?.agir).toBe(true)
  })

  it("genel iskonto gövdeye taşınır ve toplamı düşürür", () => {
    const { body, beklenenToplam } = faturaToInvoiceBody(fatura({ genelIskonto: 20, odenecek: 96 }), SECENEK)
    expect(body.globalDiscountAmount).toBe(20)
    expect(beklenenToplam).toBe(96)
    expect(body.payableRoundingAmount).toBeUndefined()
  })
})

describe("faturaToInvoiceBody — başlık, not ve uyarılar", () => {
  it("fatura numarası okunamadıysa ağır uyarı; mesaj alış/satışta farklıdır", () => {
    const alis = faturaToInvoiceBody(fatura({ faturaNo: null }), SECENEK).uyarilar
    expect(uyari(alis, "no")?.mesaj).toContain("tedarikçinin")
    const satis = faturaToInvoiceBody(fatura({ faturaNo: "" }), { companyId: "c1", yon: "SATIS", customerId: "m1", bugun: BUGUN }).uyarilar
    expect(uyari(satis, "no")?.mesaj).toContain("seri numarası")
  })

  it("TRY dışı belge ağır uyarı verir (kur okunmuyor)", () => {
    expect(uyari(faturaToInvoiceBody(fatura({ paraBirimi: "USD" }), SECENEK).uyarilar, "doviz")?.agir).toBe(true)
    expect(faturaToInvoiceBody(fatura({ paraBirimi: null }), SECENEK).body.currency).toBe("TRY")
  })

  it("ETTN, senaryo, irsaliye no ve ödeme notu nota yazılır", () => {
    const { body } = faturaToInvoiceBody(
      fatura({ ettn: "abc-123", irsaliyeNoListesi: ["IRS001", "IRS002"], odemeNotu: "TR33...", senaryo: "EARSIVFATURA", tip: "SATIS" }),
      { ...SECENEK, kaynak: "e-Arşiv PDF (karekod)" }
    )
    expect(body.notes).toContain("ETTN: abc-123")
    expect(body.notes).toContain("Senaryo: EARSIVFATURA / SATIS")
    expect(body.notes).toContain("İrsaliye No: IRS001, IRS002")
    expect(body.notes).toContain("Ödeme: TR33...")
    expect(body.notes).toContain("e-Arşiv PDF (karekod)")
  })

  it("vade yalnız YYYY-MM-DD ise gövdeye girer; tarih okunamadıysa bugüne düşer", () => {
    expect(faturaToInvoiceBody(fatura({ vade: "2026-10-01" }), SECENEK).body.dueDate).toBe("2026-10-01")
    expect(faturaToInvoiceBody(fatura({ vade: "30 gün" }), SECENEK).body).not.toHaveProperty("dueDate")
    expect(faturaToInvoiceBody(fatura({ tarih: null }), SECENEK).body.date).toBe("2026-09-21")
  })

  it("irsaliye bağı ve depo seçimi gövdeye taşınır", () => {
    const { body } = faturaToInvoiceBody(fatura(), { ...SECENEK, waybillIds: ["w1"], warehouseId: "d1" })
    expect(body.waybillIds).toEqual(["w1"])
    expect(body.warehouseId).toBe("d1")
    expect(faturaToInvoiceBody(fatura(), SECENEK).body).not.toHaveProperty("waybillIds")
  })
})
