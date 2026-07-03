import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

const DEFINITION_TYPES = ["CLASS_1", "CLASS_2", "PRODUCT_CATEGORY"] as const
type DefinitionType = (typeof DEFINITION_TYPES)[number]

function asDefinitionType(value: unknown): DefinitionType | null {
  const normalized = String(value || "").toUpperCase()
  return DEFINITION_TYPES.includes(normalized as DefinitionType) ? (normalized as DefinitionType) : null
}

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const searchParams = new URL(request.url).searchParams
  const companyId = await resolveCompanyId(searchParams.get("companyId"))
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  await ensureCompanyAccess(companyId)
  const type = asDefinitionType(searchParams.get("type"))
  const includeInactive = searchParams.get("includeInactive") === "true"

  const definitions = await prisma.companyDefinition.findMany({
    where: {
      companyId,
      ...(type ? { type } : {}),
      ...(includeInactive ? {} : { isActive: true }),
    },
    orderBy: [{ type: "asc" }, { label: "asc" }],
  })

  return NextResponse.json(definitions)
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const companyId = String(body?.companyId || "")
  const type = asDefinitionType(body?.type)
  const label = String(body?.label || "").trim()

  if (!companyId || !type || !label) {
    return NextResponse.json({ error: "companyId, type and label are required" }, { status: 400 })
  }

  const access = await ensureCompanyAccess(companyId)
  if (access.role === "VIEWER") {
    return NextResponse.json({ error: "Bu işlem için yetkiniz yok" }, { status: 403 })
  }

  const created = await prisma.companyDefinition.create({
    data: {
      companyId,
      type,
      label,
      isActive: true,
    },
  })

  return NextResponse.json(created, { status: 201 })
}
