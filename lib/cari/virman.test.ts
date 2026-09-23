import { describe, expect, it } from "vitest"
import {
  formatVirmanNo,
  oppositeSide,
  parseVirmanInput,
  parseVirmanSeq,
  virmanAciklamasi,
  virmanBacaklari,
  virmanBakiyeEtkisi,
  virmanSatirYonu,
} from "./virman"

describe("virman yönü", () => {
  it("borç BORÇ sütununa, alacak ALACAK sütununa yazılır — cari türünden bağımsız", () => {
    expect(virmanSatirYonu("DEBIT", 100)).toEqual({ debit: 100, credit: 0 })
    expect(virmanSatirYonu("CREDIT", 100)).toEqual({ debit: 0, credit: 100 })
  })

  it("müşteride borç bakiyeyi artırır, alacak azaltır", () => {
    expect(virmanBakiyeEtkisi("customer", "DEBIT", 100)).toBe(100)
    expect(virmanBakiyeEtkisi("customer", "CREDIT", 100)).toBe(-100)
  })

  it("tedarikçide AYNALI: borç bizim borcumuzu azaltır, alacak artırır", () => {
    expect(virmanBakiyeEtkisi("supplier", "DEBIT", 100)).toBe(-100)
    expect(virmanBakiyeEtkisi("supplier", "CREDIT", 100)).toBe(100)
  })

  it("müşteri → tedarikçi virmanı iki bakiyeyi de düşürür (ABC, XYZ'ye ödedi)", () => {
    // XYZ: Virman Borç, ABC: Virman Alacak
    expect(virmanBakiyeEtkisi("supplier", "DEBIT", 10_000)).toBe(-10_000)
    expect(virmanBakiyeEtkisi("customer", "CREDIT", 10_000)).toBe(-10_000)
  })

  it("iki bacağın ekstre etkisi (borç − alacak) her zaman sıfırlanır", () => {
    for (const side of ["DEBIT", "CREDIT"] as const) {
      const a = virmanSatirYonu(side, 250)
      const b = virmanSatirYonu(oppositeSide(side), 250)
      expect(a.debit - a.credit + (b.debit - b.credit)).toBe(0)
    }
  })
})

describe("parseVirmanInput", () => {
  const base = {
    party: { kind: "customer", id: "c1" },
    side: "CREDIT",
    counterparty: { kind: "supplier", id: "s1" },
    amount: 1500.5,
    date: "2026-09-23",
    description: "  ABC'nin XYZ'ye ödemesi  ",
  }

  it("geçerli iki taraflı fişi kabul eder, açıklamayı kırpar", () => {
    const r = parseVirmanInput(base)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.counterparty).toEqual({ kind: "supplier", id: "s1" })
    expect(r.value.amount).toBe(1500.5)
    expect(r.value.description).toBe("ABC'nin XYZ'ye ödemesi")
  })

  it("karşı cari İSTEĞE BAĞLI: null / boş → tek taraflı", () => {
    for (const counterparty of [null, undefined, ""]) {
      const r = parseVirmanInput({ ...base, counterparty })
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.value.counterparty).toBeNull()
    }
  })

  it("karşı cari fişin carisiyle aynı olamaz", () => {
    const r = parseVirmanInput({ ...base, counterparty: { kind: "customer", id: "c1" } })
    expect(r.ok).toBe(false)
  })

  it("aynı id farklı türde (ikiz kart değil, farklı tablo) reddedilmez", () => {
    const r = parseVirmanInput({ ...base, counterparty: { kind: "supplier", id: "c1" } })
    expect(r.ok).toBe(true)
  })

  it("tutar: sıfır, eksi, sayı olmayan ve 2 haneden fazla ondalık reddedilir", () => {
    for (const amount of [0, -5, "abc", 10.123, ""]) {
      expect(parseVirmanInput({ ...base, amount }).ok).toBe(false)
    }
  })

  it("tutar: virgüllü metin ve kayan nokta artığı (0,29) kabul edilir", () => {
    const a = parseVirmanInput({ ...base, amount: "12,75" })
    expect(a.ok && a.value.amount).toBe(12.75)
    const b = parseVirmanInput({ ...base, amount: 0.29 })
    expect(b.ok && b.value.amount).toBe(0.29)
  })

  it("yön ve cari zorunlu; geçersiz tarih reddedilir", () => {
    expect(parseVirmanInput({ ...base, side: "BORC" }).ok).toBe(false)
    expect(parseVirmanInput({ ...base, party: null }).ok).toBe(false)
    expect(parseVirmanInput({ ...base, party: { kind: "employee", id: "x" } }).ok).toBe(false)
    expect(parseVirmanInput({ ...base, date: "yarın" }).ok).toBe(false)
  })

  it("açıklama sınırı", () => {
    expect(parseVirmanInput({ ...base, description: "x".repeat(501) }).ok).toBe(false)
  })
})

describe("virmanBacaklari", () => {
  it("karşı cari ters yönde bacak alır", () => {
    const legs = virmanBacaklari({
      party: { kind: "customer", id: "c1" },
      side: "CREDIT",
      counterparty: { kind: "supplier", id: "s1" },
    })
    expect(legs).toEqual([
      { side: "CREDIT", party: { kind: "customer", id: "c1" } },
      { side: "DEBIT", party: { kind: "supplier", id: "s1" } },
    ])
  })

  it("tek taraflı fiş tek bacaktır", () => {
    expect(
      virmanBacaklari({ party: { kind: "supplier", id: "s1" }, side: "DEBIT", counterparty: null }),
    ).toHaveLength(1)
  })
})

describe("numara ve açıklama", () => {
  it("VRM-000042 ↔ 42", () => {
    expect(formatVirmanNo(42)).toBe("VRM-000042")
    expect(parseVirmanSeq("VRM-000042")).toBe(42)
    expect(parseVirmanSeq("başka")).toBe(0)
  })

  it("tek taraflı fiş açıklamada söylenir", () => {
    expect(virmanAciklamasi({ virmanNo: "VRM-000001", counterpartyName: null, description: null })).toBe(
      "Virman VRM-000001 · tek taraflı",
    )
    expect(
      virmanAciklamasi({ virmanNo: "VRM-000002", counterpartyName: "ABC Ltd", description: "mahsup" }),
    ).toBe("Virman VRM-000002 · karşı: ABC Ltd — mahsup")
  })
})
