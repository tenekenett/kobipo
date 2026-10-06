import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { resolveSlugId } from "@/lib/slug-resolve"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"
import { faturaEpostaGecmisi, gidenFaturaEpostasi } from "@/lib/fatura-eposta/giden.server"
import { faturaEpostaAdresi, gidenGonderilebilir } from "@/lib/fatura-eposta/kurallar"

export const dynamic = "force-dynamic"
// Mysoft'tan resmî PDF + XML indirip göndermek birkaç saniye sürer.
export const maxDuration = 60

/**
 * Faturayı alıcısına e-postayla gönderir (elle). Kural ve otomatik gönderim:
 * lib/fatura-eposta/giden.server.ts.
 *
 * 2026-10-06'ya kadar bu uç HİÇBİR ŞEY göndermeden "E-posta gönderimi kuyruğa alındı"
 * dönüyordu; önizleme ekranındaki "Gönder" kullanıcıya gönderildiğini düşündürüyordu.
 */

async function resolveInvoice(request: Request, rawId: string, bodyCompany?: string | null) {
  const url = new URL(request.url)
  // Fatura id'si dashboard'dan slug (fatura no) gelebilir → cuid'e çevir. [[slug-resolve.ts]]
  const scopeCompanyId = await resolveCompanyId(
    bodyCompany || url.searchParams.get("companyId") || url.searchParams.get("company"),
  )
  const id = await resolveSlugId("invoice", rawId, scopeCompanyId)
  return prisma.invoice.findUnique({
    where: { id },
    select: {
      id: true,
      companyId: true,
      type: true,
      invoiceType: true,
      status: true,
      uuid: true,
      isReceipt: true,
      customer: { select: { email: true } },
      supplier: { select: { email: true } },
    },
  })
}

/** Geçmiş + varsayılan alıcı + gönderilebilir mi (önizleme ekranı). */
export const GET = withApiErrors(async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id: rawId } = await params
    const invoice = await resolveInvoice(request, rawId)
    if (!invoice) return NextResponse.json({ error: "Fatura bulunamadı" }, { status: 404 })
    await ensureCompanyAccess(invoice.companyId)

    const uygun = gidenGonderilebilir(invoice)
    const cariEposta = (invoice.customer ?? invoice.supplier)?.email ?? null
    const adres = faturaEpostaAdresi(cariEposta)
    return NextResponse.json({
      sendable: uygun.ok,
      reason: uygun.ok ? null : uygun.sebep,
      defaultRecipient: adres.ok ? adres.adresler.join(", ") : null,
      logs: await faturaEpostaGecmisi(invoice.id),
    })
  } catch (error: any) {
    if (error?.message?.includes("Access denied")) return accessDeniedResponse(error)
    console.error("fatura e-posta geçmişi:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const POST = withApiErrors(async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id: rawId } = await params
    const body = await request.json().catch(() => ({}))
    const invoice = await resolveInvoice(request, rawId, body?.companyId)
    if (!invoice) return NextResponse.json({ error: "Fatura bulunamadı" }, { status: 404 })
    await ensureCompanyWrite(invoice.companyId)

    const to = typeof body?.email === "string" ? body.email : undefined
    const result = await gidenFaturaEpostasi(invoice.id, { kind: "MANUAL", to, actorUserId: user.id })
    if (result.ok) {
      return NextResponse.json({ success: true, to: result.recipients })
    }
    const status = result.status === "HATA" ? 502 : 400
    return NextResponse.json({ error: result.error, status: result.status }, { status })
  } catch (error: any) {
    if (error?.message?.includes("Access denied")) return accessDeniedResponse(error)
    console.error("fatura e-postası:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
