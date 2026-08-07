import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { validateRange } from "@/lib/personel/shift-api"

export const dynamic = "force-dynamic"

/**
 * Vardiya şablonları ("Sabah 09:00–17:00").
 *
 * Takvimi tek tek doldurmak yerine kalıptan üretmek için. Şablonun rengi barın
 * rengi olur: hafta ızgarasında "sabahçı mı akşamcı mı" ayrımını yapan tek işaret
 * budur, orada her satır zaten tek personel.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const companyId = await resolveCompanyId(searchParams.get("companyId"))
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  await ensureCompanyAccess(companyId)

  const templates = await prisma.shiftTemplate.findMany({
    where: { companyId, isActive: true },
    orderBy: { startMinute: "asc" },
  })
  return NextResponse.json(templates)
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json()
  const companyId = await resolveCompanyId(body.companyId)
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })
  const name = String(body.name || "").trim()
  if (!name) return NextResponse.json({ error: "Şablon adı zorunlu" }, { status: 400 })

  const range = validateRange(body.startMinute, body.endMinute)
  if (typeof range === "string") return NextResponse.json({ error: range }, { status: 400 })

  await ensureCompanyWrite(companyId)

  const created = await prisma.shiftTemplate.create({
    data: {
      companyId,
      name,
      startMinute: range.start,
      endMinute: range.end,
      breakMinutes: Math.max(0, Math.round(Number(body.breakMinutes) || 0)),
      color: body.color || null,
    },
  })
  return NextResponse.json(created, { status: 201 })
}
