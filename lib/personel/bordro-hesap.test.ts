import { describe, expect, it } from "vitest"
import { bordroParam, brutenNete, nettenBrute } from "@/lib/personel/bordro-hesap"

const P = bordroParam(2025)

describe("brutenNete", () => {
  it("asgari ücretin neti, kesintilerin tamamı istisnaya girdiği için SGK sonrası tutardır", () => {
    // 2025 asgari ücret: brüt 26.005,50 → net 22.104,67 (yayımlanan resmi rakam).
    // Gelir ve damga vergisi asgari ücret istisnasıyla tamamen sıfırlanır.
    const r = brutenNete(P.minGross, { year: 2025, month: 1 })
    expect(r.incomeTax).toBe(0)
    expect(r.stampTax).toBe(0)
    expect(r.net).toBeCloseTo(22104.67, 0)
  })

  it("istisna kapatılınca asgari ücretliden de vergi kesilir", () => {
    const acik = brutenNete(P.minGross, { year: 2025, month: 1 })
    const kapali = brutenNete(P.minGross, { year: 2025, month: 1, minWageExemption: false })
    expect(kapali.net).toBeLessThan(acik.net)
    expect(kapali.incomeTax).toBeGreaterThan(0)
    expect(kapali.stampTax).toBeGreaterThan(0)
  })

  it("aynı brüt yıl ilerledikçe daha az net verir (kümülatif matrah dilim atlatır)", () => {
    const ocak = brutenNete(120_000, { year: 2025, month: 1 })
    const aralik = brutenNete(120_000, { year: 2025, month: 12 })
    expect(aralik.net).toBeLessThan(ocak.net)
  })

  it("SGK primi tavanla sınırlıdır: tavan üstü brütte prim artmaz", () => {
    const ceiling = P.minGross * P.ceilingFactor
    const tavanda = brutenNete(ceiling, { year: 2025, month: 1 })
    const ustunde = brutenNete(ceiling * 2, { year: 2025, month: 1 })
    expect(ustunde.sgkEmployee).toBeCloseTo(tavanda.sgkEmployee, 2)
    expect(ustunde.unemploymentEmployee).toBeCloseTo(tavanda.unemploymentEmployee, 2)
  })

  it("istisna gelir ve damga vergisine AYRI uygulanır — damga artığı gelir vergisini yemez", () => {
    const r = brutenNete(200_000, { year: 2025, month: 1 })
    // Yüksek ücrette damga istisnası asgari ücretin damgası kadardır; kalan damga ödenir.
    expect(r.stampTax).toBeCloseTo((200_000 - P.minGross) * P.stampRate, 2)
    expect(r.incomeTax).toBeGreaterThan(0)
  })

  it("parçalar toplamı brütü verir", () => {
    const r = brutenNete(75_000, { year: 2025, month: 5 })
    expect(r.net + r.totalDeduction).toBeCloseTo(r.gross, 2)
  })

  it("tanımsız yıl istendiğinde bilinen en son parametreye düşer", () => {
    expect(brutenNete(50_000, { year: 2099 }).paramYear).toBe(2025)
  })
})

describe("nettenBrute", () => {
  it("brütten nete ile tam ters çalışır", () => {
    for (const gross of [P.minGross, 40_000, 85_000, 250_000]) {
      const net = brutenNete(gross, { year: 2025, month: 3 }).net
      const geri = nettenBrute(net, { year: 2025, month: 3 })
      expect(geri.gross).toBeCloseTo(gross, 0)
      expect(geri.net).toBeCloseTo(net, 0)
    }
  })

  it("dilim geçişinde de yakınsar (kırıklı fonksiyon)", () => {
    // 2025'te 158.000 kümülatif matrah sınırının etrafındaki aylar.
    const net = brutenNete(160_000, { year: 2025, month: 2 }).net
    expect(nettenBrute(net, { year: 2025, month: 2 }).gross).toBeCloseTo(160_000, 0)
  })

  it("sıfır net sıfır brüt döner", () => {
    expect(nettenBrute(0, { year: 2025 }).gross).toBe(0)
  })
})
