import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { XMLParser } from "fast-xml-parser"
import * as XLSX from "xlsx"

export const dynamic = "force-dynamic"

function parseCsv(csv: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ""
  let inQuotes = false

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i]
    const next = csv[i + 1]

    if (char === '"' && inQuotes && next === '"') {
      cell += '"'
      i++
      continue
    }
    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }
    if (char === "," && !inQuotes) {
      row.push(cell.trim())
      cell = ""
      continue
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i++
      row.push(cell.trim())
      if (row.some((item) => item !== "")) rows.push(row)
      row = []
      cell = ""
      continue
    }
    cell += char
  }

  row.push(cell.trim())
  if (row.some((item) => item !== "")) rows.push(row)
  return rows
}

function toRowsFromXlsx(base64Content: string): string[][] {
  const buffer = Buffer.from(base64Content, "base64")
  const workbook = XLSX.read(buffer, { type: "buffer" })
  const firstSheet = workbook.SheetNames[0]
  if (!firstSheet) return []
  const sheet = workbook.Sheets[firstSheet]
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as string[][]
}

function getNodeValue(node: any, fallback = ""): string {
  if (node == null) return fallback
  if (typeof node === "string") return node
  if (typeof node === "number") return String(node)
  if (typeof node === "object") {
    if ("#text" in node) return String(node["#text"])
    if ("_" in node) return String(node._)
  }
  return fallback
}

