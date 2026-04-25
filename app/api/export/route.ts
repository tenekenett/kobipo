import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const sp = new URL(request.url).searchParams
  const companyId = sp.get("companyId")
  const moduleName = sp.get("module")
  if (!companyId || !moduleName) return NextResponse.json({ error: "companyId and module are required" }, { status: 400 })
  await ensureCompanyAccess(companyId)

  let rows: string[] = []
  if (moduleName === "customers") {
    const items = await prisma.customer.findMany({ where: { companyId } })
    rows = ["Kod,Ad,VergiNo,Telefon,Email", ...items.map((i) => `${i.code || ""},${i.name},${i.taxNumber || ""},${i.phone || ""},${i.email || ""}`)]
  } else if (moduleName === "products") {
    const items = await prisma.product.findMany({ where: { companyId } })
    rows = ["Kod,Ad,Barkod,Birim,Stok", ...items.map((i) => `${i.code || ""},${i.name},${i.barcode || ""},${i.unit},${i.stockQuantity}`)]
  } else if (moduleName === "invoices") {
    const items = await prisma.invoice.findMany({ where: { companyId }, include: { customer: true, supplier: true } })
    rows = ["No,Tip,Tarih,KarsiTaraf,Toplam", ...items.map((i) => `${i.invoiceNo},${i.type},${i.date.toISOString()},${i.customer?.name || i.supplier?.name || ""},${i.totalAmount}`)]
  } else {
    return NextResponse.json({ error: "Unsupported module" }, { status: 400 })
  }

  return new NextResponse(rows.join("\n"), { headers: { "Content-Type": "text/csv; charset=utf-8" } })
}
