import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

// İşveren maliyeti için kaba çarpan (SGK işveren payı + işsizlik ~ %22.5).
const EMPLOYER_COST_MULTIPLIER = 1.225

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const companyId = searchParams.get("companyId")
  const year = Number(searchParams.get("year")) || new Date().getFullYear()
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  await ensureCompanyAccess(companyId)

  const [employees, payrolls, leaves] = await Promise.all([
    prisma.employee.findMany({
      where: { companyId },
      select: { id: true, status: true, department: true, terminationDate: true },
    }),
    prisma.payrollRecord.findMany({
      where: { companyId, periodYear: year },
      include: { employee: { select: { department: true } } },
    }),
    prisma.leaveRecord.findMany({
      where: { companyId, status: "APPROVED" },
      select: { type: true, days: true, startDate: true },
    }),
  ])

  // --- Headcount ---
  const headcount = {
    total: employees.length,
    active: employees.filter((e) => e.status === "ACTIVE").length,
    onLeave: employees.filter((e) => e.status === "ON_LEAVE").length,
    terminated: employees.filter((e) => e.status === "TERMINATED").length,
  }

  const byDepartmentMap = new Map<string, { department: string; headcount: number; gross: number; net: number }>()
  const getDept = (d?: string | null) => (d && d.trim() ? d.trim() : "Tanımsız")

  for (const e of employees) {
    if (e.status === "TERMINATED") continue
    const key = getDept(e.department)
    const row = byDepartmentMap.get(key) || { department: key, headcount: 0, gross: 0, net: 0 }
    row.headcount += 1
    byDepartmentMap.set(key, row)
  }

  // --- Maliyet (seçili yıl bordroları) ---
  let totalGross = 0
  let totalNet = 0
  let totalDeductions = 0
  for (const p of payrolls) {
    const gross = Number(p.grossSalary) + Number(p.bonus)
    const net = Number(p.netSalary)
    totalGross += gross
    totalNet += net
    totalDeductions += Number(p.advance) + Number(p.sgkDeduction) + Number(p.taxDeduction) + Number(p.otherDeduction)
    const key = getDept(p.employee.department)
    const row = byDepartmentMap.get(key) || { department: key, headcount: 0, gross: 0, net: 0 }
    row.gross += gross
    row.net += net
    byDepartmentMap.set(key, row)
  }
  const employerCost = totalGross * EMPLOYER_COST_MULTIPLIER

  // --- İzin kullanımı (seçili yıl, onaylı) ---
  const leaveByType: Record<string, number> = { ANNUAL: 0, EXCUSE: 0, SICK: 0, UNPAID: 0 }
  let totalLeaveDays = 0
  for (const l of leaves) {
    if (new Date(l.startDate).getFullYear() !== year) continue
    const d = Number(l.days)
    leaveByType[l.type] = (leaveByType[l.type] || 0) + d
    totalLeaveDays += d
  }

  // --- Devir oranı ---
  const terminatedThisYear = employees.filter(
    (e) => e.terminationDate && new Date(e.terminationDate).getFullYear() === year,
  ).length
  const activeNow = headcount.active + headcount.onLeave
  const avgHeadcount = (activeNow + terminatedThisYear) / 2
  const turnoverRate = avgHeadcount > 0 ? (terminatedThisYear / avgHeadcount) * 100 : 0

  return NextResponse.json({
    year,
    headcount,
    cost: {
      payrollCount: payrolls.length,
      totalGross,
      totalNet,
      totalDeductions,
      employerCostEstimate: employerCost,
    },
    leaveUsage: {
      byType: leaveByType,
      total: totalLeaveDays,
    },
    turnover: {
      terminatedThisYear,
      rate: Number(turnoverRate.toFixed(1)),
    },
    byDepartment: Array.from(byDepartmentMap.values()).sort((a, b) => b.gross - a.gross),
  })
}
