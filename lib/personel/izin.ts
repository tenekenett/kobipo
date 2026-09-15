import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"

/**
 * İZİN KAYDI KURALLARI — tek yer.
 *
 * İki denetim 2026-09-15'e kadar hiç yoktu:
 *  1. ÇAKIŞMA: aynı personelin aynı güne iki izni (bekleyen ya da onaylı) girilebiliyor,
 *     ikisi de onaylanınca bordroda gün iki kez kesiliyordu.
 *  2. YILLIK İZİN BAKİYESİ: hak edilenin üstünde yıllık izin sessizce yazılıyor, bakiye
 *     ekranı eksiye düşüyordu. Avans izin meşru olabilir; bu yüzden kapı KAPATMAZ,
 *     `allowOverdraft` ile bilerek geçilir — ekran önce sorar.
 *
 * Gün sayısı SUNUCUDA takvim aralığından hesaplanır (`inclusiveDays`); istemciden
 * gelen `days` artık okunmaz — bakiye `days`ı, puantaj tarih aralığını okuyordu ve
 * ikisi ayrışabiliyordu.
 */

const DAY_MS = 24 * 60 * 60 * 1000

export function inclusiveDays(start: Date, end: Date): number {
  const d = Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1
  return d > 0 ? d : 1
}

/** Bakiyeyi tüketen durumlar: onaylı kesindir, bekleyen de günü rezerve eder. */
export const BLOCKING_STATUSES = ["PENDING", "APPROVED"] as const

type Db = Prisma.TransactionClient | typeof prisma

export type OverlappingLeave = {
  id: string
  type: string
  status: string
  startDate: Date
  endDate: Date
}

/** Aynı personelin [start, end] aralığına DEĞEN bekleyen/onaylı izinleri. */
export async function findOverlappingLeaves(
  db: Db,
  args: { companyId: string; employeeId: string; start: Date; end: Date; excludeId?: string | null },
): Promise<OverlappingLeave[]> {
  return db.leaveRecord.findMany({
    where: {
      companyId: args.companyId,
      employeeId: args.employeeId,
      status: { in: [...BLOCKING_STATUSES] },
      startDate: { lte: args.end },
      endDate: { gte: args.start },
      ...(args.excludeId ? { id: { not: args.excludeId } } : {}),
    },
    select: { id: true, type: true, status: true, startDate: true, endDate: true },
    orderBy: { startDate: "asc" },
  })
}

export class LeaveOverlapError extends Error {
  readonly code = "LEAVE_OVERLAP" as const
  constructor(readonly overlaps: OverlappingLeave[]) {
    super("Leave overlaps existing record")
    this.name = "LeaveOverlapError"
  }
  get messageTr(): string {
    const fmt = (d: Date) => d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" })
    const first = this.overlaps[0]
    const span = `${fmt(first.startDate)} – ${fmt(first.endDate)}`
    const more = this.overlaps.length > 1 ? ` (+${this.overlaps.length - 1} kayıt daha)` : ""
    return `Bu personelin aynı günlere denk gelen ${first.status === "APPROVED" ? "onaylı" : "bekleyen"} bir izni var: ${span}${more}. Önce onu düzenleyin.`
  }
}

/** Varsayılan yıllık izin hakkı (Employee.annualLeaveDays boşsa). İş Kanunu 53: 1–5 yıl → 14 gün. */
export const DEFAULT_ANNUAL_LEAVE_DAYS = 14

export type AnnualBalance = { year: number; entitlement: number; used: number; remaining: number }

/**
 * Personelin `year` yılı yıllık izin bakiyesi. "Kullanılan" = o yıl BAŞLAYAN onaylı
 * ANNUAL izinlerin gün toplamı — `/api/personel/leaves/balance` ile aynı tanım.
 * `includePending` bekleyen talepleri de rezerve sayar (yeni talep kapısı için).
 */
export async function annualLeaveBalance(
  db: Db,
  args: { companyId: string; employeeId: string; year: number; entitlement: number | null; includePending?: boolean; excludeId?: string | null },
): Promise<AnnualBalance> {
  const start = new Date(args.year, 0, 1)
  const end = new Date(args.year, 11, 31, 23, 59, 59)
  const rows = await db.leaveRecord.findMany({
    where: {
      companyId: args.companyId,
      employeeId: args.employeeId,
      type: "ANNUAL",
      status: args.includePending ? { in: [...BLOCKING_STATUSES] } : "APPROVED",
      startDate: { gte: start, lte: end },
      ...(args.excludeId ? { id: { not: args.excludeId } } : {}),
    },
    select: { days: true },
  })
  const used = rows.reduce((s, r) => s + Number(r.days), 0)
  const entitlement = args.entitlement ?? DEFAULT_ANNUAL_LEAVE_DAYS
  return { year: args.year, entitlement, used, remaining: entitlement - used }
}

export class AnnualBalanceExceededError extends Error {
  readonly code = "ANNUAL_BALANCE_EXCEEDED" as const
  constructor(readonly balance: AnnualBalance, readonly requested: number) {
    super("Annual leave balance exceeded")
    this.name = "AnnualBalanceExceededError"
  }
  get messageTr(): string {
    return `${this.balance.year} yılı yıllık izin bakiyesi ${this.balance.remaining} gün (hak ${this.balance.entitlement}, kullanılan/bekleyen ${this.balance.used}); istenen ${this.requested} gün. Avans izin olarak kaydetmek için onaylayın.`
  }
}

/**
 * Yeni izin ya da onaylama için kapı. Çakışma her zaman engeller; yıllık bakiye
 * aşımı yalnız `allowOverdraft` verilmediyse engeller.
 */
export async function assertLeaveAllowed(
  db: Db,
  args: {
    companyId: string
    employeeId: string
    type: string
    start: Date
    end: Date
    days: number
    entitlement: number | null
    excludeId?: string | null
    allowOverdraft?: boolean
  },
): Promise<void> {
  const overlaps = await findOverlappingLeaves(db, args)
  if (overlaps.length > 0) throw new LeaveOverlapError(overlaps)

  if (args.type === "ANNUAL" && !args.allowOverdraft) {
    const balance = await annualLeaveBalance(db, {
      companyId: args.companyId,
      employeeId: args.employeeId,
      year: args.start.getFullYear(),
      entitlement: args.entitlement,
      includePending: true,
      excludeId: args.excludeId,
    })
    if (args.days > balance.remaining) throw new AnnualBalanceExceededError(balance, args.days)
  }
}

export function leaveRuleErrorResponse(error: unknown): { status: number; body: Record<string, unknown> } | null {
  if (error instanceof LeaveOverlapError) {
    return { status: 409, body: { error: error.messageTr, code: error.code, overlaps: error.overlaps } }
  }
  if (error instanceof AnnualBalanceExceededError) {
    return {
      status: 409,
      body: { error: error.messageTr, code: error.code, balance: error.balance, requested: error.requested },
    }
  }
  return null
}
