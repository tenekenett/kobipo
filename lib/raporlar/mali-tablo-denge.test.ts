import { describe, expect, it } from "vitest"
import { NOT_TRANSFER_WHERE, isTransferLeg } from "@/lib/finans/nakit-hareket"
import { composeBalanceSheet } from "./bilanco-ozet"
import { summarizeCashFlow } from "./nakit-akisi-ozet"
import { resolvePeriodBounds } from "./date-range"

/**
 * MALİ TABLOLARIN DENGE KİMLİKLERİ.
 *
 * Üç tablo da bir dönem bu kimlikleri tutmuyordu: nakit akışında dönem başı ve
 * sonu aynı günün bakiyesini gösteriyor, bilançoda öz sermaye yevmiye hacminden
 * okunuyordu. Kimlikler burada nöbet tutuyor ki bir sonraki düzenleme sessizce
 * geri almasın.
 */

describe("nakit akışı dengesi", () => {
  it("dönem başı + net akış = dönem sonu", () => {
    const summary = summarizeCashFlow({
      beginningBalance: 12_500,
      endingBalance: 18_300,
      collections: 40_000,
      payments: 31_000,
      otherIncome: 1_200,
      otherExpense: 4_400,
    })

    expect(summary.beginningBalance + summary.netCashFlow).toBe(summary.endingBalance)
    expect(summary.netCashFlow).toBe(5_800)
  })

  it("sınıflandırma toplamı bakiye farkını tutmuyorsa fark denge kaleminde durur", () => {
    // Dönem içinde 3.000 ₺ devirle açılan bir kasa: hareket yazmaz ama bakiyeyi
    // artırır. Sınıflandırma bunu göremez; kaybolmak yerine görünür kalmalı.
    const summary = summarizeCashFlow({
      beginningBalance: 0,
      endingBalance: 3_000,
      collections: 0,
      payments: 0,
      otherIncome: 0,
      otherExpense: 0,
    })

    expect(summary.operatingActivities.net).toBe(0)
    expect(summary.unclassified).toBe(3_000)
    expect(summary.operatingActivities.net + summary.unclassified).toBe(summary.netCashFlow)
  })

  it("her şey kayıtlıysa denge kalemi sıfırdır", () => {
    const summary = summarizeCashFlow({
      beginningBalance: 1_000,
      endingBalance: 1_600,
      collections: 900,
      payments: 200,
      otherIncome: 100,
      otherExpense: 200,
    })

    expect(summary.unclassified).toBe(0)
  })
})

describe("bilanço dengesi", () => {
  it("aktif = yükümlülük + öz sermaye", () => {
    const sheet = composeBalanceSheet({
      cashAndBanks: 25_000,
      netReceivables: 60_000,
      netPayables: 40_000,
      inventory: 15_000,
      retainedEarnings: 35_000,
    })

    expect(sheet.total).toBe(sheet.totalLiabilitiesAndEquity)
    expect(sheet.assets.total).toBe(100_000)
    expect(sheet.liabilities.total).toBe(40_000)
    expect(sheet.equity.total).toBe(60_000)
  })

  it("kârla açıklanamayan kısım düzeltme satırında görünür", () => {
    const sheet = composeBalanceSheet({
      cashAndBanks: 50_000,
      netReceivables: 0,
      netPayables: 0,
      inventory: 0,
      retainedEarnings: 20_000,
    })

    // 50.000 net varlığın 20.000'i kâr; kalan 30.000 kuruluş sermayesi/devirdir.
    expect(sheet.equity.adjustments).toBe(30_000)
    expect(sheet.equity.retainedEarnings + sheet.equity.adjustments).toBe(sheet.equity.total)
  })

  /**
   * Eskiden negatif bakiye `> 0 ? : 0` ile sıfırlanıyordu: müşteri fatura
   * tutarından fazla ödediğinde para bilançodan tamamen düşüyordu.
   */
  it("müşterinin fazla ödemesi alacaktan silinmez, avans olarak pasife geçer", () => {
    const sheet = composeBalanceSheet({
      cashAndBanks: 5_000,
      netReceivables: -5_000,
      netPayables: 0,
      inventory: 0,
      retainedEarnings: 0,
    })

    expect(sheet.assets.receivables).toBe(0)
    expect(sheet.liabilities.customerAdvances).toBe(5_000)
    expect(sheet.total).toBe(sheet.totalLiabilitiesAndEquity)
    expect(sheet.equity.total).toBe(0)
  })

  it("tedarikçiye fazla ödeme borçtan silinmez, avans olarak aktife geçer", () => {
    const sheet = composeBalanceSheet({
      cashAndBanks: 0,
      netReceivables: 0,
      netPayables: -8_000,
      inventory: 0,
      retainedEarnings: 0,
    })

    expect(sheet.liabilities.payables).toBe(0)
    expect(sheet.assets.supplierAdvances).toBe(8_000)
    expect(sheet.total).toBe(sheet.totalLiabilitiesAndEquity)
  })
})

