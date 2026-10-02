import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { withApiErrors } from "@/lib/api/errors"
import {
  StampImageError,
  copyTemplateStamp,
  listTemplateStamps,
  resolveStampSource,
  saveUploadedStamp,
} from "@/lib/company/stamp.server"
import { clampStampWidthMm } from "@/lib/company/stamp"

export const dynamic = "force-dynamic"

/**
 * Firma kaşesi — kural `lib/company/stamp.ts`.
 *
 * GET    ?companyId=             → { stamp, templateStamps, effective }
 *          stamp: ayarlardaki kaşe (yoksa null); templateStamps: "Şablondan al"
 *          seçenekleri; effective: makbuzda ŞU AN hangi kaşenin basıldığı.
 * PUT    { companyId, dataUri, widthMm }    → bilgisayardan yüklenen kaşe
 *        { companyId, templateId, widthMm } → e-Dönüşüm şablonundaki kaşeyi al
 *        { companyId, widthMm }             → yalnız basım genişliği
 * DELETE ?companyId=             → ayar kaşesini kaldır (makbuz şablon kaşesine döner)
 *
 * Yazan ekran Ayarlar → Firma Bilgileri; Belge Şablonları ("ayarlardaki kaşeyi kullan")
 * yalnız okur (bkz. lib/page-access.ts). Yazma rolü firma kartıyla aynı.
 */
const EDIT_ROLES = ["ADMIN", "BRANCH_MANAGER", "ACCOUNTANT"]

async function stampState(companyId: string) {
  const [stamp, templateStamps, source] = await Promise.all([
    prisma.companyStamp.findUnique({
      where: { companyId },
      select: { dataUri: true, widthMm: true, updatedAt: true },
    }),
    listTemplateStamps(companyId),
    resolveStampSource(companyId),
  ])

  let effective: { kind: "settings" | "template"; fromParent: boolean; templateName?: string } | null = null
  if (source) {
    const fromParent = source.companyId !== companyId
    if (source.kind === "settings") {
      effective = { kind: "settings", fromParent }
    } else {
      const template = await prisma.eInvoiceTemplate.findUnique({
        where: { id: source.templateId },
        select: { xsltName: true },
      })
      effective = { kind: "template", fromParent, templateName: template?.xsltName }
    }
  }
  return { stamp, templateStamps, effective }
}

async function writableCompany(
  raw: unknown,
): Promise<{ companyId: string; error?: never } | { companyId?: never; error: NextResponse }> {
  const companyId = await resolveCompanyId(typeof raw === "string" ? raw : undefined)
  if (!companyId) return { error: NextResponse.json({ error: "companyId zorunlu" }, { status: 400 }) }
  const access = await ensureCompanyWrite(companyId)
  if (!EDIT_ROLES.includes(access.role)) {
    return { error: NextResponse.json({ error: "Bu işlem için yetkiniz yok" }, { status: 403 }) }
  }
  return { companyId }
}

export const GET = withApiErrors(async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const companyId = await resolveCompanyId(new URL(request.url).searchParams.get("companyId") || undefined)
  if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
  await ensureCompanyAccess(companyId)
  return NextResponse.json(await stampState(companyId))
})

export const PUT = withApiErrors(async function PUT(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const target = await writableCompany(body?.companyId)
  if (target.error) return target.error
  const { companyId } = target

  try {
    if (body?.dataUri !== undefined) {
      await saveUploadedStamp(companyId, body.dataUri, body.widthMm)
    } else if (body?.templateId !== undefined) {
      await copyTemplateStamp(companyId, body.templateId, body.widthMm)
    } else if (body?.widthMm !== undefined) {
      const updated = await prisma.companyStamp.updateMany({
        where: { companyId },
        data: { widthMm: clampStampWidthMm(body.widthMm) },
      })
      if (updated.count === 0) {
        return NextResponse.json({ error: "Önce bir kaşe yükleyin." }, { status: 400 })
      }
    } else {
      return NextResponse.json({ error: "Kaşe görseli ya da şablon seçilmedi." }, { status: 400 })
    }
  } catch (error) {
    if (error instanceof StampImageError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    throw error
  }

  return NextResponse.json(await stampState(companyId))
})

export const DELETE = withApiErrors(async function DELETE(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const target = await writableCompany(new URL(request.url).searchParams.get("companyId"))
  if (target.error) return target.error
  const { companyId } = target

  await prisma.companyStamp.deleteMany({ where: { companyId } })
  return NextResponse.json(await stampState(companyId))
})
