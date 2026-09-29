import { withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { revalidateDashboard } from "@/lib/dashboard/cache"
import { revertReimbursement } from "@/lib/personel/masraf-defteri"

export const dynamic = "force-dynamic"

/** "Çalışana öde" kaydını geri alır: kasa hareketi silinir, hesap bakiyesi geri yazılır. */
export const DELETE = withApiErrors(async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const companyId = await resolveCompanyId(new URL(request.url).searchParams.get("companyId"))
  if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
  await ensureCompanyWrite(companyId)

  const result = await revertReimbursement({ companyId, entryId: id })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })

  revalidateDashboard(companyId)
  return NextResponse.json({ success: true })
})