/**
 * Hesaplar arası virman KAYNAK hesaba type=TRANSFER, HEDEF hesaba type=INCOME
 * yazar. Hedef bacak gelir sayıldığı için kasadan bankaya para taşımak ciroyu
 * ve nakit akışını şişiriyordu.
 */
describe("virman bacağı gelir/gider değildir", () => {
  it("hedef bacak (INCOME + TRANSFER: referansı) virman sayılır", () => {
    expect(isTransferLeg({ type: "INCOME", reference: "TRANSFER:acc-1" })).toBe(true)
  })

  it("kaynak bacak tipinden tanınır — kullanıcı referans yazmış olsa bile", () => {
    expect(isTransferLeg({ type: "TRANSFER", reference: "Kasa boşaltma" })).toBe(true)
    expect(isTransferLeg({ type: "TRANSFER", reference: null })).toBe(true)
  })

  it("gerçek gelir/gider virman sayılmaz", () => {
    expect(isTransferLeg({ type: "INCOME", reference: "MAKBUZ-12" })).toBe(false)
    expect(isTransferLeg({ type: "EXPENSE", reference: null })).toBe(false)
  })

  /**
   * SQL ÜÇ DEĞERLİ MANTIK TUZAĞI — bu testin tek işi.
   *
   * `NOT (reference LIKE 'TRANSFER:%')` ifadesi `reference` NULL iken TRUE değil
   * NULL üretir ve satır süzgeçten geçemez. Yani sade `NOT: { startsWith }`
   * REFERANSI OLMAYAN her hareketi yutar — ki bunlar çoğunluktur. Canlı veride
   * ölçüldü: 2.065.445 ₺'lik iki serbest gelir hareketi raporlarda 0 görünüyordu.
   *
   * Süzgeç bir Prisma parçası olduğu için birim testte ÇALIŞTIRILAMAZ; nöbet
   * BİÇİM üzerinde tutuluyor: NULL dalı silinirse test kırılır.
   */
  it("prisma süzgeci referansı NULL olan hareketleri YUTMAZ", () => {
    expect(NOT_TRANSFER_WHERE).toHaveProperty("OR")
    expect(NOT_TRANSFER_WHERE.OR).toContainEqual({ reference: null })
    expect(NOT_TRANSFER_WHERE.OR).toHaveLength(2)
  })
})

/**
 * Dönem sonu DIŞLAYICIDIR: `lte: new Date("2026-09-05")` gece yarısını gösterip
 * o günün bütün hareketlerini rapordan düşürüyordu.
 */
describe("dönem sınırları", () => {
  it("bitiş günü tamamen kapsanır", () => {
    const bounds = resolvePeriodBounds("2026-09-01", "2026-09-05")
    expect(bounds.start.toISOString()).toBe("2026-09-01T00:00:00.000Z")
    expect(bounds.endExclusive.toISOString()).toBe("2026-09-06T00:00:00.000Z")
  })

  it("ay ve yıl sınırını aşar", () => {
    expect(resolvePeriodBounds("2026-01-01", "2026-01-31").endExclusive.toISOString()).toBe(
      "2026-02-01T00:00:00.000Z"
    )
    expect(resolvePeriodBounds("2026-12-01", "2026-12-31").endExclusive.toISOString()).toBe(
      "2027-01-01T00:00:00.000Z"
    )
  })

  it("bitiş verilmezse bugünün tamamı kapsanır", () => {
    const bounds = resolvePeriodBounds(null, null, new Date(2026, 8, 5))
    expect(bounds.start.toISOString()).toBe("2026-01-01T00:00:00.000Z")
    expect(bounds.endExclusive.toISOString()).toBe("2026-09-06T00:00:00.000Z")
  })
})
