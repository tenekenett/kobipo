import { describe, expect, it } from "vitest"
import { baskinKdvOrani, fisOdemeToMethod, fisToInvoiceBody } from "./to-invoice"
import { computeLineTax } from "@/lib/invoice/line-tax"
import type { Fis, FisKalem } from "./schema"

const r2 = (x: number) => Math.round(x * 100) / 100

const kalem = (p: Partial<FisKalem> = {}): FisKalem => ({
  ad: "KALEM",
  miktar: null,
  birimFiyat: null,
  kdvOrani: 20,
  tutar: 120,
  ...p,
})

const fis = (p: Partial<Fis> = {}): Fis => ({
  saticiUnvan: "TEST GIDA LTD.ŞTİ.",
  vknTckn: "6570027609",
  tarih: "2026-08-23",
  fisNo: "0016",
  kalemler: [kalem()],
  araToplam: 100,
  kdvToplam: 20,
  genelToplam: 120,
  odeme: { sekil: "NAKIT", tutar: 120 },
  guven: { satici: 0.9, tarih: 0.9, toplam: 0.9, kalemler: 0.9 },
  ...p,
})

const SEC = { companyId: "c1", supplierId: "s1", bugun: new Date("2026-09-02T10:00:00") }

/** Sunucunun (app/api/e-donusum/invoices) toplamı nasıl kuracağının kopyası. */
const sunucuToplami = (d: ReturnType<typeof fisToInvoiceBody>) =>
  r2(
    d.body.items.reduce(
      (a, it) => a + computeLineTax(it.quantity * it.unitPrice, { vatRate: it.vatRate }).total,
      0
    ) + (d.body.payableRoundingAmount ?? 0)
  )

describe("fisToInvoiceBody — KDV dahil tutardan net geri çözme", () => {
  it("tek kalemli fişte kaydedilecek toplam fişin genel toplamına eşittir", () => {
    const d = fisToInvoiceBody(fis(), SEC)
    expect(d.body.items).toHaveLength(1)
    expect(d.body.items[0].unitPrice).toBeCloseTo(100, 6)
    expect(d.beklenenToplam).toBe(120)
    expect(sunucuToplami(d)).toBe(120)
  })

  it("akaryakıt fişi: ondalıklı miktar ve küsuratlı birim fiyat toplamı bozmaz", () => {
    // Gerçek ölçüm fişi: 4,360 LT × 73,18 = 319,06 (KDV dahil, %20).
    const d = fisToInvoiceBody(
      fis({
        kalemler: [kalem({ ad: "K.BENZIN95 SVP", miktar: 4.36, birimFiyat: 73.18, tutar: 319.06 })],
        araToplam: 265.88,
        kdvToplam: 53.18,
        genelToplam: 319.06,
      }),
      SEC
    )
    expect(d.body.items[0].quantity).toBe(4.36)
    expect(d.beklenenToplam).toBe(319.06)
    expect(sunucuToplami(d)).toBe(319.06)
  })

  it("restoran fişi: miktarsız departman satırı 1 adet olur ve uyarır", () => {
    const d = fisToInvoiceBody(
      fis({
        kalemler: [kalem({ ad: "IZGARA", miktar: null, kdvOrani: 10, tutar: 650 })],
        araToplam: 590.91,
        kdvToplam: 59.09,
        genelToplam: 650,
      }),
      SEC
    )
    expect(d.body.items[0].quantity).toBe(1)
    expect(d.body.items[0].unitPrice).toBeCloseTo(590.909, 3)
    expect(d.beklenenToplam).toBe(650)
    expect(d.uyarilar.map((u) => u.anahtar)).toContain("miktar")
  })

  it("karma oranlı market fişinde her satır kendi oranını korur", () => {
    const d = fisToInvoiceBody(
      fis({
        kalemler: [
          kalem({ ad: "EKMEK", kdvOrani: 1, tutar: 10.1 }),
          kalem({ ad: "DETERJAN", kdvOrani: 20, tutar: 120 }),
        ],
        genelToplam: 130.1,
        kdvToplam: 20.1,
      }),
      SEC
    )
    expect(d.body.items.map((i) => i.vatRate)).toEqual([1, 20])
    expect(d.beklenenToplam).toBe(130.1)
    expect(sunucuToplami(d)).toBe(130.1)
  })

  it("kuruş artığı dip toplam yuvarlamasına yazılır, uyarı üretmez", () => {
    // 0,01 TL'lik artık: geri çözümün kaçınılmaz sonucu, sapma değil.
    const d = fisToInvoiceBody(
      fis({ kalemler: [kalem({ tutar: 120 })], genelToplam: 120.01 }),
      SEC
    )
    expect(d.body.payableRoundingAmount).toBe(0.01)
    expect(d.beklenenToplam).toBe(120.01)
    expect(d.uyarilar.some((u) => u.anahtar === "yuvarlama")).toBe(false)
  })

  it("kalem toplamı dip toplamı tutmuyorsa AĞIR uyarı verir (fark gömülmez)", () => {
    const d = fisToInvoiceBody(
      fis({ kalemler: [kalem({ tutar: 120 })], genelToplam: 525.58 }),
      SEC
    )
    const u = d.uyarilar.find((x) => x.anahtar === "yuvarlama")
    expect(u?.agir).toBe(true)
    expect(u?.mesaj).toContain("405.58")
  })

  it("negatif iskonto satırı negatif birim fiyatla geçer ve toplamı düşürür", () => {
    const d = fisToInvoiceBody(
      fis({
        kalemler: [kalem({ ad: "SUT", tutar: 120 }), kalem({ ad: "PROMOSYON", tutar: -12 })],
        genelToplam: 108,
      }),
      SEC
    )
    expect(d.body.items[1].unitPrice).toBeLessThan(0)
    expect(d.beklenenToplam).toBe(108)
    expect(sunucuToplami(d)).toBe(108)
    expect(d.uyarilar.map((u) => u.anahtar)).toContain("negatif")
  })

  it("tutarsız satır faturaya alınmaz ve AĞIR uyarı bırakır", () => {
    const d = fisToInvoiceBody(
      fis({ kalemler: [kalem({ ad: "OKUNAMADI", tutar: null }), kalem({ tutar: 120 })] }),
      SEC
    )
    expect(d.body.items).toHaveLength(1)
    expect(d.uyarilar.find((u) => u.anahtar === "kalem")?.agir).toBe(true)
  })
})

