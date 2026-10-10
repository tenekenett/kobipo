import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/** Listenin en büyük sayfası kadar: "sayfadakilerin hepsini seç" tek istekte gider. */
const MAX_UUIDS = 500

/**
 * Gelen e-faturayı LİSTEDE gizler ya da geri gösterir.
 *
 * Path: POST /api/e-donusum/inbox/hide
 * Body: { companyId: string, uuids: string[], hidden: boolean }
 *
 * Belge silinmez, Mysoft'a/GİB'e hiçbir şey gitmez: yalnız Kobipo'nun `hiddenAt`
 * bayrağı yazılır (firma bazında — gizleyen herkes için gizler). Gizlenen faturanın
 * nereden düştüğü: lib/integrations/e-invoice/incoming-list-query.ts →
 * IncomingHiddenFilter. Zaten o durumda olan satıra dokunulmaz; ilk gizleme anı ve
 * gizleyen korunur.
 */
export const POST = withApiErrors(async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const companyId = await resolveCompanyId(body?.companyId)
    if (!companyId) {
      return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    }
    if (typeof body?.hidden !== "boolean") {
      return NextResponse.json({ error: "hidden (true | false) zorunlu" }, { status: 400 })
    }
    const hidden: boolean = body.hidden
    const uuids = Array.isArray(body?.uuids)
      ? [
          ...new Set(
            (body.uuids as unknown[])
              .filter((u): u is string => typeof u === "string")
              .map((u) => u.trim())
              .filter(Boolean),
          ),
        ]
      : []
    if (uuids.length === 0) {
      return NextResponse.json({ error: "En az bir fatura seçin." }, { status: 400 })
    }
    if (uuids.length > MAX_UUIDS) {
      return NextResponse.json(
        { error: `Tek seferde en fazla ${MAX_UUIDS} fatura ${hidden ? "gizlenebilir" : "geri alınabilir"}.` },
        { status: 400 },
      )
    }

    await ensureCompanyWrite(companyId)

    const result = hidden
      ? await prisma.incomingInvoice.updateMany({
          where: { companyId, uuid: { in: uuids }, hiddenAt: null },
          data: { hiddenAt: new Date(), hiddenById: user.id },
        })
      : await prisma.incomingInvoice.updateMany({
          where: { companyId, uuid: { in: uuids }, hiddenAt: { not: null } },
          data: { hiddenAt: null, hiddenById: null },
        })

    return NextResponse.json({ ok: true, hidden, requested: uuids.length, updated: result.count })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("inbox hide route error:", error)
    return NextResponse.json(
      { error: message || "Gizleme sırasında hata oluştu." },
      { status: 500 },
    )
  }
})
