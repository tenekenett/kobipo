import { withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

/**
 * "Çalışan cebinden ödedi" seçicisi — yalnız ad.
 *
 * Neden `/api/personel/employees` değil: o uç kartın TAMAMINI (maaş, TC kimlik,
 * IBAN) döndürür ve kapısı personel sayfalarıdır. Alış faturası giren birine
 * çalışan maaşlarını açmadan "kim ödedi" sorusunu sorabilmek için bu uç ödeme
 * kapısının altında (`/api/faturalar/odemeler`) ve yalnız id + ad verir.
 * İşten ayrılanlar listelenmez.
 */
export const GET = withApiErrors(async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const companyId = await resolveCompanyId(new URL(request.url).searchParams.get("companyId"))
  if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
  await ensureCompanyAccess(companyId)

  const employees = await prisma.employee.findMany({
    where: { companyId, status: { not: "TERMINATED" } },
    select: { id: true, firstName: true, lastName: true, position: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  })
  return NextResponse.json(
    employees.map((e) => ({
      id: e.id,
      name: `${e.firstName} ${e.lastName}`.trim(),
      position: e.position ?? null,
    })),
  )
})
