import { withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import {
  normalizeClassificationLabel,
  resolveClassificationLabels,
} from "@/lib/company/classification-labels"
import { loadCompanyClassificationLabels } from "@/lib/company/classification-labels.server"

export const dynamic = "force-dynamic"

/**
 * Cari sınıflandırma EKSENLERİNİN adı ("Müşteri Tipi", "Bölge").
 *
 * Ayrı uç: `/api/company/definitions` kümenin ÖĞELERİNİ döndürüyor ve o yanıtın
 * şeklini birçok ekran okuyor; eksen adını oraya iliştirmek hepsini kırardı.
 * `labels` bir cuid olamayacağı için `[id]` yoluyla çakışmaz.
 */
export const GET = withApiErrors(async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const companyId = await resolveCompanyId(new URL(request.url).searchParams.get("companyId"))
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  await ensureCompanyAccess(companyId)
  return NextResponse.json(await loadCompanyClassificationLabels(companyId))
})

export const PATCH = withApiErrors(async function PATCH(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const companyId = await resolveCompanyId(new URL(request.url).searchParams.get("companyId"))
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  const access = await ensureCompanyAccess(companyId)
  // Tanım ekleme/düzenlemeyle aynı kapı: salt-okunur üyelik ad değiştiremez.
  if (access.role === "VIEWER") {
    return NextResponse.json({ error: "Bu işlem için yetkiniz yok" }, { status: 403 })
  }

  const body = await request.json().catch(() => ({}))
  // Alan gönderilmediyse DOKUNULMAZ; boş string gönderildiyse varsayılana döner.
  const data: { classification1Label?: string | null; classification2Label?: string | null } = {}
  if ("class1" in body) data.classification1Label = normalizeClassificationLabel(body.class1)
  if ("class2" in body) data.classification2Label = normalizeClassificationLabel(body.class2)
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Değiştirilecek alan yok" }, { status: 400 })
  }

  const company = await prisma.company.update({
    where: { id: companyId },
    data,
    select: { classification1Label: true, classification2Label: true },
  })
  return NextResponse.json(resolveClassificationLabels(company))
})
