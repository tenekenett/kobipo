import { withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

function toCsvRow(values: Array<string | number | null | undefined>) {
  return values
    .map((value) => {
      const raw = value == null ? "" : String(value)
      const escaped = raw.replaceAll('"', '""')
      return `"${escaped}"`
    })
    .join(",")
}

export const GET = withApiErrors(async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const companyId = await resolveCompanyId(searchParams.get("companyId"))
  const startDate = searchParams.get("startDate")
  const endDate = searchParams.get("endDate")
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  await ensureCompanyAccess(companyId)

  const dateWhere =
    startDate || endDate
      ? {
          gte: startDate ? new Date(startDate) : undefined,
          lte: endDate ? new Date(endDate) : undefined,
        }
      : undefined

  const [entries, invoices, transactions, customers, suppliers] = await Promise.all([
    prisma.accountingEntry.findMany({
      where: { companyId, ...(dateWhere ? { date: dateWhere } : {}) },
      include: { debitAccount: true, creditAccount: true },
      orderBy: { date: "asc" },
    }),
    prisma.invoice.findMany({
      // Dönüştürülmüş fişler hariç (yerine konsolide fatura gelir; çift kayıt olmaz).
      where: { companyId, status: { not: "CONVERTED" }, ...(dateWhere ? { date: dateWhere } : {}) },
      include: { customer: true, supplier: true },
      orderBy: { date: "asc" },
    }),
    prisma.transaction.findMany({
      where: { companyId, ...(dateWhere ? { date: dateWhere } : {}) },
      include: { account: true, customer: true, supplier: true },
      orderBy: { date: "asc" },
    }),
    prisma.customer.findMany({ where: { companyId }, orderBy: { name: "asc" } }),
    prisma.supplier.findMany({ where: { companyId }, orderBy: { name: "asc" } }),
  ])

  const csv = {
    yevmiye: [
      toCsvRow(["FisNo", "Tarih", "Aciklama", "BorcHesap", "AlacakHesap", "Tutar"]),
      ...entries.map((entry) =>
        toCsvRow([
          entry.entryNo,
          entry.date.toISOString(),
          entry.description,
          `${entry.debitAccount.code} ${entry.debitAccount.name}`,
          `${entry.creditAccount.code} ${entry.creditAccount.name}`,
          Number(entry.amount),
        ])
      ),
    ].join("\n"),
    faturalar: [
      toCsvRow(["No", "Tip", "Tarih", "Cari", "Net", "Kdv", "Toplam", "Durum"]),
      ...invoices.map((inv) =>
        toCsvRow([
          inv.invoiceNo,
          inv.type,
          inv.date.toISOString(),
          inv.customer?.name || inv.supplier?.name || "",
          Number(inv.netAmount),
          Number(inv.vatAmount),
          Number(inv.totalAmount),
          inv.status,
        ])
      ),
    ].join("\n"),
    finansHareketleri: [
      toCsvRow(["Tarih", "Tip", "Hesap", "Aciklama", "Tutar", "Cari"]),
      ...transactions.map((tx) =>
        toCsvRow([
          tx.date.toISOString(),
          tx.type,
          tx.account.name,
          tx.description,
          Number(tx.amount),
          tx.customer?.name || tx.supplier?.name || "",
        ])
      ),
    ].join("\n"),
    cariler: [
      toCsvRow(["Tur", "Kod", "Ad", "VergiNo", "Telefon", "Email"]),
      ...customers.map((customer) =>
        toCsvRow(["MUSTERI", customer.code, customer.name, customer.taxNumber, customer.phone, customer.email])
      ),
      ...suppliers.map((supplier) =>
        toCsvRow(["TEDARIKCI", supplier.code, supplier.name, supplier.taxNumber, supplier.phone, supplier.email])
      ),
    ].join("\n"),
  }

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    companyId,
    range: { startDate: startDate || null, endDate: endDate || null },
    files: csv,
  })
})
