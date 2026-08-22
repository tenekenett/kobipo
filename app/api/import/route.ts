import { accessDeniedResponse, isAccessDeniedError, withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { XMLParser } from "fast-xml-parser"
import * as XLSX from "xlsx"
import { computeLineTax } from "@/lib/invoice/line-tax"

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

function firstNonEmpty(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const trimmed = String(value || "").trim()
    if (trimmed) return trimmed
  }
  return ""
}

function pickNodeValueByKeySuffix(obj: any, keySuffix: string): string {
  if (!obj || typeof obj !== "object") return ""

  for (const [key, value] of Object.entries(obj)) {
    if (key === keySuffix || key.endsWith(`:${keySuffix}`)) {
      const resolved = getNodeValue(value as any).trim()
      if (resolved) return resolved
    }
  }

  return ""
}

function pickNodeByKeySuffix(obj: any, keySuffix: string): any {
  if (!obj || typeof obj !== "object") return undefined
  for (const [key, value] of Object.entries(obj)) {
    if (key === keySuffix || key.endsWith(`:${keySuffix}`)) {
      return value
    }
  }
  return undefined
}

function collectNodeValuesByKeySuffix(obj: any, keySuffix: string): string[] {
  const values: string[] = []

  const walk = (node: any) => {
    if (node == null) return
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (typeof node !== "object") return

    for (const [key, value] of Object.entries(node)) {
      if (key === keySuffix || key.endsWith(`:${keySuffix}`)) {
        const resolved = getNodeValue(value as any).trim()
        if (resolved) values.push(resolved)
      }
      walk(value)
    }
  }

  walk(obj)
  return values
}

function collectDecimalValuesByKeySuffix(obj: any, keySuffix: string): number[] {
  return collectNodeValuesByKeySuffix(obj, keySuffix)
    .map((value) => parseDecimal(value, Number.NaN))
    .filter((value) => Number.isFinite(value))
}

function normalizeTaxNumber(value: string | null | undefined) {
  return String(value || "").replace(/\D/g, "")
}

