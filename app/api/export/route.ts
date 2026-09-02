import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { assertModulePath, assertPagePath, ensureCompanyExport } from "@/lib/middleware/company"
import { XMLBuilder } from "fast-xml-parser"
import { DATASETS } from "@/lib/export/datasets"
import { exportResponse } from "@/lib/export/response"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"
import { toDateInput } from "@/lib/format"

export const dynamic = "force-dynamic"
export const maxDuration = 60

/**
 * Eski modül dışa aktarım ucu — `Ayarlar › Veri Aktarım` sayfası bunu kullanıyor.
 *
 * Uç adresi ve `module`/`format` paramları korundu, ancak üretim artık
 * `lib/export`e devrediliyor. Böylece bu uçtaki üç kusur birden kapandı:
 *  - CSV kaçış yapmıyordu (adresinde virgül olan cari dosyayı kaydırıyordu),
 *  - XLSX'te tüm sayılar metin hücresi oluyordu (Excel'de toplam alınamıyordu),
 *  - XML yalnızca İLK faturayı yazıyordu, gerisi sessizce düşüyordu.
 */

const MODULE_TO_DATASET: Record<string, { dataset: string; extraParams?: Record<string, string> }> = {
  customers: { dataset: "cari", extraParams: { tab: "customers" } },
  suppliers: { dataset: "cari", extraParams: { tab: "suppliers" } },
  products: { dataset: "products" },
  invoices: { dataset: "invoices" },
}

/** Tek faturayı UBL benzeri nesneye çevirir (eski çıktı biçimi korunuyor). */
function toXmlInvoice(invoice: any) {
  return {
    ID: invoice.invoiceNo,
    // Yerel gün: `toISOString()` UTC'ye kayıyor ve saat 21:00 sonrası kesilen
    // fatura dosyaya BİR ÖNCEKİ günle yazılıyordu.
    IssueDate: toDateInput(invoice.date),
    DocumentCurrencyCode: invoice.currency || "TRY",
    AccountingCustomerParty: { Party: { PartyName: { Name: invoice.customer?.name || "" } } },
    AccountingSupplierParty: { Party: { PartyName: { Name: invoice.supplier?.name || "" } } },
    InvoiceLine: invoice.items.map((line: any) => ({
      ID: String(line.order + 1),
      InvoicedQuantity: Number(line.quantity),
      LineExtensionAmount: Number(line.totalAmount),
      TaxTotal: { TaxSubtotal: { Percent: Number(line.vatRate) } },
      Item: { Name: line.description },
      Price: { PriceAmount: Number(line.unitPrice) },
    })),
  }
}

async function invoicesAsXml(companyId: string) {
  const invoices = await prisma.invoice.findMany({
    // Dönüştürülmüş fişler hariç (yerine konsolide fatura gelir; çift kayıt olmaz).
    where: { companyId, status: { not: "CONVERTED" } },
    include: { customer: true, supplier: true, items: { orderBy: { order: "asc" } } },
    orderBy: { date: "desc" },
  })

  if (invoices.length === 0) {
    return NextResponse.json({ error: "Export edilecek fatura yok" }, { status: 404 })
  }

  const builder = new XMLBuilder({ ignoreAttributes: false, format: true })

  // Tek fatura → eskisiyle aynı, geçerli tek belge. Birden fazlaysa hepsi bir
  // kapsayıcı kök altında verilir (eskiden 2..n sessizce kayboluyordu).
  const isSingle = invoices.length === 1
  const xmlObject = isSingle
    ? { Invoice: toXmlInvoice(invoices[0]) }
    : { Invoices: { Invoice: invoices.map(toXmlInvoice) } }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build(xmlObject)}`
  const fileName = isSingle ? `${invoices[0].invoiceNo}.xml` : `invoices-${invoices.length}.xml`

  return new NextResponse(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  })
}

export const GET = withApiErrors(async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const searchParams = new URL(request.url).searchParams
    // companyId dashboard'dan slug gelebilir → cuid'e çevir. [[resolve-company.ts]]
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    const moduleName = searchParams.get("module")
    const format = (searchParams.get("format") || "csv").toLowerCase()

    if (!companyId || !moduleName) {
      return NextResponse.json({ error: "companyId and module are required" }, { status: 400 })
    }
    const context = await ensureCompanyExport(companyId)

    const mapping = MODULE_TO_DATASET[moduleName]
    if (!mapping) {
      return NextResponse.json({ error: "Unsupported module" }, { status: 400 })
    }

    // Modül kapısı YOLU okur, bu uç ise veri kümesini `?module=` ile alır: `/api/export/products`
    // kilitliyken aynı ürün listesi buradan sızabiliyordu. Kararı karşılık gelen dataset
    // yoluna sorarak veriyoruz — kural tablosu tek kaynak kalsın.
    await assertModulePath(context, `/api/export/${mapping.dataset}`)
    // Aynı gerekçe kısıtlı çalışan izinleri için de geçerli (bkz. lib/page-access.ts).
    await assertPagePath(context, `/api/export/${mapping.dataset}`)

    if (format === "xml") {
      if (moduleName !== "invoices") {
        return NextResponse.json({ error: "XML yalnızca faturalar için desteklenir" }, { status: 400 })
      }
      return await invoicesAsXml(companyId)
    }

    const params = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(mapping.extraParams ?? {})) params.set(key, value)
    // Bu uç bütün kayıtları verir; fatura listesinin varsayılan 90 günlük
    // penceresi burada geçerli olmamalı.
    if (mapping.dataset === "invoices" && !params.has("startDate") && !params.has("days")) {
      params.set("days", "3650")
    }

    const dataset = await DATASETS[mapping.dataset](companyId, params)
    return await exportResponse(dataset, format === "xlsx" ? "xlsx" : "csv")
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("export route error:", error)
    return NextResponse.json({ error: message || "Dışa aktarma hatası" }, { status: 500 })
  }
})
