import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * MANUAL fatura için "Onayla" aksiyonu: status DRAFT → SENT.
 *
 * E-fatura/E-arşiv'in kendi gönderim akışı (provider'a iletmek + UUID alıp
 * status=SENT yapmak) /api/e-donusum/invoices route üzerinden ya da
 * önizlemedeki "Gönder" butonundan tetikleniyor. Bu endpoint sadece MANUAL
 * türde (e-belge zorunluluğu olmayan) faturalar için onay kapısı.
 *
 * Stok hareketi / cari bakiye zaten POST aşamasında işleniyor — burada
 * yalnızca status alanı güncellenir.
 */
export const POST = withApiErrors(async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { id } = await params
    const invoice = await prisma.invoice.findUnique({ where: { id } })
    if (!invoice) {
      return NextResponse.json({ error: "Fatura bulunamadı" }, { status: 404 })
    }

    await ensureCompanyWrite(invoice.companyId)

    if (invoice.status !== "DRAFT") {
      return NextResponse.json(
        { error: "Sadece taslak faturalar onaylanabilir" },
        { status: 400 },
      )
    }

    if (invoice.invoiceType !== "MANUAL") {
      return NextResponse.json(
        {
          error:
            "Bu fatura e-belge — onay için önizlemedeki 'Gönder' butonunu kullanın.",
        },
        { status: 400 },
      )
    }

    const updated = await prisma.invoice.update({
      where: { id },
      data: { status: "SENT" },
    })

    return NextResponse.json({ id: updated.id, status: updated.status })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("approve invoice error:", error)
    return NextResponse.json(
      { error: message || "Onaylama sırasında hata oluştu" },
      { status: 500 },
    )
  }
})
