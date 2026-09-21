/**
 * CARİ AVANSI AYRIMI — GERÇEK VERİTABANINA KARŞI.
 *
 * ── Neden gerekli ───────────────────────────────────────────────────────────
 * Kural dört ayrı dosyada tekrarlanıyor ve İKİSİ HAM SQL: saf test yalnız
 * kaynağı tarayabiliyor (`avans-kapsam.test.ts`), sorgunun gerçekten koştuğunu
 * ve doğru kümeyi ayırdığını ancak bir Postgres söyleyebilir. Kolon adı
 * (`t."customerId"`), üç değerli mantık ve `NOT` dalının tümleyenliği burada
 * ölçülür. 2026-09-21 ölçümünde tek firmada 2.472.580 ₺ yanlış taraftaydı.
 *
 * ── Değişmezler ─────────────────────────────────────────────────────────────
 *  1. BÖLÜNME: faturasız hareketlerin toplamı = serbest gelir/gider + cari avansı.
 *     Arada kalan kuruş olmamalı; iki süzgeç birbirinin tam tümleyeni.
 *  2. KÂR tarafı avansı saymaz, ama `advances` ile AYRI döndürür (kaybolmaz).
 *  3. NAKİT tarafı sayar — para gerçekten girdi.
 *  4. Kâr değişince bilanço hâlâ denk kapanır (öz sermaye tanımdan geliyor).
 *
 * ── Veri güvenliği ──────────────────────────────────────────────────────────
 * SALT OKUR: yalnız SELECT/aggregate çalışır, fixture açmaz, hiçbir tabloya
 * yazmaz. Firma seçimi de veriden yapılır (en çok avansı olan firma).
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest"
import { config } from "dotenv"
import { PrismaClient } from "@prisma/client"
import { CARI_ADVANCE_WHERE, NOT_TRANSFER_OR_SETTLEMENT_WHERE, NO_CARI_WHERE } from "@/lib/finans/nakit-hareket"
import { computeProfitLoss } from "./kar-zarar"
import { computeCashFlow } from "./nakit-akisi"
import { computeBalanceSheet } from "./bilanco"
import { computeIncomeExpense } from "./gelir-gider"
import { computeExpenseReport } from "./harcamalar"
import { computeFinancialOverview } from "./finansal-ozet"

config({ path: ".env.local", override: true })
config()

const prisma = new PrismaClient()

const GUN = 86_400_000
const bugun = new Date()
const baslangic = new Date(bugun.getTime() - 365 * GUN)
const START = baslangic.toISOString().slice(0, 10)
const END = bugun.toISOString().slice(0, 10)
const kurus = (n: number) => Math.round(n * 100)

/** Ölçümün anlamlı olması için avansı OLAN bir firma gerekir; veriden seçilir. */
let companyId = ""
let avansAdedi = 0