function parseUblInvoices(xml: string) {
  const parser = new XMLParser({ ignoreAttributes: false })
  const parsed = parser.parse(xml)
  const root = parsed.Invoice || parsed["ubl:Invoice"]
  if (!root) {
    throw new Error("Geçerli bir UBL Invoice XML bulunamadı")
  }

  const invoiceNo = getNodeValue(root.ID)
  const date = getNodeValue(root.IssueDate)
  const currency = getNodeValue(root.DocumentCurrencyCode, "TRY")

  const accountingCustomerParty = root.AccountingCustomerParty || {}
  const accountingSupplierParty = root.AccountingSupplierParty || {}
  const customerName =
    getNodeValue(
      accountingCustomerParty?.Party?.PartyName?.Name ||
        accountingCustomerParty?.Party?.PartyLegalEntity?.RegistrationName
    ) || ""
  const supplierName =
    getNodeValue(
      accountingSupplierParty?.Party?.PartyName?.Name ||
        accountingSupplierParty?.Party?.PartyLegalEntity?.RegistrationName
    ) || ""

  const linesRaw = root.InvoiceLine
  const lines = Array.isArray(linesRaw) ? linesRaw : linesRaw ? [linesRaw] : []
  const items = lines.map((line: any) => {
    const quantity = Number(getNodeValue(line.InvoicedQuantity, "0")) || 0
    const unitPrice = Number(getNodeValue(line.Price?.PriceAmount, "0")) || 0
    const vatRate = Number(getNodeValue(line.TaxTotal?.TaxSubtotal?.Percent, "20")) || 20
    const description = getNodeValue(line.Item?.Name, "Kalem")
    return {
      description,
      quantity,
      unitPrice,
      vatRate,
      discountRate: 0,
      withholdingRate: 0,
      exciseRate: 0,
    }
  })

  return {
    invoiceNo,
    date,
    currency,
    customerName,
    supplierName,
    items,
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const { companyId, module, csv, fileBase64, format = "csv", dryRun = false } = body

  if (!companyId || !module) {
    return NextResponse.json({ error: "companyId and module are required" }, { status: 400 })
  }
  await ensureCompanyAccess(companyId)
  const errors: Array<{ row: number; error: string }> = []
  let imported = 0

  if (module === "invoices-ubl") {
    if (!fileBase64 && !csv) {
      return NextResponse.json({ error: "XML content is required" }, { status: 400 })
    }
    try {
      const xmlContent = fileBase64 ? Buffer.from(String(fileBase64), "base64").toString("utf-8") : String(csv || "")
      const ublInvoice = parseUblInvoices(xmlContent)
      const normalizedInvoiceNo = String(ublInvoice.invoiceNo || "").trim()
      if (!normalizedInvoiceNo) {
        throw new Error("UBL zorunlu alan hatası: ID (invoiceNo) boş olamaz")
      }
      if (!ublInvoice.date) {
        throw new Error("UBL zorunlu alan hatası: IssueDate boş olamaz")
      }
      if (!ublInvoice.items.length) {
        throw new Error("UBL zorunlu alan hatası: En az bir InvoiceLine bulunmalı")
      }

      const duplicateInvoice = await prisma.invoice.findFirst({
        where: { companyId, invoiceNo: normalizedInvoiceNo },
        select: { id: true, invoiceNo: true },
      })
      if (duplicateInvoice) {
        throw new Error(`Bu fatura zaten içe aktarılmış: ${normalizedInvoiceNo}`)
      }

      let customerId: string | null = null
      if (ublInvoice.customerName) {
        const existingCustomer = await prisma.customer.findFirst({
          where: { companyId, name: ublInvoice.customerName },
        })
        if (existingCustomer) {
          customerId = existingCustomer.id
        } else {
          const created = await prisma.customer.create({
            data: {
              companyId,
              name: ublInvoice.customerName,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          })
          customerId = created.id
        }
      }

      let supplierId: string | null = null
      if (ublInvoice.supplierName) {
        const existingSupplier = await prisma.supplier.findFirst({
          where: { companyId, name: ublInvoice.supplierName },
        })
        if (existingSupplier) {
          supplierId = existingSupplier.id
        } else {
          const created = await prisma.supplier.create({
            data: {
              companyId,
              name: ublInvoice.supplierName,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          })
          supplierId = created.id
        }
      }

      let netAmount = 0
      let vatAmount = 0
      let totalAmount = 0
      ublInvoice.items.forEach((item) => {
        const lineNet = item.quantity * item.unitPrice
        const lineVat = lineNet * (item.vatRate / 100)
        netAmount += lineNet
        vatAmount += lineVat
        totalAmount += lineNet + lineVat
      })

      const preview = {
        invoiceNo: normalizedInvoiceNo,
        date: ublInvoice.date,
        currency: ublInvoice.currency || "TRY",
        customerName: ublInvoice.customerName || null,
        supplierName: ublInvoice.supplierName || null,
        itemCount: ublInvoice.items.length,
        netAmount,
        vatAmount,
        totalAmount,
      }

      if (dryRun) {
        return NextResponse.json({
          success: true,
          module,
          imported: 0,
          failed: 0,
          errors: [],
          dryRun: true,
          preview,
        })
      }

      await prisma.invoice.create({
        data: {
          companyId,
          invoiceNo: normalizedInvoiceNo,
          type: "PURCHASE",
          invoiceType: "MANUAL",
          status: "DRAFT",
          customerId,
          supplierId,
          date: ublInvoice.date ? new Date(ublInvoice.date) : new Date(),
          currency: ublInvoice.currency || "TRY",
          netAmount,
          vatAmount,
          totalAmount,
          notes: "UBL/XML içe aktarımdan oluşturuldu",
          createdBy: user.id,
          items: {
            create: ublInvoice.items.map((item, index) => ({
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              discountRate: item.discountRate,
              discountAmount: item.quantity * item.unitPrice * (item.discountRate / 100),
              vatRate: item.vatRate,
              vatAmount: item.quantity * item.unitPrice * (item.vatRate / 100),
              withholdingRate: item.withholdingRate,
              withholdingAmount: 0,
              exciseRate: item.exciseRate,
              exciseAmount: 0,
              totalAmount: item.quantity * item.unitPrice * (1 + item.vatRate / 100),
              order: index,
            })),
          },
        },
      })

      imported = 1
    } catch (error: any) {
      return NextResponse.json({ error: error.message || "UBL/XML içe aktarma hatası" }, { status: 400 })
    }
    return NextResponse.json({ success: true, module, imported, failed: 0, errors: [] })
  }

  const rows = format === "xlsx" ? toRowsFromXlsx(String(fileBase64 || "")) : parseCsv(String(csv || ""))
  if (rows.length < 2) {
    return NextResponse.json({ error: "Dosya başlık ve en az bir satır içermeli" }, { status: 400 })
  }

  const headers = rows[0].map((value) => String(value).toLowerCase())
  const dataRows = rows.slice(1)

  if (module === "customers") {
    for (let index = 0; index < dataRows.length; index++) {
      const row = dataRows[index]
      try {
        const get = (name: string) => row[headers.indexOf(name)] || ""
        const name = get("name")
        if (!name) throw new Error("name is required")

        await prisma.customer.create({
          data: {
            companyId,
            code: get("code") || null,
            name,
            taxNumber: get("taxnumber") || null,
            phone: get("phone") || null,
            email: get("email") || null,
            address: get("address") || null,
            city: get("city") || null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        })
        imported++
      } catch (error: any) {
        errors.push({ row: index + 2, error: error.message || "failed" })
      }
    }
  } else if (module === "products") {
    for (let index = 0; index < dataRows.length; index++) {
      const row = dataRows[index]
      try {
        const get = (name: string) => row[headers.indexOf(name)] || ""
        const name = get("name")
        if (!name) throw new Error("name is required")

        await prisma.product.create({
          data: {
            companyId,
            code: get("code") || null,
            name,
            barcode: get("barcode") || null,
            unit: get("unit") || "ADET",
            stockQuantity: Number(get("stockquantity") || 0),
            purchasePrice: get("purchaseprice") ? Number(get("purchaseprice")) : null,
            salePrice: get("saleprice") ? Number(get("saleprice")) : null,
            vatRate: Number(get("vatrate") || 20),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        })
        imported++
      } catch (error: any) {
        errors.push({ row: index + 2, error: error.message || "failed" })
      }
    }
  } else if (module === "suppliers") {
    for (let index = 0; index < dataRows.length; index++) {
      const row = dataRows[index]
      try {
        const get = (name: string) => row[headers.indexOf(name)] || ""
        const name = get("name")
        if (!name) throw new Error("name is required")

        await prisma.supplier.create({
          data: {
            companyId,
            code: get("code") || null,
            name,
            taxNumber: get("taxnumber") || null,
            phone: get("phone") || null,
            email: get("email") || null,
            address: get("address") || null,
            city: get("city") || null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        })
        imported++
      } catch (error: any) {
        errors.push({ row: index + 2, error: error.message || "failed" })
      }
    }
  } else if (module === "invoices") {
    for (let index = 0; index < dataRows.length; index++) {
      const row = dataRows[index]
      try {
        const get = (name: string) => row[headers.indexOf(name)] || ""
        const invoiceNo = String(get("invoiceno") || "").trim()
        if (!invoiceNo) throw new Error("invoiceNo is required")
        const date = String(get("date") || "")
        const type = String(get("type") || "SALES").toUpperCase()
        const invoiceType = String(get("invoicetype") || "MANUAL").toUpperCase()
        const netAmount = Number(get("netamount") || 0)
        const vatAmount = Number(get("vatamount") || 0)
        const totalAmount = Number(get("totalamount") || 0)

        const duplicateInvoice = await prisma.invoice.findFirst({
          where: { companyId, invoiceNo },
          select: { id: true },
        })
        if (duplicateInvoice) throw new Error("invoiceNo already exists")

        if (dryRun) {
          imported++
          continue
        }

        await prisma.invoice.create({
          data: {
            companyId,
            invoiceNo,
            type,
            invoiceType,
            status: "DRAFT",
            date: date ? new Date(date) : new Date(),
            netAmount,
            vatAmount,
            totalAmount,
            currency: String(get("currency") || "TRY"),
            notes: String(get("notes") || ""),
            createdBy: user.id,
          },
        })
        imported++
      } catch (error: any) {
        errors.push({ row: index + 2, error: error.message || "failed" })
      }
    }
  } else {
    return NextResponse.json(
      { error: "Unsupported module. Use 'customers', 'suppliers', 'products', 'invoices' or 'invoices-ubl'" },
      { status: 400 }
    )
  }

  return NextResponse.json({
    success: true,
    module,
    imported,
    failed: errors.length,
    errors,
  })
}
