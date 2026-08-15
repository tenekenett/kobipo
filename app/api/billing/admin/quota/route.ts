import { NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/auth/require-super-admin"
import { BillingAdminError, setAccountQuotas } from "@/lib/billing/admin"

export const dynamic = "force-dynamic"

/**
 * Bir hesabın (kök firma) ŞUBE ve/veya FİRMA kotasını elle ayarlar. Süper-admin korumalı.
 * Body: { companyId: string, branchQuota?: number, companyQuota?: number, createTrialIfMissing?: boolean }
 *
 * İki kota ayrı havuz olduğu için ikisi de opsiyoneldir; verilmeyen alana dokunulmaz.
 * Aboneliği olmayan hesapta 409 + code "NO_SUBSCRIPTION" döner; istemci onay alıp
 * createTrialIfMissing:true ile tekrar çağırır (bkz. lib/billing/admin.ts).
 */
export async function POST(request: Request) {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error

  const body = (await request.json().catch(() => null)) as
    | {
        companyId?: unknown
        branchQuota?: unknown
        companyQuota?: unknown
        createTrialIfMissing?: unknown
      }
    | null
  const companyId = typeof body?.companyId === "string" ? body.companyId : ""
  // null/undefined = "dokunma"; sayı = yeni değer.
  const branchQuota = body?.branchQuota == null ? undefined : Number(body.branchQuota)
  const companyQuota = body?.companyQuota == null ? undefined : Number(body.companyQuota)

  if (!companyId) {
    return NextResponse.json({ error: "companyId gerekli" }, { status: 400 })
  }
  if (branchQuota === undefined && companyQuota === undefined) {
    return NextResponse.json(
      { error: "Sayısal branchQuota veya companyQuota gerekli" },
      { status: 400 },
    )
  }
  if (
    (branchQuota !== undefined && !Number.isFinite(branchQuota)) ||
    (companyQuota !== undefined && !Number.isFinite(companyQuota))
  ) {
    return NextResponse.json({ error: "Kota sayısal olmalı" }, { status: 400 })
  }

  try {
    const result = await setAccountQuotas(
      companyId,
      {
        branchQuota: branchQuota === undefined ? undefined : Math.floor(branchQuota),
        companyQuota: companyQuota === undefined ? undefined : Math.floor(companyQuota),
      },
      { createTrialIfMissing: body?.createTrialIfMissing === true },
    )
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    if (error instanceof BillingAdminError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
    }
    console.error("billing admin quota error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Kota güncellenemedi" },
      { status: 500 },
    )
  }
}
