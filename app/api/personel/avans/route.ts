import { withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { revalidateDashboard } from "@/lib/dashboard/cache"
import { avansDefteri, avansVer } from "@/lib/personel/avans.server"

export const dynamic = "force-dynamic"

/**
 * Personel avansı (bkz. lib/personel/avans.ts).
 *
 *   GET  ?companyId&employeeId → avans hareketleri + bordro mahsupları + açık bakiye
 *   POST { companyId, employeeId, yon: "VER" | "GERI_AL", amount, accountId, date?, notes? }
 *
 * Yazma kapısı bordro ödemesi ve masraf iadesiyle aynı sayfaya bağlı (lib/page-access.ts):
 * kasadan çalışana para çıkaran bütün yollar aynı yetkiyi ister.
 */
export const GET = withApiErrors(async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const sp = new URL(request.url).searchParams
  const companyId = await resolveCompanyId(sp.get("companyId"))
  const employeeId = sp.get("employeeId")
  if (!companyId || !employeeId) return NextResponse.json({ error: "companyId ve employeeId zorunlu" }, { status: 400 })
  await ensureCompanyAccess(companyId)
  return NextResponse.json(await avansDefteri(companyId, employeeId))
})

export const POST = withApiErrors(async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json()
  const companyId = await resolveCompanyId(body.companyId)
  const employeeId = typeof body.employeeId === "string" ? body.employeeId : ""
  if (!companyId || !employeeId) return NextResponse.json({ error: "companyId ve employeeId zorunlu" }, { status: 400 })
  await ensureCompanyWrite(companyId)
  const result = await avansVer({
    companyId,
    employeeId,
    yon: body.yon === "GERI_AL" ? "GERI_AL" : "VER",
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
