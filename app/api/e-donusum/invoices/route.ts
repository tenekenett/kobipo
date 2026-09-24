import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"
import { createInvoiceFromBody } from "@/lib/invoice/create-invoice"
import { sessionWriteActor } from "@/lib/api/session-actor"


export const dynamic = 'force-dynamic'

export const GET = withApiErrors(async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    const type = searchParams.get("type")
    const status = searchParams.get("status")
    // Karşı taraf süzgeci: irsaliye→fatura eşleştirme penceresi yalnız o
    // tedarikçinin faturalarını ister; tüm alışları çekip istemcide süzmesin.
    const customerId = searchParams.get("customerId")
    const supplierId = searchParams.get("supplierId")

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)
    // Yalnız varlık denetimi; liste e-Dönüşüm kimliklerini kullanmaz.
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true },
    })
    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 })
    }

    const where: any = {
      companyId,
    }

    if (type) {
      where.type = type
    }

    if (status) {
      where.status = status
    }

    if (customerId) where.customerId = customerId
    if (supplierId) where.supplierId = supplierId

    // LİSTE ucu: yalnız fatura başlığı + karşı taraf adı. Eskiden her faturaya
    // tüm kalemler, her kalemin TAM ürün kaydı ve tam cari kaydı ekleniyordu;
    // hiçbir liste ekranı bunları okumuyordu ama 300 faturalık firma sayfayı
    // açınca ~900 KB indiriyordu (ölçüldü, 2026-09-16). Kalem gereken tek
    // yer detay/düzenleme ekranıdır, o `[id]` ucundan okur. Invoice'un 47
    // skalar sütunu var; listeler bunların ~15'ini okuyor (e-donusum/page,
    // alis/irsaliye eşleştirme). Yeni alan gerekirse buraya eklenir.
    const invoices = await prisma.invoice.findMany({
      where,
      select: {
        id: true,
        slug: true,
        invoiceNo: true,
        type: true,
        invoiceType: true,
        status: true,
        date: true,
        dueDate: true,
        currency: true,
        netAmount: true,
        vatAmount: true,
        totalAmount: true,
        customerId: true,
        supplierId: true,
        uuid: true,
        eDocumentNo: true,
        integrationStatus: true,
        isReceipt: true,
        returnKind: true,
        createdAt: true,
        customer: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
      },
      orderBy: { date: "desc" },
    })

    return NextResponse.json(invoices)
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error fetching invoices:", error)
    return NextResponse.json(
      { error: message || "Internal server error" },
      { status: 500 }
    )
  }
})

/**
 * Fatura/fiş oluşturur. İş mantığı lib/invoice/create-invoice.ts'te (oturumsuz
 * çağrılabilsin diye — ÖKC webhook'u, docs/okc/ASAMA1-KOBIPO.md A5).
 */
export const POST = withApiErrors(async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return createInvoiceFromBody(() => request.json(), sessionWriteActor(user.id))
})
