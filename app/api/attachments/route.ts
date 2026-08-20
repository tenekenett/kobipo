import { withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

export const GET = withApiErrors(async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const sp = new URL(request.url).searchParams
  // companyId dashboard'dan slug gelebilir → cuid'e çevir (POST zaten çeviriyor). [[resolve-company.ts]]
  const companyId = await resolveCompanyId(sp.get("companyId"))
  const entityType = sp.get("entityType")
  const entityId = sp.get("entityId")
  if (!companyId || !entityType || !entityId) {
    return NextResponse.json({ error: "companyId, entityType, entityId are required" }, { status: 400 })
  }
  await ensureCompanyAccess(companyId)
  const attachments = await prisma.attachment.findMany({
    where: { companyId, entityType, entityId },
    orderBy: { createdAt: "desc" },
  })
  return NextResponse.json(attachments)
})

export const POST = withApiErrors(async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const body = await request.json()
  body.companyId = await resolveCompanyId(body.companyId)
  const { companyId, entityType, entityId, fileName, mimeType, sizeBytes } = body
  await ensureCompanyWrite(companyId)
  const filePath = `supabase://attachments/${companyId}/${Date.now()}-${fileName}`
  const created = await prisma.attachment.create({
    data: { companyId, entityType, entityId, fileName, filePath, mimeType, sizeBytes, createdBy: user.id },
  })
  return NextResponse.json(created, { status: 201 })
})
