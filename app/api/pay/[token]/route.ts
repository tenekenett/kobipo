import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { Decimal } from "@prisma/client/runtime/library"
import {
  PAYMENT_LINKS_DISABLED_MESSAGE,
  PAYMENT_LINKS_ENABLED,
} from "@/lib/faturalar/payment-links"

export const dynamic = "force-dynamic"

/** Özellik pasifken uç hiç veri döndürmez — token'ı bilen fatura bilgisini de göremez. */
function disabledResponse() {
  return NextResponse.json({ error: PAYMENT_LINKS_DISABLED_MESSAGE }, { status: 503 })
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  if (!PAYMENT_LINKS_ENABLED) return disabledResponse()
  const { token } = await params
  const link = await prisma.paymentLink.findUnique({
    where: { token },
    include: {
      invoice: {
        include: {
          customer: true,
          supplier: true,
          payments: true,
        },
      },
    },
  })
  if (!link) return NextResponse.json({ error: "Link not found" }, { status: 404 })

  const totalPaid = link.invoice.payments.reduce((sum, item) => sum + Number(item.amount), 0)
  return NextResponse.json({
    id: link.id,
    token: link.token,
    status: link.status,
    expiresAt: link.expiresAt,
    amount: Number(link.amount),
    currency: link.currency,
    invoice: {
      id: link.invoice.id,
      invoiceNo: link.invoice.invoiceNo,
      totalAmount: Number(link.invoice.totalAmount),
      totalPaid,
      remainingAmount: Math.max(Number(link.invoice.totalAmount) - totalPaid, 0),
      customerName: link.invoice.customer?.name || link.invoice.supplier?.name || null,
    },
  })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  // Bu uç oturum aramaz ve doğrudan tahsilat KAYDI yazar; sağlayıcı doğrulaması
  // eklenene kadar kapalı. [[lib/faturalar/payment-links.ts]]
  if (!PAYMENT_LINKS_ENABLED) return disabledResponse()
  const { token } = await params

  // GÜVENLİ JSON OKUMA: Body boş gelirse hata vermemesi için try-catch
  let body: any = {}
  try {
    const contentType = request.headers.get("content-type")
    if (contentType && contentType.includes("application/json")) {
      body = await request.json()
    }
  } catch (e) {
    body = {} 
  }

  const { paymentMethod = "VIRTUAL_POS", accountId, reference, notes } = body

  const link = await prisma.paymentLink.findUnique({
    where: { token },
    include: {
      invoice: {
        include: {
          payments: true,
        },
      },
    },
  })
  if (!link) return NextResponse.json({ error: "Link not found" }, { status: 404 })
  if (link.status !== "ACTIVE") return NextResponse.json({ error: "Link is not active" }, { status: 400 })
  if (link.expiresAt && link.expiresAt < new Date()) {
    await prisma.paymentLink.update({
      where: { id: link.id },
      data: { status: "EXPIRED" },
    })
    return NextResponse.json({ error: "Link expired" }, { status: 400 })
  }

  const totalPaid = link.invoice.payments.reduce((sum, item) => sum + Number(item.amount), 0)
  const remaining = Number(link.invoice.totalAmount) - totalPaid
  if (remaining <= 0) return NextResponse.json({ error: "Invoice already paid" }, { status: 400 })

  const payAmount = Math.min(Number(link.amount), remaining)
  const payment = await prisma.invoicePayment.create({
    data: {
      invoiceId: link.invoiceId,
      companyId: link.companyId,
      amount: new Decimal(payAmount),
      paymentDate: new Date(),
      paymentMethod,
      accountId: accountId || null,
      reference: reference || link.token,
      notes: notes || "Payment link collection",
    },
  })

  await prisma.paymentLink.update({
    where: { id: link.id },
    data: {
      status: "PAID",
      paidAt: new Date(),
    },
  })

  return NextResponse.json({ success: true, payment })
}