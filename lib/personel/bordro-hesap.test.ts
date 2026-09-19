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
    expect(brutenNete(50_000, { year: 2099 }).paramYear).toBe(2026)
  })

  it("yıl verilmezse de en son parametre kullanılır", () => {
    expect(brutenNete(50_000).paramYear).toBe(2026)
  })
})

describe("2026 parametreleri (RG 26.12.2025 / 33119)", () => {
  const P26 = bordroParam(2026)

  it("asgari ücret: brüt 33.030,00 → net 28.075,50, vergiler istisnayla sıfır", () => {
    const r = brutenNete(P26.minGross, { year: 2026, month: 1 })
    expect(r.paramYear).toBe(2026)
    expect(r.incomeTax).toBe(0)
    expect(r.stampTax).toBe(0)
    expect(r.sgkEmployee).toBeCloseTo(4624.2, 2)
    expect(r.unemploymentEmployee).toBeCloseTo(330.3, 2)
    expect(r.net).toBeCloseTo(28075.5, 2)
  })

  it("işveren maliyeti TEŞVİKSİZ taban oranla (%21,75 + %2) hesaplanır", () => {
    // Yayımlanan "işverene maliyet" 39.223,13 rakamı 5 puanlık teşvikli (%16,75)
    // orandır; kod 2025'ten beri teşviksiz oranı kullanır (2025'te de yayımlanan
    // 30.621,48'e bu yüzden denk düşmüyordu). Teşvik firmaya göre değişir
    // (imalat 5 puan / diğer 2 puan / şartı kaçıran 0), o yüzden tabana bağlı.
    const r = brutenNete(P26.minGross, { year: 2026, month: 1 })
    expect(r.employerCost).toBeCloseTo(33030 * (1 + 0.2175 + 0.02), 2) // 40.874,63
    expect(r.employerCost).toBeGreaterThan(39223.13)
  })

  it("SGK tavanı 9 kat = 297.270; 2025'teki 7,5 katın üstünde prim artık kesilir", () => {
    expect(P26.minGross * P26.ceilingFactor).toBeCloseTo(297270, 2)
    const eskiTavan = bordroParam(2025).minGross * 7.5 // 195.041,25
    const r = brutenNete(250_000, { year: 2026, month: 1 })
    expect(r.sgkEmployee).toBeCloseTo(250_000 * 0.14, 2)
    expect(250_000).toBeGreaterThan(eskiTavan)
  })

  it("asgari ücretli Aralık'ta da net 28.075,50 alır (istisna kendi dilimini izler)", () => {
    const r = brutenNete(P26.minGross, { year: 2026, month: 12 })
    expect(r.net).toBeCloseTo(28075.5, 2)
  })

  it("Aralık 2025 hesabı 2025, Ocak 2026 hesabı 2026 tarifesini kullanır", () => {
    expect(brutenNete(60_000, { year: 2025, month: 12 }).paramYear).toBe(2025)
    expect(brutenNete(60_000, { year: 2026, month: 1 }).paramYear).toBe(2026)
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
