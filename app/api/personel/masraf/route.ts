import { withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { revalidateDashboard } from "@/lib/dashboard/cache"
import { loadEmployeeLedger, reimburseEmployee } from "@/lib/personel/masraf-defteri"

export const dynamic = "force-dynamic"

/**
 * Çalışan masraf defteri (bkz. lib/personel/masraf-defteri.ts).
 *
 *   GET  ?companyId&employeeId → satırlar + bakiye (personel kartı "Masraflar")
 *   POST { companyId, employeeId, amount, accountId, date?, notes? } → "Çalışana öde"
 *
 * Yazma kapısı bordro ödemesiyle aynı sayfaya bağlı (lib/page-access.ts): kasadan
 * çalışana para çıkaran iki yol aynı yetkiyi ister.
 */
export const GET = withApiErrors(async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const sp = new URL(request.url).searchParams
  const companyId = await resolveCompanyId(sp.get("companyId"))
  const employeeId = sp.get("employeeId")
  if (!companyId || !employeeId) {
    return NextResponse.json({ error: "companyId ve employeeId zorunlu" }, { status: 400 })
  }
  await ensureCompanyAccess(companyId)

  return NextResponse.json(await loadEmployeeLedger(companyId, employeeId))
})

export const POST = withApiErrors(async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const companyId = await resolveCompanyId(body.companyId)
  const employeeId = typeof body.employeeId === "string" ? body.employeeId : ""
  if (!companyId || !employeeId) {
    return NextResponse.json({ error: "companyId ve employeeId zorunlu" }, { status: 400 })
  }
  await ensureCompanyWrite(companyId)

  const result = await reimburseEmployee({
    companyId,
    employeeId,
    amount: body.amount,
    accountId: body.accountId,
    date: body.date,
    notes: body.notes,
    userId: user.id,
  })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  revalidateDashboard(companyId)
  return NextResponse.json(result, { status: 201 })
})
