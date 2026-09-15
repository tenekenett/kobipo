import { describe, expect, it } from "vitest"
import {
  AnnualBalanceExceededError,
  LeaveOverlapError,
  assertLeaveAllowed,
  inclusiveDays,
  leaveRuleErrorResponse,
} from "./izin"

type Row = { id: string; employeeId: string; type: string; status: string; startDate: Date; endDate: Date; days: number }

/** Sahte `leaveRecord.findMany`: Prisma `where`ının kullanılan alt kümesini uygular. */
function fakeDb(rows: Row[]) {
  return {
    leaveRecord: {
      findMany: async ({ where }: { where: Record<string, any> }) =>
        rows.filter((r) => {
          if (where.employeeId && r.employeeId !== where.employeeId) return false
          if (where.type && r.type !== where.type) return false
          if (typeof where.status === "string" && r.status !== where.status) return false
          if (where.status?.in && !where.status.in.includes(r.status)) return false
          if (where.id?.not && r.id === where.id.not) return false
          if (where.startDate?.lte && r.startDate > where.startDate.lte) return false
          if (where.startDate?.gte && r.startDate < where.startDate.gte) return false
          if (where.startDate?.lte && where.endDate?.gte && r.endDate < where.endDate.gte) return false
          return true
        }),
    },
  } as never
}

const d = (s: string) => new Date(`${s}T00:00:00`)

describe("inclusiveDays", () => {
  it("iki ucu da sayar", () => {
    expect(inclusiveDays(d("2026-09-01"), d("2026-09-01"))).toBe(1)
    expect(inclusiveDays(d("2026-09-01"), d("2026-09-05"))).toBe(5)
  })
})

describe("assertLeaveAllowed", () => {
  const base = { companyId: "c", employeeId: "e", entitlement: 14 }
  const existing: Row[] = [
    { id: "L1", employeeId: "e", type: "ANNUAL", status: "APPROVED", startDate: d("2026-09-10"), endDate: d("2026-09-12"), days: 3 },
    { id: "L2", employeeId: "e", type: "SICK", status: "REJECTED", startDate: d("2026-09-20"), endDate: d("2026-09-21"), days: 2 },
    { id: "L3", employeeId: "x", type: "ANNUAL", status: "APPROVED", startDate: d("2026-09-01"), endDate: d("2026-09-30"), days: 30 },
  ]

  it("çakışan onaylı izin varsa LeaveOverlapError", async () => {
    await expect(
      assertLeaveAllowed(fakeDb(existing), { ...base, type: "EXCUSE", start: d("2026-09-12"), end: d("2026-09-14"), days: 3 }),
    ).rejects.toBeInstanceOf(LeaveOverlapError)
  })

  it("reddedilmiş kayıt ve başka personelin izni çakışma sayılmaz", async () => {
    await expect(
      assertLeaveAllowed(fakeDb(existing), { ...base, type: "EXCUSE", start: d("2026-09-20"), end: d("2026-09-21"), days: 2 }),
    ).resolves.toBeUndefined()
  })

  it("kendi kaydı (onaylama) çakışma sayılmaz", async () => {
    await expect(
      assertLeaveAllowed(fakeDb(existing), { ...base, type: "ANNUAL", start: d("2026-09-10"), end: d("2026-09-12"), days: 3, excludeId: "L1" }),
    ).resolves.toBeUndefined()
  })

  it("yıllık bakiye aşımı 409 gövdesiyle döner, allowOverdraft ile geçer", async () => {
    const args = { ...base, type: "ANNUAL", start: d("2026-10-01"), end: d("2026-10-15"), days: 15 }
    let caught: unknown
    try {
      await assertLeaveAllowed(fakeDb(existing), args)
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(AnnualBalanceExceededError)
    const res = leaveRuleErrorResponse(caught)
    expect(res?.status).toBe(409)
    expect(res?.body).toMatchObject({ code: "ANNUAL_BALANCE_EXCEEDED", balance: { entitlement: 14, used: 3, remaining: 11 }, requested: 15 })
    await expect(assertLeaveAllowed(fakeDb(existing), { ...args, allowOverdraft: true })).resolves.toBeUndefined()
  })

  it("yıllık olmayan izin bakiyeye bakmaz", async () => {
    await expect(
      assertLeaveAllowed(fakeDb(existing), { ...base, type: "UNPAID", start: d("2026-10-01"), end: d("2026-10-30"), days: 30 }),
    ).resolves.toBeUndefined()
  })
})