describe("baskinKdvOrani", () => {
  it("oranı ADEDE göre değil TUTARA göre seçer", () => {
    // Üç adet %1 satır (toplam 30 TL) vs. tek %20 satır (600 TL) → %20 baskın.
    const f = fis({
      kalemler: [
        kalem({ kdvOrani: 1, tutar: 10 }),
        kalem({ kdvOrani: 1, tutar: 10 }),
        kalem({ kdvOrani: 1, tutar: 10 }),
        kalem({ kdvOrani: 20, tutar: 600 }),
      ],
    })
    expect(baskinKdvOrani(f)).toEqual({ oran: 20, kaynak: "kalem" })
  })

  it("hiçbir satırda oran yoksa dip toplamdan türetir", () => {
    const f = fis({
      kalemler: [kalem({ kdvOrani: null, tutar: 650 })],
      genelToplam: 650,
      kdvToplam: 59.09,
    })
    expect(baskinKdvOrani(f)).toEqual({ oran: 10, kaynak: "toplam" })
  })

  it("türetilemezse %20 varsayar ve bunu kaynağıyla söyler", () => {
    const f = fis({
      kalemler: [kalem({ kdvOrani: null, tutar: 100 })],
      genelToplam: null,
      kdvToplam: null,
    })
    expect(baskinKdvOrani(f)).toEqual({ oran: 20, kaynak: "varsayilan" })
  })

  it("eski oranı (%8) olduğu gibi korur — arşiv fişi bozulmasın", () => {
    const f = fis({ kalemler: [kalem({ kdvOrani: 8, tutar: 108 })] })
    expect(baskinKdvOrani(f).oran).toBe(8)
  })

  it("varsayılan orana düşen satır AĞIR uyarı üretir (tahmin görünsün)", () => {
    const d = fisToInvoiceBody(
      fis({
        kalemler: [kalem({ kdvOrani: null, tutar: 100 })],
        genelToplam: null,
        kdvToplam: null,
      }),
      SEC
    )
    expect(d.uyarilar.find((u) => u.anahtar === "oran")?.agir).toBe(true)
  })
})

describe("gövde alanları", () => {
  it("tedarikçi seçilmemişse gövdeye NULL gider, kayıt yine kurulur", () => {
    // Tedarikçi opsiyonel: fiş kesilir, yalnız cari ekstresine düşmez.
    // Boş dize gitseydi fatura ucu onu "seçilmiş ama boş" diye taşırdı.
    const d = fisToInvoiceBody(fis(), { ...SEC, supplierId: null })
    expect(d.body.supplierId).toBeNull()
    expect(d.body.items).toHaveLength(1)
    expect(d.beklenenToplam).toBe(120)
  })

  it("fişin tarihini gün olarak taşır, saat eklemez", () => {
    expect(fisToInvoiceBody(fis({ tarih: "2026-08-23T21:57:00" }), SEC).body.date).toBe("2026-08-23")
  })

  it("tarih okunamadıysa YEREL günü kullanır (UTC kayması yok)", () => {
    const gece = new Date("2026-09-02T23:30:00")
    const d = fisToInvoiceBody(fis({ tarih: null }), { ...SEC, bugun: gece })
    expect(d.body.date).toBe("2026-09-02")
  })

  it("nota YALNIZ fişin kendi bilgisi yazılır — fatura numarası FS- serisinde kalır", () => {
    const d = fisToInvoiceBody(fis(), SEC)
    expect(d.body.notes).toContain("Fiş No: 0016")
    expect(d.body.notes).toContain("Satıcı: TEST GIDA LTD.ŞTİ.")
    // Kayıt tarihi kalır (fişin kendi tarihinden farklı olabilir).
    expect(d.body.notes).toContain("2.09.2026")
    // Üretim ayrıntısı (model adı, "fotoğraftan tarandı") kullanıcının
    // belgesine yazılmaz; sızarsa burası kırılsın.
    expect(d.body.notes).not.toMatch(/tarandı|gemini|google/i)
    expect(d.body).not.toHaveProperty("invoiceNo")
  })

  it("ürün eşleşmesi verilirse satıra productId bağlanır", () => {
    const d = fisToInvoiceBody(fis({ kalemler: [kalem({ ad: "Ekmek" })] }), {
      ...SEC,
      urunEslesme: new Map([["ekmek", "p1"]]),
    })
    expect(d.body.items[0].productId).toBe("p1")
  })
})

describe("fisOdemeToMethod", () => {
  it("fişin ödeme şeklini uygulamanın tahsilat yöntemine çevirir", () => {
    expect(fisOdemeToMethod("NAKIT")).toBe("CASH")
    expect(fisOdemeToMethod("KREDI_KARTI")).toBe("CREDIT_CARD")
    expect(fisOdemeToMethod("YEMEK_KARTI")).toBe("MEAL_CARD")
    expect(fisOdemeToMethod("HAVALE")).toBe("BANK_TRANSFER")
  })

  it("okunamayan ödeme null döner — kullanıcı seçsin, tahmin edilmesin", () => {
    expect(fisOdemeToMethod(null)).toBeNull()
  })
})
