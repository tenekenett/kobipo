/**
 * Dekont → TEK kasa/banka hareketi.
 *
 * Korunan kararlar: (1) bir dekont bir hareket — tutar faturalara BÖLÜNSE de
 * banka ekstresindeki tek satırla eşleşmeli; (2) dağıtım `lib/cari/odeme-dagit`
 * kuralından gelir, burada kopyası yoktur; (3) C1: faturalara sığmayan tutar
 * kaybolmaz, cariye AVANS kalır ve kaydı engellemez.
 */

import { describe, expect, it } from "vitest"
import { odemeDagit } from "@/lib/cari/odeme-dagit"
import type { Dekont } from "./schema"
import { dekontToIslem, type AcikFatura } from "./to-payment"

const BUGUN = new Date("2026-09-21T10:00:00Z")

function dekont(p: Partial<Dekont> = {}): Dekont {
  return {
    banka: "Ziraat", islemTarihi: "2026-09-18", tutar: 1500, paraBirimi: "TRY",
    gonderenAd: "EREN", gonderenIban: null, aliciAd: "REYPO", aliciIban: null,
    aciklama: "FTR123 ödemesi", referansNo: "REF9988", islemTuru: "HAVALE",
    guven: { taraflar: 0.9, tarih: 0.9, tutar: 0.9 },
    ...p,
  }
}

const YENI: AcikFatura = { id: "f2", invoiceNo: "B", date: "2026-09-10", kalan: 400 }
const ESKI: AcikFatura = { id: "f1", invoiceNo: "A", date: "2026-08-01", kalan: 1000 }
const TAM = { companyId: "c1", yon: "TAHSILAT" as const, cariId: "m1", accountId: "banka1", bugun: BUGUN }
const uyari = <T extends { anahtar: string }>(u: T[], a: string) => u.find((x) => x.anahtar === a)

describe("dekontToIslem — tek hareket", () => {
  it("tutarın TAMAMI tek işleme yazılır; faturalara bölünen yalnız dağıtımdır", () => {
    const { body, dagitim, avans } = dekontToIslem(dekont({ tutar: 1400 }), { ...TAM, faturalar: [YENI, ESKI] })
    expect(body).toMatchObject({ companyId: "c1", accountId: "banka1", type: "INCOME", amount: 1400, customerId: "m1", currency: "TRY", date: "2026-09-18", reference: "REF9988" })
    expect(body!.invoiceIds).toEqual(["f1", "f2"])
    expect(dagitim.map((a) => [a.invoiceNo, a.amount])).toEqual([["A", 1000], ["B", 400]])
    expect(avans).toBe(0)
  })

  it("ödeme yönü gideri tedarikçiye yazar", () => {
    const { body } = dekontToIslem(dekont(), { ...TAM, yon: "ODEME", cariId: "s1", faturalar: [] })
    expect(body).toMatchObject({ type: "EXPENSE", supplierId: "s1" })
    expect(body).not.toHaveProperty("customerId")
  })

  it("açıklama banka, referans ve dekont açıklamasını taşır", () => {
    const { body } = dekontToIslem(dekont(), { ...TAM, faturalar: [ESKI] })
    expect(body!.description).toBe("Tahsilat — dekont · REF9988 · Ziraat · FTR123 ödemesi")
  })

  it("işlem tarihi okunamadıysa bugüne düşer", () => {
    const { body } = dekontToIslem(dekont({ islemTarihi: "18/09/2026" }), { ...TAM, faturalar: [ESKI] })
    expect(body!.date).toBe("2026-09-21")
  })
})

