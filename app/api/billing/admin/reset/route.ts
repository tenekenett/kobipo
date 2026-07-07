import { NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/auth/require-super-admin"
import { isResetMode, resetAccountBilling } from "@/lib/billing/admin"

export const dynamic = "force-dynamic"

/**
 * Bir hesabın (kök firma) abonelik/kullanımını test için sıfırlar. Süper-admin korumalı.
 * Body: { companyId: string, mode: "trial" | "locked" }
 */
export async function POST(request: Request) {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error

  const body = (await request.json().catch(() => null)) as
    | { companyId?: unknown; mode?: unknown }
    | null
  const companyId = typeof body?.companyId === "string" ? body.companyId : ""
  if (!companyId || !isResetMode(body?.mode)) {
    return NextResponse.json({ error: "companyId ve geçerli mode (trial|locked) gerekli" }, { status: 400 })
  }

  try {
    const result = await resetAccountBilling(companyId, body.mode)
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    console.error("billing admin reset error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sıfırlama başarısız" },
      { status: 500 },
    )
  }
}
