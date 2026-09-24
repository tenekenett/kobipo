import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyExport } from "@/lib/middleware/company"
import { withApiErrors } from "@/lib/api/errors"
import { CariForbiddenError, isCariVisible } from "@/lib/cari/visibility"
import { resolveCariVisibility } from "@/lib/cari/resolve-visibility"
import { isVirmanSide } from "@/lib/cari/virman"
import { renderVirmanMakbuzPdf, type VirmanMakbuzLeg } from "@/lib/pdf/documents/virman-makbuz-document"

export const dynamic = "force-dynamic"

const PARTY_SELECT = { name: true, taxNumber: true, authorizedUserId: true } as const

/**
 * Cari virman makbuzu (PDF) — belge düzeni `lib/pdf/documents/virman-makbuz-document.ts`.
 *
 * Virman `Transaction` yazmadığı için kasa makbuzu ucu bu kayda ulaşamaz.
 *
 * Görünürlük: fişin EN AZ BİR bacağının carisi kullanıcıya görünmeli (makbuzu
 * o carinin kartından ister). Görmediği karşı carinin ADI basılır — kart
 * satırında da yazıyor — ama VKN'si basılmaz.
 */
export const GET = withApiErrors(async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const virman = await prisma.cariVirman.findUnique({
    where: { id },
    select: {
      companyId: true,
      virmanNo: true,
      date: true,
      amount: true,
      description: true,
      company: {
        select: {
          name: true,
          taxNumber: true,
          taxOffice: true,
          address: true,
          district: true,
          city: true,
          phone: true,
        },
      },
      legs: {
        select: {
          side: true,
          customer: { select: PARTY_SELECT },
          supplier: { select: PARTY_SELECT },
        },
      },
    },
  })
  if (!virman) {
    return NextResponse.json({ error: "Virman fişi bulunamadı" }, { status: 404 })
  }

  await ensureCompanyExport(virman.companyId)
  const visibility = await resolveCariVisibility(virman.companyId)

  const legs: Array<VirmanMakbuzLeg & { visible: boolean }> = []
  for (const leg of virman.legs) {
    const party = leg.customer ?? leg.supplier
    if (!party || !isVirmanSide(leg.side)) continue
    const visible = isCariVisible(party, visibility)
    legs.push({
      side: leg.side,
      kind: leg.customer ? "customer" : "supplier",
      name: party.name,
      taxNumber: visible ? party.taxNumber : null,
      visible,
    })
  }
  if (!legs.some((l) => l.visible)) throw new CariForbiddenError()

  const pdfBuffer = await renderVirmanMakbuzPdf({
    virmanNo: virman.virmanNo,
    date: virman.date,
    amount: Number(virman.amount),
    description: virman.description,
    company: virman.company,
    legs: legs.map(({ visible: _visible, ...leg }) => leg),
  })

  const fileName = `Virman-Makbuzu-${virman.virmanNo}.pdf`
  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  })
})
