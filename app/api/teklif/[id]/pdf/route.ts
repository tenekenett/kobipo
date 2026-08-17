import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { resolveSlugId } from "@/lib/slug-resolve"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { renderTeklifPdf } from "@/lib/pdf/documents/teklif-document"
import { accessDeniedResponse } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Teklif PDF'i.
 *
 * Yerleşim `lib/pdf/documents/teklif-document.ts` içinde AKIŞ tabanlı kurulur
 * (pdfmake); bu uç yalnız veriyi toplayıp belgeye verir. Önceki sürüm jsPDF ile
 * mutlak mm koordinatlarına çiziyordu: sarma uygulanmayan alanlar (adres, vergi
 * dairesi, e-posta) sayfa dışına taşıyor, uzun unvan sağdaki blokla çakışıyordu
 * — ölçülen bir örnekte adres 210mm'lik sayfada 251mm'de bitiyordu. Ölçüm ve
 * satır sarma artık motorun işi; regresyon testi:
 * `lib/pdf/doc/teklif-pdf-layout.test.ts`.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: rawId } = await params
    const url = new URL(request.url)
    // Teklif id'si dashboard'dan slug (teklif no) gelebilir → cuid'e çevir. [[slug-resolve.ts]]
    const scopeCompanyId = await resolveCompanyId(
      url.searchParams.get("companyId") || url.searchParams.get("company"),
    )
    const id = await resolveSlugId("quote", rawId, scopeCompanyId)

    const quote = await prisma.quote.findUnique({
      where: { id },
      include: {
        customer: true,
        supplier: true,
        items: { include: { product: true }, orderBy: { order: "asc" } },
        company: {
          select: {
            id: true,
            name: true,
            taxNumber: true,
            taxOffice: true,
            address: true,
            city: true,
            country: true,
            phone: true,
            email: true,
            website: true,
          },
        },
      },
    })

    if (!quote) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 })
    }

    await ensureCompanyAccess(quote.companyId)

    const bankAccounts = await prisma.financialAccount.findMany({
      where: { companyId: quote.companyId, type: "BANK", isActive: true },
      orderBy: { name: "asc" },
      select: { name: true, bankName: true, accountNumber: true, iban: true, currency: true },
    })

    const recipient = quote.customer || quote.supplier
    const discountTotal = quote.items.reduce((sum, item) => sum + Number(item.discountAmount || 0), 0)

    const pdfBuffer = await renderTeklifPdf({
      quoteNo: quote.quoteNo,
      date: quote.date,
      validUntil: quote.validUntil,
      currency: quote.currency || "TRY",
      notes: quote.notes,
      company: quote.company,
      counterparty: recipient,
      counterpartyLabel: quote.customer ? "MÜŞTERİ BİLGİLERİ" : "ALICI BİLGİLERİ",
      lines: quote.items.map((item) => ({
        description: item.description,
        note: item.note,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        discountAmount: Number(item.discountAmount || 0),
        vatRate: Number(item.vatRate),
        totalAmount: Number(item.totalAmount),
      })),
      netAmount: Number(quote.netAmount),
      vatAmount: Number(quote.vatAmount),
      totalAmount: Number(quote.totalAmount),
      discountTotal,
      bankAccounts,
    })

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Teklif_${quote.quoteNo}.pdf"`,
      },
    })
  } catch (error: any) {
    if (error?.message?.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error generating quote PDF:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
