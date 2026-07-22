import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import {
  generateGibInvoicePdfBuffer,
  type GibInvoiceLine,
  type GibDocKind,
} from "@/lib/pdf/gib-invoice-pdf"

export const dynamic = "force-dynamic"

/**
 * Kaydedilmemiş fatura verisinden GİB düzeninde TASLAK PDF üretir.
 *
 * Editördeki "Önizle (GİB)" akışı bunu çağırır: fatura DB'ye yazılmadan, resmî
 * belge görünümünde bir ön izleme döner. Toplam hesabı, kayıt endpoint'i
 * (`POST /api/e-donusum/invoices`) ile birebir aynı formülleri kullanır ki
 * ön izleme ile kaydedilecek fatura tutarları tutsun.
 */

function isMeaningfulItem(item: any): boolean {
  if (!item || typeof item !== "object") return false
  const hasProduct = typeof item.productId === "string" && item.productId.trim() !== ""
  const quantity = parseFloat(item.quantity) || 0
  const unitPrice = parseFloat(item.unitPrice) || 0
  const hasDescription = typeof item.description === "string" && item.description.trim() !== ""
  return hasProduct || quantity > 0 || unitPrice > 0 || hasDescription
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const companyId = await resolveCompanyId(body.companyId)
    if (!companyId) {
      return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    }
    await ensureCompanyWrite(companyId)

    const rawItems: any[] = Array.isArray(body.items) ? body.items : []
    const meaningfulItems = rawItems.filter(isMeaningfulItem)
    if (meaningfulItems.length === 0) {
      return NextResponse.json(
        { error: "Önizleme için en az bir fatura kalemi gerekli" },
        { status: 400 },
      )
    }

    const type: "SALES" | "PURCHASE" | "RETURN" =
      body.type === "PURCHASE" ? "PURCHASE" : body.type === "RETURN" ? "RETURN" : "SALES"
    const invoiceTypeRaw = String(body.invoiceType || "MANUAL").toUpperCase()
    const invoiceType: GibDocKind =
      invoiceTypeRaw === "E_INVOICE" ? "E_INVOICE" : invoiceTypeRaw === "E_ARCHIVE" ? "E_ARCHIVE" : "MANUAL"

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        name: true,
        taxNumber: true,
        taxOffice: true,
        address: true,
        city: true,
        phone: true,
        email: true,
      },
    })
    if (!company) {
      return NextResponse.json({ error: "Firma bulunamadı" }, { status: 404 })
    }

    // Karşı taraf (müşteri/tedarikçi) — DB'den yetkili bilgiyle çekilir.
    let counterparty = null as null | {
      name: string
      taxNumber?: string | null
      taxOffice?: string | null
      address?: string | null
      district?: string | null
      city?: string | null
      phone?: string | null
      email?: string | null
    }
    const partySelect = {
      companyId: true,
      name: true,
      taxNumber: true,
      taxOffice: true,
      address: true,
      district: true,
      city: true,
      phone: true,
      email: true,
    } as const
    if (type === "SALES" && body.customerId) {
      const c = await prisma.customer.findUnique({ where: { id: String(body.customerId) }, select: partySelect })
      if (c && c.companyId === companyId) counterparty = c
    } else if (body.supplierId) {
      const s = await prisma.supplier.findUnique({ where: { id: String(body.supplierId) }, select: partySelect })
      if (s && s.companyId === companyId) counterparty = s
    } else if (body.customerId) {
      const c = await prisma.customer.findUnique({ where: { id: String(body.customerId) }, select: partySelect })
      if (c && c.companyId === companyId) counterparty = c
    }

    // --- Toplam hesabı (POST /api/e-donusum/invoices ile birebir aynı) ---
    const norm = meaningfulItems.map((item) => {
      const discountMode =
        typeof item.discountMode === "string" && item.discountMode.toUpperCase() === "AMOUNT"
          ? "AMOUNT"
          : "PERCENT"
      return {
        description: typeof item.description === "string" ? item.description.trim() : "",
        unit: typeof item.unit === "string" && item.unit.trim() ? item.unit.trim().toUpperCase() : "ADET",
        quantity: parseFloat(item.quantity) || 0,
        unitPrice: parseFloat(item.unitPrice) || 0,
        discountRate: parseFloat(item.discountRate) || 0,
        discountAmount: parseFloat(item.discountAmount) || 0,
        discountMode,
        vatRate: parseFloat(item.vatRate) || 0,
        withholdingRate: parseFloat(item.withholdingRate) || 0,
        exciseRate: parseFloat(item.exciseRate) || 0,
        otherTaxRate: parseFloat(item.otherTaxRate) || 0,
        otherTaxName:
          typeof item.otherTaxName === "string" && item.otherTaxName.trim() ? item.otherTaxName.trim() : null,
      }
    })

    const lineDiscountOf = (it: (typeof norm)[number]) => {
      const gross = it.quantity * it.unitPrice
      if (it.discountMode === "AMOUNT") return Math.max(0, Math.min(it.discountAmount, gross))
      return gross * (it.discountRate / 100)
    }

    let grossTotal = 0
    let lineDiscountTotal = 0
    let netAmount = 0
    let vatAmount = 0
    let withholdingAmount = 0
    let exciseAmount = 0
    let otherTaxAmount = 0
    let otherTaxLabel: string | null = null

    const lines: GibInvoiceLine[] = norm.map((it) => {
      const gross = it.quantity * it.unitPrice
      const disc = lineDiscountOf(it)
      const net = gross - disc
      const vat = net * (it.vatRate / 100)
      const withholding = vat * (it.withholdingRate / 100)
      const excise = net * (it.exciseRate / 100)
      const otherTax = net * (it.otherTaxRate / 100)

      grossTotal += gross
      lineDiscountTotal += disc
      netAmount += net
      vatAmount += vat
      withholdingAmount += withholding
      exciseAmount += excise
      otherTaxAmount += otherTax
      if (otherTax > 0 && it.otherTaxName && !otherTaxLabel) otherTaxLabel = it.otherTaxName

      return {
        description: it.description,
        quantity: it.quantity,
        unit: it.unit,
        unitPrice: it.unitPrice,
        discountAmount: disc,
        discountRate: it.discountRate,
        vatRate: it.vatRate,
        vatAmount: vat,
        withholdingRate: it.withholdingRate,
        lineNet: net,
      }
    })

    let totalAmount = netAmount + vatAmount + exciseAmount + otherTaxAmount - withholdingAmount

    // Fatura altı (genel) iskonto — matrahtan oransal düşülür.
    const rawGlobal = Math.max(0, parseFloat(body.globalDiscountAmount) || 0)
    const appliedGlobalDiscount = netAmount > 0 ? Math.min(rawGlobal, netAmount) : 0
    if (appliedGlobalDiscount > 0 && netAmount > 0) {
      const adjustment = 1 - appliedGlobalDiscount / netAmount
      netAmount -= appliedGlobalDiscount
      vatAmount *= adjustment
      withholdingAmount *= adjustment
      exciseAmount *= adjustment
      otherTaxAmount *= adjustment
      totalAmount *= adjustment
    }

    const pdfBuffer = await generateGibInvoicePdfBuffer({
      invoiceNo: typeof body.invoiceNo === "string" ? body.invoiceNo.trim() : "",
      ettn: null,
      date: body.date || new Date().toISOString(),
      dueDate: body.dueDate || null,
      type,
      invoiceType,
      currency: typeof body.currency === "string" ? body.currency : "TRY",
      isDraft: true,
      company: {
        name: company.name,
        taxNumber: company.taxNumber,
        taxOffice: company.taxOffice,
        address: company.address,
        city: company.city,
        phone: company.phone,
        email: company.email,
      },
      counterparty,
      items: lines,
      totals: {
        grossTotal,
        lineDiscountTotal,
        globalDiscount: appliedGlobalDiscount,
        netAmount,
        vatAmount,
        withholdingAmount,
        exciseAmount,
        otherTaxAmount,
        otherTaxLabel,
        totalAmount,
      },
      notes: typeof body.notes === "string" ? body.notes : null,
    })

    return new NextResponse(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="taslak-fatura.pdf"`,
        "Content-Length": String(pdfBuffer.length),
        "Cache-Control": "no-store",
      },
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error generating preview PDF:", error)
    return NextResponse.json({ error: message || "Önizleme PDF üretilemedi" }, { status: 500 })
  }
}