describe("dekontToIslem — dağıtım tek kuraldan", () => {
  it("sonuç lib/cari/odeme-dagit ile birebir aynıdır (kopya kural yok)", () => {
    const faturalar = [YENI, ESKI, { id: "f3", invoiceNo: "C", date: "2026-09-15", kalan: 250 }]
    const { dagitim, avans } = dekontToIslem(dekont({ tutar: 1500 }), { ...TAM, faturalar })
    const beklenen = odemeDagit(1500, [ESKI, YENI, faturalar[2]].map((f) => ({ id: f.id, openAmount: f.kalan })))
    expect(dagitim.map((a) => ({ invoiceId: a.invoiceId, amount: a.amount }))).toEqual(beklenen.allocations)
    expect(avans).toBe(beklenen.remainder)
  })

  it("kuruş aritmetiği tam sayıyla: 5.492,70 üçe bölünürken artan kalmaz", () => {
    const uc = [1, 2, 3].map((i) => ({ id: `f${i}`, invoiceNo: String(i), date: `2026-0${i}-01`, kalan: 1830.9 }))
    const { dagitim, avans } = dekontToIslem(dekont({ tutar: 5492.7 }), { ...TAM, faturalar: uc })
    expect(dagitim.map((a) => a.amount)).toEqual([1830.9, 1830.9, 1830.9])
    expect(avans).toBe(0)
  })

  it("kalanı biten fatura pay almaz ve uca GÖNDERİLMEZ", () => {
    const { body, dagitim } = dekontToIslem(dekont({ tutar: 100 }), { ...TAM, faturalar: [{ ...ESKI, kalan: 0 }, YENI] })
    expect(dagitim.map((a) => a.invoiceId)).toEqual(["f2"])
    expect(body!.invoiceIds).toEqual(["f2"])
  })
})

describe("dekontToIslem — C1: artan tutar cariye avans", () => {
  it("faturaların açığını aşan kısım kaydı engellemez, avans olarak söylenir", () => {
    const { body, avans, uyarilar } = dekontToIslem(dekont({ tutar: 1500 }), { ...TAM, faturalar: [YENI, ESKI] })
    expect(body!.amount).toBe(1500) // işlem bölünmez
    expect(avans).toBe(100)
    const u = uyari(uyarilar, "avans")!
    expect(u.agir).toBeUndefined()
    expect(u.mesaj).toContain("100.00")
  })

  it("hiç açık fatura seçilmemişse tutarın tamamı avans olur; kayıt yine yapılır", () => {
    const { body, dagitim, avans, uyarilar } = dekontToIslem(dekont(), { ...TAM, faturalar: [] })
    expect(body).not.toBeNull()
    expect(body).not.toHaveProperty("invoiceIds")
    expect(dagitim).toHaveLength(0)
    expect(avans).toBe(1500)
    expect(uyari(uyarilar, "fatura")?.agir).toBeUndefined()
  })
})

describe("dekontToIslem — eksik bilgi kaydı kilitler", () => {
  it("kasa/banka seçilmeden işlem yazılamaz (uç accountId zorunlu tutar)", () => {
    const { body, uyarilar } = dekontToIslem(dekont(), { ...TAM, accountId: null, faturalar: [ESKI] })
    expect(body).toBeNull()
    expect(uyari(uyarilar, "hesap")?.agir).toBe(true)
  })

  it("cari seçilmeden işlem yazılamaz — avans kimin hesabına yazılacağı belirsiz kalırdı", () => {
    expect(uyari(dekontToIslem(dekont(), { ...TAM, cariId: "", faturalar: [ESKI] }).uyarilar, "cari")?.mesaj).toContain("müşteriyi")
    expect(uyari(dekontToIslem(dekont(), { ...TAM, yon: "ODEME", cariId: null, faturalar: [] }).uyarilar, "cari")?.mesaj).toContain("tedarikçiyi")
    expect(dekontToIslem(dekont(), { ...TAM, cariId: null, faturalar: [ESKI] }).body).toBeNull()
  })

  it("tutar okunamadıysa hiçbir şey kurulmaz", () => {
    for (const t of [null, 0, -5]) {
      const { body, dagitim, uyarilar } = dekontToIslem(dekont({ tutar: t }), { ...TAM, faturalar: [ESKI] })
      expect(body).toBeNull()
      expect(dagitim).toHaveLength(0)
      expect(uyari(uyarilar, "tutar")?.agir).toBe(true)
    }
  })
})
