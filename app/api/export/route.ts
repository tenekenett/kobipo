import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import * as XLSX from "xlsx"
import { XMLBuilder } from "fast-xml-parser"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const sp = new URL(request.url).searchParams
  const companyId = sp.get("companyId")
  const moduleName = sp.get("module")
  const format = (sp.get("format") || "csv").toLowerCase()
  if (!companyId || !moduleName) return NextResponse.json({ error: "companyId and module are required" }, { status: 400 })
  await ensureCompanyAccess(companyId)

  let headers: string[] = []
  let dataRows: string[][] = []

  const asCsv = () => [headers.join(","), ...dataRows.map((row) => row.map((cell) => String(cell ?? "")).join(","))].join("\n")
  const asXlsx = () => {
    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...dataRows])
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, "Veri")
    return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" })
  }

  if (moduleName === "customers") {
    const items = await prisma.customer.findMany({ where: { companyId } })
    headers = ["Kod", "Ad", "VergiNo", "Telefon", "Email", "Adres", "Sehir"]
    dataRows = items.map((i) => [i.code || "", i.name, i.taxNumber || "", i.phone || "", i.email || "", i.address || "", i.city || ""])
  } else if (moduleName === "suppliers") {
    const items = await prisma.supplier.findMany({ where: { companyId } })
    headers = ["Kod", "Ad", "VergiNo", "Telefon", "Email", "Adres", "Sehir"]
    dataRows = items.map((i) => [i.code || "", i.name, i.taxNumber || "", i.phone || "", i.email || "", i.address || "", i.city || ""])
  } else if (moduleName === "products") {
    const items = await prisma.product.findMany({ where: { companyId } })
    headers = ["Kod", "Ad", "Barkod", "Birim", "Stok", "AlisFiyati", "SatisFiyati", "KdvOrani"]
    dataRows = items.map((i) => [
      i.code || "",
      i.name,
      i.barcode || "",
      i.unit,
      String(i.stockQuantity),
      i.purchasePrice ? String(i.purchasePrice) : "",
      i.salePrice ? String(i.salePrice) : "",
      String(i.vatRate),
    ])
  } else if (moduleName === "invoices") {
    const items = await prisma.invoice.findMany({
      where: { companyId },
      include: { customer: true, supplier: true, items: true },
      orderBy: { date: "desc" },
    })
    if (format === "xml") {
      const firstInvoice = items[0]
      if (!firstInvoice) return NextResponse.json({ error: "Export edilecek fatura yok" }, { status: 404 })
      const builder = new XMLBuilder({ ignoreAttributes: false, format: true })
      const xmlObject = {
        Invoice: {
          ID: firstInvoice.invoiceNo,
          IssueDate: firstInvoice.date.toISOString().split("T")[0],
          DocumentCurrencyCode: firstInvoice.currency || "TRY",
          AccountingCustomerParty: {
            Party: {
              PartyName: {
                Name: firstInvoice.customer?.name || "",
              },
            },
          },
          AccountingSupplierParty: {
            Party: {
              PartyName: {
                Name: firstInvoice.supplier?.name || "",
              },
            },
          },
          InvoiceLine: firstInvoice.items.map((line) => ({
            ID: String(line.order + 1),
            InvoicedQuantity: Number(line.quantity),
            LineExtensionAmount: Number(line.totalAmount),
            TaxTotal: {
              TaxSubtotal: {
                Percent: Number(line.vatRate),
              },
            },
            Item: {
              Name: line.description,
            },
            Price: {
              PriceAmount: Number(line.unitPrice),
            },
          })),
        },
      }
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(xmlObject)}`
      return new NextResponse(xml, {
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Content-Disposition": `attachment; filename="${firstInvoice.invoiceNo}.xml"`,
        },
      })
    }
    headers = ["InvoiceNo", "Type", "InvoiceType", "Date", "KarsiTaraf", "Currency", "NetAmount", "VatAmount", "TotalAmount", "Notes"]
    dataRows = items.map((i) => [
      i.invoiceNo,
      i.type,
      i.invoiceType,
      i.date.toISOString(),
      i.customer?.name || i.supplier?.name || "",
      i.currency || "TRY",
      String(i.netAmount),
      String(i.vatAmount),
      String(i.totalAmount),
      i.notes || "",
    ])
  } else {
    return NextResponse.json({ error: "Unsupported module" }, { status: 400 })
  }

  if (format === "xlsx") {
    const xlsxBuffer = asXlsx()
    return new NextResponse(xlsxBuffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${moduleName}.xlsx"`,
      },
    })
  }

  const csv = asCsv()
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${moduleName}.csv"`,
    },
  })
}