function parseDecimal(value: any, fallback = 0) {
  const raw = String(value ?? "").trim()
  if (!raw) return fallback

  const normalized = raw
    .replace(/\s+/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(/,(?=\d{3}(\D|$))/g, "")
    .replace(",", ".")

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeHeader(value: string) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
}

function parseOpeningBalanceType(value: string) {
  const normalized = normalizeHeader(value)
  if (["alacak", "credit", "c"].includes(normalized)) return "CREDIT"
  return "DEBIT"
}

function parseUblInvoices(xml: string) {
  const parser = new XMLParser({ ignoreAttributes: false })
  const parsed = parser.parse(xml)
  const root = parsed.Invoice || parsed["ubl:Invoice"] || parsed["Invoice"] || parsed["inv:Invoice"]
  if (!root) {
    throw new Error("Geçerli bir UBL Invoice XML bulunamadı")
  }

  const invoiceNo = firstNonEmpty(
    getNodeValue(root.ID),
    getNodeValue(root["cbc:ID"]),
    pickNodeValueByKeySuffix(root, "ID")
  )
  const date = firstNonEmpty(
    getNodeValue(root.IssueDate),
    getNodeValue(root["cbc:IssueDate"]),
    pickNodeValueByKeySuffix(root, "IssueDate")
  )
  const currency = firstNonEmpty(
    getNodeValue(root.DocumentCurrencyCode, "TRY"),
    getNodeValue(root["cbc:DocumentCurrencyCode"], "TRY"),
    pickNodeValueByKeySuffix(root, "DocumentCurrencyCode"),
    "TRY"
  )

  const accountingCustomerParty =
    root.AccountingCustomerParty ||
    root["cac:AccountingCustomerParty"] ||
    pickNodeByKeySuffix(root, "AccountingCustomerParty") ||
    {}
  const accountingSupplierParty =
    root.AccountingSupplierParty ||
    root["cac:AccountingSupplierParty"] ||
    pickNodeByKeySuffix(root, "AccountingSupplierParty") ||
    {}
  const customerParty =
    accountingCustomerParty?.Party ||
    accountingCustomerParty?.["cac:Party"] ||
    pickNodeByKeySuffix(accountingCustomerParty, "Party") ||
    {}
  const supplierParty =
    accountingSupplierParty?.Party ||
    accountingSupplierParty?.["cac:Party"] ||
    pickNodeByKeySuffix(accountingSupplierParty, "Party") ||
    {}

  const resolvePartyName = (party: any) =>
    firstNonEmpty(
      getNodeValue(party?.PartyName?.Name),
      getNodeValue(party?.PartyName?.["cbc:Name"]),
      getNodeValue(party?.["cac:PartyName"]?.Name),
      getNodeValue(party?.["cac:PartyName"]?.["cbc:Name"]),
      getNodeValue(party?.PartyLegalEntity?.RegistrationName),
      getNodeValue(party?.PartyLegalEntity?.["cbc:RegistrationName"]),
      getNodeValue(party?.["cac:PartyLegalEntity"]?.RegistrationName),
      getNodeValue(party?.["cac:PartyLegalEntity"]?.["cbc:RegistrationName"]),
      ...collectNodeValuesByKeySuffix(party, "RegistrationName"),
      ...collectNodeValuesByKeySuffix(party, "Name")
    )

  const resolvePartyTaxNumber = (party: any) =>
    firstNonEmpty(
      getNodeValue(party?.PartyTaxScheme?.CompanyID),
      getNodeValue(party?.PartyTaxScheme?.["cbc:CompanyID"]),
      getNodeValue(party?.["cac:PartyTaxScheme"]?.CompanyID),
      getNodeValue(party?.["cac:PartyTaxScheme"]?.["cbc:CompanyID"]),
      getNodeValue(party?.PartyIdentification?.ID),
      getNodeValue(party?.PartyIdentification?.["cbc:ID"]),
      getNodeValue(Array.isArray(party?.PartyIdentification) ? party?.PartyIdentification?.[0]?.ID : ""),
      getNodeValue(Array.isArray(party?.["cac:PartyIdentification"]) ? party?.["cac:PartyIdentification"]?.[0]?.ID : ""),
      ...collectNodeValuesByKeySuffix(party, "CompanyID"),
      ...collectNodeValuesByKeySuffix(party, "ID")
    )

  const customerName = resolvePartyName(customerParty)
  const supplierName = resolvePartyName(supplierParty)
  const customerTaxNumber = resolvePartyTaxNumber(customerParty)
  const supplierTaxNumber = resolvePartyTaxNumber(supplierParty)

  const legalMonetaryTotal =
    root.LegalMonetaryTotal ||
    root["cac:LegalMonetaryTotal"] ||
    pickNodeByKeySuffix(root, "LegalMonetaryTotal") ||
    {}
  const rootTaxTotal = root.TaxTotal || root["cac:TaxTotal"] || pickNodeByKeySuffix(root, "TaxTotal") || {}

  const rootVatAmount = parseDecimal(
    firstNonEmpty(
      getNodeValue(rootTaxTotal?.TaxAmount),
      getNodeValue(rootTaxTotal?.["cbc:TaxAmount"]),
      pickNodeValueByKeySuffix(rootTaxTotal, "TaxAmount"),
      "0"
    )
  )
  const rootNetAmount = parseDecimal(
    firstNonEmpty(
      getNodeValue(legalMonetaryTotal?.TaxExclusiveAmount),
      getNodeValue(legalMonetaryTotal?.["cbc:TaxExclusiveAmount"]),
      pickNodeValueByKeySuffix(legalMonetaryTotal, "TaxExclusiveAmount"),
      "0"
    )
  )
  const rootTotalAmount = parseDecimal(
    firstNonEmpty(
      getNodeValue(legalMonetaryTotal?.TaxInclusiveAmount),
      getNodeValue(legalMonetaryTotal?.["cbc:TaxInclusiveAmount"]),
      pickNodeValueByKeySuffix(legalMonetaryTotal, "TaxInclusiveAmount"),
      "0"
    )
  )

  const linesRaw = root.InvoiceLine || root["cac:InvoiceLine"] || pickNodeByKeySuffix(root, "InvoiceLine")
  const lines = Array.isArray(linesRaw) ? linesRaw : linesRaw ? [linesRaw] : []
  const items = lines.map((line: any) => {
    const quantityCandidates = [
      parseDecimal(getNodeValue(line.InvoicedQuantity), Number.NaN),
      parseDecimal(getNodeValue(line["cbc:InvoicedQuantity"]), Number.NaN),
      parseDecimal(pickNodeValueByKeySuffix(line, "InvoicedQuantity"), Number.NaN),
      ...collectDecimalValuesByKeySuffix(line, "InvoicedQuantity"),
      ...collectDecimalValuesByKeySuffix(line, "Quantity"),
      ...collectDecimalValuesByKeySuffix(line, "BaseQuantity"),
    ].filter((value) => Number.isFinite(value) && value > 0)
    const quantity = quantityCandidates[0] || 0

    const priceNode = line.Price || line["cac:Price"] || pickNodeByKeySuffix(line, "Price")
    const unitPriceCandidates = [
      parseDecimal(getNodeValue(priceNode?.PriceAmount), Number.NaN),
      parseDecimal(getNodeValue(priceNode?.["cbc:PriceAmount"]), Number.NaN),
      parseDecimal(pickNodeValueByKeySuffix(priceNode, "PriceAmount"), Number.NaN),
      ...collectDecimalValuesByKeySuffix(priceNode, "PriceAmount"),
      ...collectDecimalValuesByKeySuffix(line, "PriceAmount"),
    ].filter((value) => Number.isFinite(value) && value > 0)
    let unitPrice = unitPriceCandidates[0] || 0

    const taxTotalNode = line.TaxTotal || line["cac:TaxTotal"] || pickNodeByKeySuffix(line, "TaxTotal")
    const taxSubtotalNode =
      taxTotalNode?.TaxSubtotal ||
      taxTotalNode?.["cac:TaxSubtotal"] ||
      pickNodeByKeySuffix(taxTotalNode, "TaxSubtotal")
    const vatRate = parseDecimal(
      firstNonEmpty(
        getNodeValue(taxSubtotalNode?.Percent, "20"),
        getNodeValue(taxSubtotalNode?.["cbc:Percent"], "20"),
        pickNodeValueByKeySuffix(taxSubtotalNode, "Percent"),
        "20"
      )
    , 20)

    const itemNode = line.Item || line["cac:Item"] || pickNodeByKeySuffix(line, "Item")
    const lineNetCandidates = [
      parseDecimal(getNodeValue(line.LineExtensionAmount), Number.NaN),
      parseDecimal(getNodeValue(line["cbc:LineExtensionAmount"]), Number.NaN),
      parseDecimal(pickNodeValueByKeySuffix(line, "LineExtensionAmount"), Number.NaN),
      ...collectDecimalValuesByKeySuffix(line, "LineExtensionAmount"),
    ].filter((value) => Number.isFinite(value) && value > 0)
    const lineNetAmount = lineNetCandidates[0] || 0
    const lineVatAmount = parseDecimal(
      firstNonEmpty(
        getNodeValue(taxTotalNode?.TaxAmount, "0"),
        getNodeValue(taxTotalNode?.["cbc:TaxAmount"], "0"),
        pickNodeValueByKeySuffix(taxTotalNode, "TaxAmount"),
        "0"
      )
    )
    if (unitPrice <= 0 && quantity > 0 && lineNetAmount > 0) {
      unitPrice = lineNetAmount / quantity
    }
    const description = firstNonEmpty(
      getNodeValue(itemNode?.Description),
      getNodeValue(itemNode?.["cbc:Description"]),
      getNodeValue(itemNode?.Name),
      getNodeValue(itemNode?.["cbc:Name"]),
      ...collectNodeValuesByKeySuffix(itemNode, "Description"),
      ...collectNodeValuesByKeySuffix(itemNode, "Name"),
      ...collectNodeValuesByKeySuffix(line, "Description"),
      ...collectNodeValuesByKeySuffix(line, "Name"),
      "Kalem"
    )
    return {
      description,
      quantity,
      unitPrice,
      vatRate,
      lineNetAmount,
      lineVatAmount,
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
    customerTaxNumber: normalizeTaxNumber(customerTaxNumber),
    supplierTaxNumber: normalizeTaxNumber(supplierTaxNumber),
    rootNetAmount,
    rootVatAmount,
    rootTotalAmount,
    items,
  }
}

export const POST = withApiErrors(async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  body.companyId = await resolveCompanyId(body.companyId)
  const { companyId, module, csv, fileBase64, format = "csv", dryRun = false } = body

  if (!companyId || !module) {
    return NextResponse.json({ error: "companyId and module are required" }, { status: 400 })
  }
  await ensureCompanyWrite(companyId)
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { name: true, taxNumber: true },
  })
  const companyTaxNumber = normalizeTaxNumber(company?.taxNumber)
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

      const isCustomerOurCompany =
        Boolean(companyTaxNumber) &&
        Boolean(ublInvoice.customerTaxNumber) &&
        companyTaxNumber === ublInvoice.customerTaxNumber
      const isSupplierOurCompany =
        Boolean(companyTaxNumber) &&
        Boolean(ublInvoice.supplierTaxNumber) &&
        companyTaxNumber === ublInvoice.supplierTaxNumber
      const detectedType: "PURCHASE" | "SALES" = isCustomerOurCompany ? "PURCHASE" : isSupplierOurCompany ? "SALES" : "PURCHASE"

      const counterpartyCustomerName = String(ublInvoice.customerName || "").trim()
      const counterpartySupplierName = String(ublInvoice.supplierName || "").trim()
      const customerDisplayName =
        detectedType === "SALES"
          ? counterpartyCustomerName || `Müşteri ${ublInvoice.customerTaxNumber || "Bilinmeyen"}`
          : ""
      const supplierDisplayName =
        detectedType === "PURCHASE"
          ? counterpartySupplierName || `Tedarikçi ${ublInvoice.supplierTaxNumber || "Bilinmeyen"}`
          : ""

      let customerId: string | null = null
      if (detectedType === "SALES" && customerDisplayName) {
        const existingCustomer = await prisma.customer.findFirst({
          where: {
            companyId,
            OR: [
              { taxNumber: ublInvoice.customerTaxNumber || undefined },
              { name: customerDisplayName },
            ],
          },
        })
        if (existingCustomer) {
          customerId = existingCustomer.id
        } else {
          const created = await prisma.customer.create({
            data: {
              companyId,
              name: customerDisplayName,
              taxNumber: ublInvoice.customerTaxNumber || null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          })
          customerId = created.id
        }
      }

      let supplierId: string | null = null
      if (detectedType === "PURCHASE" && supplierDisplayName) {
        const existingSupplier = await prisma.supplier.findFirst({
          where: {
            companyId,
            OR: [
              { taxNumber: ublInvoice.supplierTaxNumber || undefined },
              { name: supplierDisplayName },
            ],
          },
        })
        if (existingSupplier) {
          supplierId = existingSupplier.id
        } else {
          const created = await prisma.supplier.create({
            data: {
              companyId,
              name: supplierDisplayName,
              taxNumber: ublInvoice.supplierTaxNumber || null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          })
          supplierId = created.id
        }
      }

      // Kalemleri net + KDV ile kur, sonra faturanın RESMÎ "vergiler dâhil" toplamına
      // (TaxInclusiveAmount) RESIDUAL ile tamamla. UBL satırında ÖİV/ÖTV gibi KDV DIŞI
      // vergiler gelmese bile tutar orijinalle tutar — gelen e-fatura dönüşümündeki
      // reconciliation ile simetrik. Böylece kalemler başlık toplamından EKSİK kalmaz.
      const r2 = (x: number) => Math.round(x * 100) / 100
      const computedItems = ublInvoice.items.map((item) => {
        const safeQuantity = item.quantity > 0 ? item.quantity : 0
        const safeUnitPrice =
          item.unitPrice > 0
            ? item.unitPrice
            : item.lineNetAmount > 0 && safeQuantity > 0
              ? item.lineNetAmount / safeQuantity
              : 0
        const lineNet =
          item.lineNetAmount > 0 ? item.lineNetAmount : safeQuantity * safeUnitPrice
        const vatRate = Number(item.vatRate) || 0
        const exciseRate = Number(item.exciseRate) || 0
        const withholdingRate = Number(item.withholdingRate) || 0
        // ÖTV mal/hizmet bedeline eklenir, KDV toplam üzerinden hesaplanır — giden
        // faturayla aynı formül (lib/invoice/line-tax.ts). Böylece yeniden kurulan
        // toplam, satıcının belgesindeki toplama daha yakın çıkar ve residual küçülür.
        const tax = computeLineTax(lineNet, { vatRate, exciseRate, withholdingRate })
        const lineVat = tax.vat
        return {
          description: item.description,
          quantity: safeQuantity,
          unitPrice: safeUnitPrice,
          discountRate: Number(item.discountRate) || 0,
          vatRate,
          lineNet,
          lineVat,
          exciseRate,
          exciseAmount: tax.excise,
          withholdingRate,
          withholdingAmount: tax.withholding,
          otherTaxRate: 0,
          otherTaxAmount: 0,
          otherTaxName: null as string | null,
          lineTotal: 0,
        }
      })
      const sumNet = computedItems.reduce((s, it) => s + it.lineNet, 0)
      const sumVat = computedItems.reduce((s, it) => s + it.lineVat, 0)
      const sumExcise = computedItems.reduce((s, it) => s + it.exciseAmount, 0)
      const sumWithholding = computedItems.reduce((s, it) => s + it.withholdingAmount, 0)
      const reconstructed = sumNet + sumVat + sumExcise - sumWithholding
      const headerTotal = Number(ublInvoice.rootTotalAmount || 0)
      const targetTotal = headerTotal > 0 ? headerTotal : r2(reconstructed)
      // Eksik kalan = KDV matrahına girmeyen, toplama eklenen vergiler (ÖİV, konaklama…).
      const residual = r2(targetTotal - reconstructed)
      if (residual > 0.02 && sumNet > 0) {
        let distributed = 0
        computedItems.forEach((it, i) => {
          if (it.lineNet <= 0) return
          const isLast = i === computedItems.length - 1
          const share = isLast ? r2(residual - distributed) : r2(residual * (it.lineNet / sumNet))
          if (!isLast) distributed += share
          it.otherTaxAmount = r2(it.otherTaxAmount + share)
          it.otherTaxRate = it.lineNet > 0 ? (it.otherTaxAmount / it.lineNet) * 100 : 0
          it.otherTaxName = "Diğer Vergiler"
        })
      }
      for (const it of computedItems) {
        it.lineTotal = r2(it.lineNet + it.lineVat + it.exciseAmount + it.otherTaxAmount - it.withholdingAmount)
      }
      const netAmount = sumNet > 0 ? r2(sumNet) : Number(ublInvoice.rootNetAmount || 0)
      const vatAmount = sumNet > 0 ? r2(sumVat) : Number(ublInvoice.rootVatAmount || 0)
      const totalAmount =
        sumNet > 0 ? r2(computedItems.reduce((s, it) => s + it.lineTotal, 0)) : targetTotal

      const preview = {
        invoiceNo: normalizedInvoiceNo,
        date: ublInvoice.date,
        currency: ublInvoice.currency || "TRY",
        invoiceDirection: detectedType,
        customerName: customerDisplayName || null,
        supplierName: supplierDisplayName || null,
        itemCount: ublInvoice.items.length,
        items: ublInvoice.items.map((item) => ({
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          vatRate: item.vatRate,
        })),
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
          type: detectedType,
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
            // Reconciliation'lı kalemler (ÖİV/ÖTV/tevkifat dâhil, başlık toplamına tam).
            create: computedItems.map((it, index) => ({
              description: it.description,
              quantity: it.quantity,
              unitPrice: it.unitPrice,
              discountRate: it.discountRate || null,
              discountAmount: it.lineNet * (it.discountRate / 100),
              vatRate: it.vatRate,
              vatAmount: r2(it.lineVat),
              withholdingRate: it.withholdingRate || null,
              withholdingAmount: r2(it.withholdingAmount),
              exciseRate: it.exciseRate || null,
              exciseAmount: r2(it.exciseAmount),
              otherTaxRate: it.otherTaxRate || null,
              otherTaxAmount: r2(it.otherTaxAmount),
              otherTaxName: it.otherTaxName,
              totalAmount: it.lineTotal,
              order: index,
            })),
          },
        },
      })

      imported = 1
    } catch (error: any) {
      // Kapı reddi (modül/sayfa/rol) 403 döner; buradaki diğer dallar veri hatası içindir.
      if (isAccessDeniedError(error)) return accessDeniedResponse(error)
      return NextResponse.json({ error: error.message || "UBL/XML içe aktarma hatası" }, { status: 400 })
    }
    return NextResponse.json({ success: true, module, imported, failed: 0, errors: [] })
  }

  const rows = format === "xlsx" ? toRowsFromXlsx(String(fileBase64 || "")) : parseCsv(String(csv || ""))
  if (rows.length < 2) {
    return NextResponse.json({ error: "Dosya başlık ve en az bir satır içermeli" }, { status: 400 })
  }

  const headers = rows[0].map((value) => normalizeHeader(String(value)))
  const dataRows = rows.slice(1)

  const getValueByAliases = (row: string[], aliases: Record<string, string[]>, key: string) => {
    const candidates = aliases[key] || [key]
    for (const candidate of candidates) {
      const idx = headers.indexOf(candidate)
      if (idx >= 0) {
        return String(row[idx] || "").trim()
      }
    }
    return ""
  }

  const customerHeaderAliases: Record<string, string[]> = {
    code: ["code", "kod"],
    name: ["name", "ad", "unvan"],
    taxnumber: ["taxnumber", "vergino", "vkn", "tckn"],
    taxoffice: ["taxoffice", "vergidairesi"],
    phone: ["phone", "telefon"],
    email: ["email", "eposta", "mail"],
    address: ["address", "adres"],
    city: ["city", "sehir", "il"],
    contactperson: ["contactperson", "yetkilikisi"],
    paymentduedays: ["paymentduedays", "vadegun", "vade"],
    openingbalance: ["openingbalance", "acilisbakiyesi"],
    openingbalancetype: ["openingbalancetype", "bakiyeturu"],
    risklimit: ["risklimit", "risklimiti"],
    bankinfo: ["bankinfo", "bankabilgisi"],
    note: ["note", "not"],
  }

  const supplierHeaderAliases: Record<string, string[]> = {
    ...customerHeaderAliases,
  }

  const productHeaderAliases: Record<string, string[]> = {
    code: ["code", "kod"],
    name: ["name", "ad"],
    barcode: ["barcode", "barkod"],
    shelfcode: ["shelfcode", "rafno", "raf"],
    unit: ["unit", "birim"],
    stockquantity: ["stockquantity", "stokmiktari"],
    purchaseprice: ["purchaseprice", "alisfiyati"],
    saleprice: ["saleprice", "satisfiyati"],
    vatrate: ["vatrate", "kdvorani"],
  }

  const invoiceHeaderAliases: Record<string, string[]> = {
    invoiceno: ["invoiceno", "faturano"],
    date: ["date", "tarih"],
    type: ["type", "tip"],
    invoicetype: ["invoicetype", "faturatipi"],
    netamount: ["netamount", "nettutar"],
    vatamount: ["vatamount", "kdvtutari"],
    totalamount: ["totalamount", "toplamtutar"],
    currency: ["currency", "parabirimi"],
    notes: ["notes", "aciklama", "notlar"],
  }

  if (module === "customers") {
    for (let index = 0; index < dataRows.length; index++) {
      const row = dataRows[index]
      try {
        const get = (name: string) => getValueByAliases(row, customerHeaderAliases, name)
        const name = get("name")
        if (!name) throw new Error("name is required")

        const taxNumber = get("taxnumber") || null

        // Duplicate kontrolü: aynı ad veya vergi numarası varsa
        const existingCustomer = await prisma.customer.findFirst({
          where: {
            companyId,
            OR: [
              { name: name.trim() },
              ...(taxNumber ? [{ taxNumber: taxNumber.trim() }] : []),
            ],
          },
          select: { id: true, name: true },
        })

        if (existingCustomer) {
          throw new Error(`Çift cari bulundu: "${existingCustomer.name}" zaten mevcut`)
        }

        const openingBalanceAmount = parseDecimal(get("openingbalance"), 0)
        const openingBalanceType = parseOpeningBalanceType(get("openingbalancetype"))

        await prisma.customer.create({
          data: {
            companyId,
            code: get("code") || null,
            name,
            taxNumber,
            taxOffice: get("taxoffice") || null,
            phone: get("phone") || null,
            email: get("email") || null,
            address: get("address") || null,
            city: get("city") || null,
            contactPerson: get("contactperson") || null,
            paymentDueDays: get("paymentduedays") ? Math.max(0, Math.trunc(parseDecimal(get("paymentduedays"), 0))) : null,
            openingBalanceAmount,
            openingBalanceType,
            riskLimit: get("risklimit") ? parseDecimal(get("risklimit"), 0) : null,
            bankInfo: get("bankinfo") || null,
            note: get("note") || null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        })
        imported++
      } catch (error: any) {
        // Kapı reddi (modül/sayfa/rol) 403 döner; buradaki diğer dallar veri hatası içindir.
        if (isAccessDeniedError(error)) return accessDeniedResponse(error)
        errors.push({ row: index + 2, error: error.message || "failed" })
      }
    }
  } else if (module === "products") {
    for (let index = 0; index < dataRows.length; index++) {
      const row = dataRows[index]
      try {
        const get = (name: string) => getValueByAliases(row, productHeaderAliases, name)
        const name = get("name")
        if (!name) throw new Error("name is required")

        const barcode = get("barcode") || null

        // Duplicate kontrolü: aynı ad veya barkod varsa
        const existingProduct = await prisma.product.findFirst({
          where: {
            companyId,
            OR: [
              { name: name.trim() },
              ...(barcode ? [{ barcode: barcode.trim() }] : []),
            ],
          },
          select: { id: true, name: true, barcode: true },
        })

        if (existingProduct) {
          throw new Error(`Çift ürün bulundu: "${existingProduct.name}" zaten mevcut`)
        }

        await prisma.product.create({
          data: {
            companyId,
            code: get("code") || null,
            name,
            barcode,
            shelfCode: get("shelfcode") || null,
            unit: get("unit") || "ADET",
            stockQuantity: parseDecimal(get("stockquantity"), 0),
            purchasePrice: get("purchaseprice") ? parseDecimal(get("purchaseprice")) : null,
            salePrice: get("saleprice") ? parseDecimal(get("saleprice")) : null,
            vatRate: parseDecimal(get("vatrate"), 20),
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        })
        imported++
      } catch (error: any) {
        // Kapı reddi (modül/sayfa/rol) 403 döner; buradaki diğer dallar veri hatası içindir.
        if (isAccessDeniedError(error)) return accessDeniedResponse(error)
        errors.push({ row: index + 2, error: error.message || "failed" })
      }
    }
  } else if (module === "suppliers") {
    for (let index = 0; index < dataRows.length; index++) {
      const row = dataRows[index]
      try {
        const get = (name: string) => getValueByAliases(row, supplierHeaderAliases, name)
        const name = get("name")
        if (!name) throw new Error("name is required")
        const openingBalanceAmount = parseDecimal(get("openingbalance"), 0)
        const openingBalanceType = parseOpeningBalanceType(get("openingbalancetype"))

        await prisma.supplier.create({
          data: {
            companyId,
            code: get("code") || null,
            name,
            taxNumber: get("taxnumber") || null,
            taxOffice: get("taxoffice") || null,
            phone: get("phone") || null,
            email: get("email") || null,
            address: get("address") || null,
            city: get("city") || null,
            contactPerson: get("contactperson") || null,
            paymentDueDays: get("paymentduedays") ? Math.max(0, Math.trunc(parseDecimal(get("paymentduedays"), 0))) : null,
            openingBalanceAmount,
            openingBalanceType,
            riskLimit: get("risklimit") ? parseDecimal(get("risklimit"), 0) : null,
            bankInfo: get("bankinfo") || null,
            note: get("note") || null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        })
        imported++
      } catch (error: any) {
        // Kapı reddi (modül/sayfa/rol) 403 döner; buradaki diğer dallar veri hatası içindir.
        if (isAccessDeniedError(error)) return accessDeniedResponse(error)
        errors.push({ row: index + 2, error: error.message || "failed" })
      }
    }
  } else if (module === "invoices") {
    for (let index = 0; index < dataRows.length; index++) {
      const row = dataRows[index]
      try {
        const get = (name: string) => getValueByAliases(row, invoiceHeaderAliases, name)
        const invoiceNo = String(get("invoiceno") || "").trim()
        if (!invoiceNo) throw new Error("invoiceNo is required")
        const date = String(get("date") || "")
        const type = String(get("type") || "SALES").toUpperCase()
        const invoiceType = String(get("invoicetype") || "MANUAL").toUpperCase()
        const netAmount = parseDecimal(get("netamount"), 0)
        const vatAmount = parseDecimal(get("vatamount"), 0)
        const totalAmount = parseDecimal(get("totalamount"), 0)

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
        // Kapı reddi (modül/sayfa/rol) 403 döner; buradaki diğer dallar veri hatası içindir.
        if (isAccessDeniedError(error)) return accessDeniedResponse(error)
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
})