beforeAll(async () => {
  const [enCok] = await prisma.transaction.groupBy({
    by: ["companyId"],
    where: { date: { gte: baslangic }, invoicePayments: { none: {} }, ...CARI_ADVANCE_WHERE },
    _count: { _all: true },
    orderBy: { _count: { companyId: "desc" } },
    take: 1,
  })
  companyId = enCok?.companyId ?? ""
  avansAdedi = enCok?._count._all ?? 0
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe("cari avansı — canlı", () => {
  it("ölçülecek veri var (avansı olan bir firma bulundu)", () => {
    // Boşsa test YEŞİL GEÇMEZ: "kural çalışıyor" ile "ölçecek veri yoktu"
    // aynı şey değil; ayrım sessizce bozulursa burası söyler.
    expect(companyId, "cari bağlı faturasız hareketi olan firma yok — ayrım ölçülemedi").not.toBe("")
    expect(avansAdedi).toBeGreaterThan(0)
  })

  it("1) faturasız hareketler İKİYE bölünür: serbest + avans, arada kayıp yok", async () => {
    for (const type of ["INCOME", "EXPENSE"] as const) {
      const ortak = {
        companyId,
        type,
        date: { gte: baslangic },
        invoicePayments: { none: {} },
        ...NOT_TRANSFER_OR_SETTLEMENT_WHERE,
      }
      const [hepsi, serbest, avans] = await Promise.all([
        prisma.transaction.aggregate({ where: ortak, _sum: { amount: true } }),
        prisma.transaction.aggregate({ where: { ...ortak, ...NO_CARI_WHERE }, _sum: { amount: true } }),
        prisma.transaction.aggregate({ where: { ...ortak, ...CARI_ADVANCE_WHERE }, _sum: { amount: true } }),
      ])
      const toplam = Number(hepsi._sum.amount || 0)
      const parcalar = Number(serbest._sum.amount || 0) + Number(avans._sum.amount || 0)
      expect(kurus(parcalar), `${type} bölünmesi`).toBe(kurus(toplam))
    }
  })

  it("2) kâr/zarar avansı gelir/gider SAYMAZ ama `advances` ile ayrı döndürür", async () => {
    const kz = await computeProfitLoss({ companyId, startDate: START, endDate: END })
    const avans = await prisma.transaction.groupBy({
      by: ["type"],
      where: {
        companyId,
        type: { in: ["INCOME", "EXPENSE"] },
        date: { gte: baslangic },
        invoicePayments: { none: {} },
        ...NOT_TRANSFER_OR_SETTLEMENT_WHERE,
        ...CARI_ADVANCE_WHERE,
      },
      _sum: { amount: true },
    })
    const beklenenGelir = Number(avans.find((r) => r.type === "INCOME")?._sum.amount || 0)
    const beklenenGider = Number(avans.find((r) => r.type === "EXPENSE")?._sum.amount || 0)

    expect(kurus(kz.advances.income)).toBe(kurus(beklenenGelir))
    expect(kurus(kz.advances.expense)).toBe(kurus(beklenenGider))
    // Avans hiçbir toplama girmez: net kâr yalnız brüt kâr − diğer giderlerdir.
    expect(kurus(kz.netProfit)).toBe(kurus(kz.grossProfit - kz.otherExpenses))
    // Ciro avansı içermez.
    const serbestGelir = await prisma.transaction.aggregate({
      where: {
        companyId,
        type: "INCOME",
        date: { gte: baslangic },
        invoicePayments: { none: {} },
        ...NOT_TRANSFER_OR_SETTLEMENT_WHERE,
        ...NO_CARI_WHERE,
      },
      _sum: { amount: true },
    })
    expect(kurus(kz.revenue.other)).toBe(kurus(Number(serbestGelir._sum.amount || 0)))
  })

  it("3) nakit akışı avansı SAYAR — para gerçekten girdi", async () => {
    const [kz, na] = await Promise.all([
      computeProfitLoss({ companyId, startDate: START, endDate: END }),
      computeCashFlow({ companyId, startDate: START, endDate: END }),
    ])
    // Nakit tarafı kâr tarafının saydıklarına EK olarak avansı (ve çek/senet
    // tahsilini) da sayar; bu yüzden ">=" ve avans varken kesin ">".
    expect(kurus(na.operatingActivities.otherIncome)).toBeGreaterThanOrEqual(
      kurus(kz.revenue.other + kz.advances.income)
    )
    if (kz.advances.income > 0) {
      expect(kurus(na.operatingActivities.otherIncome)).toBeGreaterThan(kurus(kz.revenue.other))
    }
  })

  it("4) kâr değişti ama bilanço denk kapanıyor", async () => {
    const b = await computeBalanceSheet({ companyId })
    expect(kurus(b.total)).toBe(kurus(b.totalLiabilitiesAndEquity))
  })

  it("5) ham SQL kullanan iki rapor da hatasız koşar", async () => {
    // Kolon adı ya da tırnak hatası ancak burada görünür: `next build` ham SQL'i
    // ayrıştırmaz, saf test yalnız metni tarar.
    const [gg, hr, fo] = await Promise.all([
      computeIncomeExpense({ companyId, startDate: START, endDate: END }),
      computeExpenseReport({ companyId, startDate: START, endDate: END }),
      computeFinancialOverview({ companyId }),
    ])
    expect(gg.period).toBeTruthy()
    expect(hr.totals).toBeTruthy()
    expect(Array.isArray(fo.monthly)).toBe(true)
  })
})
