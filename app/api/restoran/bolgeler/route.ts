import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { assertRestaurantModule } from "@/lib/restoran/tickets"
import { normalizeGrid } from "@/lib/restoran/floor-plan"

export const dynamic = "force-dynamic"

// Bölge/salon: "Bahçe", "Üst Kat". Salon planında sekme olur.
// Kararlar: docs/restoran/ASAMA2.md

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyAccess(companyId))

    const areas = await prisma.restaurantArea.findMany({
      where: { companyId, ...(searchParams.get("all") === "1" ? {} : { isActive: true }) },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select: { id: true, name: true, order: true, gridSize: true, isActive: true },
    })

    return NextResponse.json(areas)
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error("Error fetching restaurant areas:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const companyId = await resolveCompanyId(body.companyId)
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyWrite(companyId))

    const name = String(body.name || "").trim()
    if (!name) return NextResponse.json({ error: "Bölge adı zorunlu" }, { status: 400 })

    const exists = await prisma.restaurantArea.findFirst({ where: { companyId, name } })
    if (exists) return NextResponse.json({ error: "Bu adda bir bölge zaten var" }, { status: 409 })

    const last = await prisma.restaurantArea.findFirst({
      where: { companyId },
      orderBy: { order: "desc" },
      select: { order: true },
    })

    const area = await prisma.restaurantArea.create({
      data: {
        companyId,
        name,
        order: Number.isFinite(Number(body.order)) ? Number(body.order) : (last?.order ?? -1) + 1,
        gridSize: normalizeGrid(body.gridSize),
      },
      select: { id: true, name: true, order: true, gridSize: true, isActive: true },
    })

    // "Bölgesiz" planı gerçek bir bölgeye dönüştürme. Bölgesiz kroki, saklayacak
    // bir satırı olmadığı için plan boyutunu tutamaz; kullanıcı onu adlandırınca
    // oradaki masa ve kroki öğeleri toptan yeni bölgeye geçer. Tek tek PATCH
    // atmak yerine burada yapılıyor: yarıda kalırsa plan ikiye bölünürdü.
    if (body.adoptUnassigned) {
      await prisma.$transaction([
        prisma.restaurantTable.updateMany({
          where: { companyId, areaId: null },
          data: { areaId: area.id },
        }),
        prisma.restaurantPlanItem.updateMany({
          where: { companyId, areaId: null },
          data: { areaId: area.id },
        }),
      ])
    }

    return NextResponse.json(area, { status: 201 })
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error("Error creating restaurant area:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
