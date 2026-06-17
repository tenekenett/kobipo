import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

// Banka maaş ödeme listesi (CSV). Seçili dönemdeki bordroları IBAN + net tutar
// ile dışa aktarır; bankaların toplu ödeme şablonlarına temel oluşturur.
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const companyId = searchParams.get("companyId")
  const year = Number(searchParams.get("year"))
  const month = Number(searchParams.get("month"))
  if (!companyId || !year || !month) {
    return NextResponse.json({ error: "companyId, year, month zorunlu" }, { status: 400 })
  }
  await ensureCompanyAccess(companyId)

  const records = await prisma.payrollRecord.findMany({
    where: { companyId, periodYear: year, periodMonth: month },
    include: { employee: { select: { firstName: true, lastName: true, nationalId: true, iban: true } } },
    orderBy: { employee: { firstName: "asc" } },
  })

  const esc = (s: string) => `"${String(s ?? "").replace(/"/g, '""')}"`
  const rows = [
    ["Ad Soyad", "T.C. Kimlik", "IBAN", "Net Tutar", "Aciklama", "Durum"].join(";"),
    ...records.map((r) =>
      [
        esc(`${r.employee.firstName} ${r.employee.lastName}`),
        esc(r.employee.nationalId || ""),
        esc(r.employee.iban || ""),
        Number(r.netSalary).toFixed(2),
        esc(`${month}/${year} Maas`),
        r.status === "PAID" ? "Odendi" : "Bekliyor",
      ].join(";"),
    ),
  ]
  // UTF-8 BOM → Excel'de Türkçe karakterler düzgün görünür.
  const csv = "﻿" + rows.join("\r\n")

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="banka-maas-${month}-${year}.csv"`,
    },
  })
}
