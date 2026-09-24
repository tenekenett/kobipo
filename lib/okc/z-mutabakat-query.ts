// Z raporu mutabakatının VERİTABANI tarafı: bir Z'nin fişlerini bulur, saf
// karşılaştırmaya (lib/okc/z-mutabakat.ts) verir. Kural orada, seçim burada.
//
// Bir fiş bu Z'ye şu durumlarda sayılır:
//  1. fişin mali kimliği bu Z'yi gösteriyor (okcDeviceId + okcZNo) — Aşama 2'de cihazdan,
//     Aşama 1'de fiş detayından elle girilmişse;
//  2. fişin Z no'su yok ama bu cihaza bağlı ya da hiçbir cihaza bağlı değil, VE
//     pencerenin (önceki Z → bu Z) içinde kesilmiş.
//
// Şubede birden çok cihaz varken hiçbir cihaza bağlanmamış fiş hangi cihazdan
// basıldığı bilinemez: karşılaştırma yine yapılır ama `comparable: false` döner ve
// ekran "cihaz ayrımı yapılamıyor" der — kırmızı fark satırı gerçek fark sanılmasın.
//
// FİŞ KAPSAMI: satış fişi (isReceipt), iptal HARİÇ. Faturaya dönüştürülen fiş
// (CONVERTED) DAHİL: satış anında cihazdan fiş basılmıştı, Z'de görünür. Kasadan
// kesilen e-Arşiv fatura (fatura bilgi fişi) Aşama 2'nin konusu, burada yok.

import { prisma } from "@/lib/db/prisma"
import {
  compareZ,
  resolveZWindow,
  zBusinessRange,
  Z_BUSINESS_DAY_CUTOFF_HOURS,
  type Mutabakat,
  type MutabakatReceipt,
  type ZWindow,
} from "@/lib/okc/z-mutabakat"
import {
  parseStoredPaymentLines,
  parseStoredVatLines,
  zInternalChecks,
  type ZInternalIssue,
} from "@/lib/okc/z-report"

export type ZReportRecord = {
  id: string
  companyId: string
  deviceId: string
  zNo: number
  takenAt: Date
  grossTotal: unknown
  receiptCount: number | null
  vatLines: unknown
  paymentLines: unknown
}

export type ZMutabakatReceiptRow = {
  id: string
  invoiceNo: string
  slug: string
  date: string
  total: number
  okcReceiptNo: number | null
  /** true = mali kimliği bu Z'yi gösteriyor; false = pencereden sayıldı. */
  assigned: boolean
}

export type ZMutabakatResult = {
  window: { start: string; end: string; first: boolean }
  comparable: boolean
  /** Hiçbir cihaza bağlanmamış (pencereden sayılan) fiş adedi. */
  unassignedCount: number
  deviceCount: number
  mutabakat: Mutabakat
  internalIssues: ZInternalIssue[]
  receipts: ZMutabakatReceiptRow[]
}

const num = (value: unknown) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/** Satır iskontosu sonrası net: kayıtlı tutar esas, yoksa orandan (eski kayıt). */
function lineNet(item: { quantity: unknown; unitPrice: unknown; discountAmount: unknown; discountRate: unknown }) {
  const gross = num(item.quantity) * num(item.unitPrice)
  const discount =
    item.discountAmount == null ? (gross * num(item.discountRate)) / 100 : Math.min(num(item.discountAmount), gross)
  return gross - Math.max(0, discount)
}

async function previousZTakenAt(z: ZReportRecord): Promise<Date | null> {
  const prev = await prisma.okcZReport.findFirst({
    where: { deviceId: z.deviceId, takenAt: { lt: z.takenAt }, id: { not: z.id } },
    orderBy: { takenAt: "desc" },
    select: { takenAt: true },
  })
  return prev?.takenAt ?? null
}

async function loadReceipts(z: ZReportRecord, window: ZWindow) {
  const inWindow = window.first
    ? { gte: window.start, lte: window.end }
    : { gt: window.start, lte: window.end }
  return prisma.invoice.findMany({
    where: {
      companyId: z.companyId,
      type: "SALES",
      isReceipt: true,
      status: { not: "CANCELLED" },
      OR: [
        { okcDeviceId: z.deviceId, okcZNo: z.zNo },
        { okcZNo: null, okcDeviceId: z.deviceId, date: inWindow },
        { okcZNo: null, okcDeviceId: null, date: inWindow },
      ],
    },
    orderBy: { date: "asc" },
    select: {
      id: true,
      invoiceNo: true,
      slug: true,
      date: true,
      totalAmount: true,
      globalDiscountAmount: true,
      globalChargeAmount: true,
      okcDeviceId: true,
      okcZNo: true,
      okcReceiptNo: true,
      items: { select: { quantity: true, unitPrice: true, vatRate: true, discountAmount: true, discountRate: true } },
      payments: { select: { paymentMethod: true, amount: true, paymentDate: true } },
    },
  })
}

