import { NextResponse } from "next/server"
import { withApiErrors } from "@/lib/api/errors"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyExport } from "@/lib/middleware/company"
import { buildTemplateDocPdf } from "@/lib/pdf/personel-pdf"
import { belgeMetni } from "@/lib/personel/belge-alanlari"
import { govdePdfIcerigi } from "@/lib/personel/belge-govde"
import { firmaIcinSablonBul } from "@/lib/personel/belge-sablonlari.server"

export const dynamic = "force-dynamic"

/**
 * Şablondan belge basar.
 *
 * POST çünkü elle doldurulan alanlar gövdede taşınır: tarih, tutar, gerekçe gibi
 * değerler sorgu dizesine KONULMAZ (kişisel veri URL'e, günlüğe ve tarayıcı
 * geçmişine düşerdi).
 *
 * Değer çözümü tek yerde: `belgeMetni` önce sözlükten kayıttan çözer, sonra elle
 * girilenleri üstüne yazar. Önizleme ekranı da aynı fonksiyonu çağırır ki ekranda
 * görünen ile imzaya giden belge ayrışmasın.
 */
export const POST = withApiErrors(async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const govde = await request.json().catch(() => ({}))
  const companyId = await resolveCompanyId(govde?.companyId)
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  // Belge dışa aktarımdır: kapı `ensureCompanyExport` (bkz. diğer PDF uçları).
  await ensureCompanyExport(companyId)

  const sablon = await firmaIcinSablonBul(id, companyId)
  if (!sablon) return NextResponse.json({ error: "Şablon bulunamadı" }, { status: 404 })

  // Firma künyesi SEÇİLİ firmadan okunur — şubedeyse şubenin kendi adresi basılır
  // (bkz. CLAUDE.md → şube ≠ firma).
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: {
      name: true, taxNumber: true, taxOffice: true, address: true, city: true,
      district: true, phone: true, email: true, branchName: true, branchNo: true,
    },
  })
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 })

  // Personel isteğe bağlı: kişiye bağlı olmayan şablon da basılabilir.
  const employeeId = govde?.employeeId ? String(govde.employeeId) : null
  const employee = employeeId
    ? await prisma.employee.findFirst({
        // companyId koşulu ŞART: id'yi bilen biri başka firmanın personelini
        // belgeye bastırabilirdi.
        where: { id: employeeId, companyId },
        select: {
          firstName: true, lastName: true, nationalId: true, phone: true, email: true,
          address: true, position: true, department: true, birthDate: true, hireDate: true,
          terminationDate: true, iban: true, grossSalary: true, netSalary: true,
          annualLeaveDays: true,
        },
      })
    : null
  if (employeeId && !employee) {
    return NextResponse.json({ error: "Personel bulunamadı" }, { status: 404 })
  }

  const elle: Record<string, string> =
    govde?.degerler && typeof govde.degerler === "object"
      ? Object.fromEntries(
          Object.entries(govde.degerler as Record<string, unknown>).map(([k, v]) => [
            k,
            v === null || v === undefined ? "" : String(v).slice(0, 500),
          ]),
        )
      : {}

  const dolu = belgeMetni(
    sablon.body,
    {
      firma: company,
      personel: employee
        ? { ...employee, grossSalary: employee.grossSalary?.toString() ?? null, netSalary: employee.netSalary?.toString() ?? null }
        : null,
    },
    elle,
  )

  const pdf = await buildTemplateDocPdf({
    company,
    employee,
    title: sablon.title,
    body: govdePdfIcerigi(dolu),
    signatureLabels: ["Düzenleyen", employee ? "Personel" : "Yetkili"],
  })

  const adParcasi = employee ? `_${employee.firstName}_${employee.lastName}` : ""
  const fileName = `${sablon.key}${adParcasi}.pdf`
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${encodeURIComponent(fileName)}"`,
    },
  })
})
