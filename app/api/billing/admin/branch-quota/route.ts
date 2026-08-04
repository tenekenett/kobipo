import { NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/auth/require-super-admin"
import { BillingAdminError, setAccountBranchQuota } from "@/lib/billing/admin"

export const dynamic = "force-dynamic"

/**
 * Bir hesabın (kök firma) şube kotasını elle ayarlar. Süper-admin korumalı.
 * Body: { companyId: string, branchQuota: number, createTrialIfMissing?: boolean }
 *
 * Aboneliği olmayan hesapta 409 + code "NO_SUBSCRIPTION" döner; istemci onay alıp
 * createTrialIfMissing:true ile tekrar çağırır (bkz. lib/billing/admin.ts).
 */
export async function POST(request: Request) {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error

  const body = (await request.json().catch(() => null)) as
    | { companyId?: unknown; branchQuota?: unknown; createTrialIfMissing?: unknown }
    | null
  const companyId = typeof body?.companyId === "string" ? body.companyId : ""
  const quota = Number(body?.branchQuota)
  if (!companyId || !Number.isFinite(quota)) {
    return NextResponse.json({ error: "companyId ve sayısal branchQuota gerekli" }, { status: 400 })
  }

  try {
    const result = await setAccountBranchQuota(companyId, Math.floor(quota), {
      createTrialIfMissing: body?.createTrialIfMissing === true,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    if (error instanceof BillingAdminError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error("billing admin branch-quota error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Kota güncellenemedi" },
      { status: 500 },
    )
  }
}