/** Bir Z raporunun Kobipo fişleriyle karşılaştırması. */
export async function loadZMutabakat(z: ZReportRecord): Promise<ZMutabakatResult> {
  const [previous, deviceCount] = await Promise.all([
    previousZTakenAt(z),
    prisma.okcDevice.count({ where: { companyId: z.companyId, OR: [{ isActive: true }, { id: z.deviceId }] } }),
  ])
  const window = resolveZWindow(z.takenAt, previous)
  const rows = await loadReceipts(z, window)

  const receipts: MutabakatReceipt[] = rows.map((r) => ({
    id: r.id,
    invoiceNo: r.invoiceNo,
    date: r.date,
    total: num(r.totalAmount),
    lines: r.items.map((item) => ({ vatRate: num(item.vatRate), net: lineNet(item) })),
    globalDiscount: num(r.globalDiscountAmount),
    globalCharge: num(r.globalChargeAmount),
    payments: r.payments.map((p) => ({ method: p.paymentMethod, amount: num(p.amount), date: p.paymentDate })),
  }))

  const zSide = {
    grossTotal: num(z.grossTotal),
    receiptCount: z.receiptCount,
    vatLines: parseStoredVatLines(z.vatLines),
    paymentLines: parseStoredPaymentLines(z.paymentLines),
  }

  const unassignedCount = rows.filter((r) => r.okcDeviceId == null && r.okcZNo == null).length

  return {
    window: { start: window.start.toISOString(), end: window.end.toISOString(), first: window.first },
    comparable: !(deviceCount > 1 && unassignedCount > 0),
    unassignedCount,
    deviceCount,
    mutabakat: compareZ(zSide, receipts, z.takenAt),
    internalIssues: zInternalChecks(zSide),
    receipts: rows.map((r) => ({
      id: r.id,
      invoiceNo: r.invoiceNo,
      slug: r.slug,
      date: r.date.toISOString(),
      total: num(r.totalAmount),
      okcReceiptNo: r.okcReceiptNo,
      assigned: r.okcZNo === z.zNo && r.okcDeviceId === z.deviceId,
    })),
  }
}

export type ZDaySummary = {
  deviceCount: number
  cutoffHours: number
  reports: Array<{
    id: string
    deviceName: string
    zNo: number
    takenAt: string
    grossTotal: number
    kobipoTotal: number
    totalDiff: number | null
    ok: boolean
    comparable: boolean
  }>
}

/**
 * Gün sonu raporunun Z özeti: aralığa (06:00 kesimli iş günü) düşen Z'ler ve her
 * birinin mutabakat sonucu. Şubede yazarkasa tanımlı değilse `deviceCount: 0`
 * döner ve ekran hiçbir şey göstermez — yazarkasası olmayan kafeye Z sorulmaz.
 */
export async function loadZDaySummary(companyId: string, start: Date, end: Date): Promise<ZDaySummary> {
  const deviceCount = await prisma.okcDevice.count({ where: { companyId, isActive: true } })
  if (deviceCount === 0) return { deviceCount, cutoffHours: Z_BUSINESS_DAY_CUTOFF_HOURS, reports: [] }

  const range = zBusinessRange(start, end)
  const reports = await prisma.okcZReport.findMany({
    where: { companyId, takenAt: { gte: range.start, lte: range.end } },
    orderBy: { takenAt: "asc" },
    include: { device: { select: { name: true } } },
  })

  const rows = await Promise.all(
    reports.map(async (z) => {
      const result = await loadZMutabakat(z)
      return {
        id: z.id,
        deviceName: z.device.name,
        zNo: z.zNo,
        takenAt: z.takenAt.toISOString(),
        grossTotal: num(z.grossTotal),
        kobipoTotal: result.mutabakat.total.kobipo,
        totalDiff: result.mutabakat.total.diff,
        ok: result.mutabakat.ok,
        comparable: result.comparable,
      }
    }),
  )
  return { deviceCount, cutoffHours: Z_BUSINESS_DAY_CUTOFF_HOURS, reports: rows }
}
