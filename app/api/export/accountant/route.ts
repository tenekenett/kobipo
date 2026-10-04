import { withApiErrors } from "@/lib/api/errors"
import { parseDateParam } from "@/lib/http/query-params"

import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyExport } from "@/lib/middleware/company"
import { defterSahibiId } from "@/lib/muhasebe/defter.server"

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
  const startDate = parseDateParam(searchParams.get("startDate"), "startDate")
  const endDate = parseDateParam(searchParams.get("endDate"), "endDate")
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  await ensureCompanyExport(companyId)

  const dateWhere =
    startDate || endDate
      ? {
          gte: startDate ? new Date(startDate) : undefined,
          lte: endDate ? new Date(endDate) : undefined,
        }
      : undefined

  // Yevmiye muhasebe modülünün ONAYLI fişlerinden (defter tüzel kişide: şubede ana firma).
  const defterId = await defterSahibiId(companyId)
  const [lines, invoices, transactions, customers, suppliers] = await Promise.all([
    prisma.journalVoucherLine.findMany({
      where: {
        companyId: defterId,
        voucher: { status: "POSTED", ...(dateWhere ? { date: dateWhere } : {}) },
      },
      select: {
        side: true,
        amount: true,
        description: true,
        account: { select: { code: true, name: true } },
        voucher: { select: { voucherNo: true, date: true, description: true } },
      },
      orderBy: [{ voucher: { date: "asc" } }, { voucher: { voucherNo: "asc" } }, { order: "asc" }],
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
      toCsvRow(["FisNo", "Tarih", "FisAciklama", "HesapKodu", "HesapAdi", "Borc", "Alacak", "SatirAciklama"]),
      ...lines.map((l) =>
        toCsvRow([
          l.voucher.voucherNo,
          l.voucher.date.toISOString().slice(0, 10),
          l.voucher.description,
          l.account?.code ?? "",
          l.account?.name ?? "",
          l.side === "DEBIT" ? Number(l.amount) : 0,
          l.side === "CREDIT" ? Number(l.amount) : 0,
          l.description,
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
