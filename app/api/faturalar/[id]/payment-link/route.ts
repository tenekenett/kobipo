import { withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { resolveSlugId } from "@/lib/slug-resolve"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import crypto from "crypto"

export const dynamic = "force-dynamic"

export const GET = withApiErrors(async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id: rawId } = await params
  const url = new URL(request.url)
  // Fatura id'si dashboard'dan slug (fatura no) gelebilir → cuid'e çevir. [[slug-resolve.ts]]
  const scopeCompanyId = await resolveCompanyId(
    url.searchParams.get("companyId") || url.searchParams.get("company"),
  )
  const id = await resolveSlugId("invoice", rawId, scopeCompanyId)

  const invoice = await prisma.invoice.findUnique({ where: { id } })
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
  await ensureCompanyAccess(invoice.companyId)

  const links = await prisma.paymentLink.findMany({
    where: { invoiceId: id },
    orderBy: { createdAt: "desc" },
  })
  return NextResponse.json(links)
})

export const POST = withApiErrors(async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id: rawId } = await params
  const url = new URL(request.url)
  const body = await request.json()
  const { amount, expiresAt } = body
  // Fatura id'si dashboard'dan slug (fatura no) gelebilir → cuid'e çevir. [[slug-resolve.ts]]
  const scopeCompanyId = await resolveCompanyId(
    body.companyId || url.searchParams.get("companyId") || url.searchParams.get("company"),
  )
  const id = await resolveSlugId("invoice", rawId, scopeCompanyId)

  const invoice = await prisma.invoice.findUnique({
    where: { id },
    include: { payments: true },
  })
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
  await ensureCompanyWrite(invoice.companyId)

  const totalPaid = invoice.payments.reduce((sum, item) => sum + Number(item.amount), 0)
  const remaining = Number(invoice.totalAmount) - totalPaid
  if (remaining <= 0) return NextResponse.json({ error: "Invoice already paid" }, { status: 400 })

  const linkAmount = Math.min(Number(amount || remaining), remaining)
  if (linkAmount <= 0) return NextResponse.json({ error: "Invalid amount" }, { status: 400 })

  const token = crypto.randomBytes(24).toString("hex")
  const paymentLink = await prisma.paymentLink.create({
    data: {
      companyId: invoice.companyId,
      invoiceId: invoice.id,
      token,
      amount: linkAmount,
      currency: invoice.currency,
      status: "ACTIVE",
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      createdBy: user.id,
    },
  })

  return NextResponse.json({
    ...paymentLink,
    paymentUrl: `/pay/${token}`,
  })
})
