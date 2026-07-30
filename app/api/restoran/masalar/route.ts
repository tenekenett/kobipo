import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import {
  assertRestaurantModule,
  isBillableItem,
  TABLE_SHAPES,
  ticketDiscountOf,
  ticketTotals,
} from "@/lib/restoran/tickets"

export const dynamic = "force-dynamic"

// Masa + salon planı yerleşimi. Koordinatlar ızgara HÜCRESİ cinsindendir
// (piksel değil) — gerekçe: docs/restoran/ASAMA2.md.

/**
 * Masaları, üzerlerindeki AÇIK adisyonun özetiyle birlikte döndürür.
 *
 * Salon planının tek çağrıda çizilebilmesi için özet burada hesaplanır: ekran
 * masa sayısı kadar ayrı istek atmasın (30 masalı bir salonda 30 istek eder).
 */
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyAccess(companyId))

    const includeInactive = searchParams.get("all") === "1"
    const areaId = searchParams.get("areaId")?.trim()

    const tables = await prisma.restaurantTable.findMany({
      where: {
        companyId,
        ...(includeInactive ? {} : { isActive: true }),
        ...(areaId ? { areaId } : {}),
      },
      orderBy: [{ y: "asc" }, { x: "asc" }, { name: "asc" }],
      include: {
        area: { select: { id: true, name: true } },
        tickets: {
          where: { status: "OPEN" },
          orderBy: { openedAt: "asc" },
          include: {
            items: {
              select: { quantity: true, unitPrice: true, vatRate: true, status: true },
            },
          },
        },
      },
    })

    return NextResponse.json(
      tables.map((table) => {
        // Bir masada normalde tek açık adisyon olur; yine de ilk açılanı esas
        // alıp sayıyı da veriyoruz (birleştirme/yarış durumu görünsün).
        const open = table.tickets[0]
        return {
          id: table.id,
          name: table.name,
          areaId: table.areaId,
          areaName: table.area?.name ?? null,
          capacity: table.capacity,
          shape: table.shape,
          x: table.x,
          y: table.y,
          width: table.width,
          height: table.height,
          isActive: table.isActive,
          openTicketCount: table.tickets.length,
          openTicket: open
            ? {
                id: open.id,
                code: open.code,
                openedAt: open.openedAt,
                guestCount: open.guestCount,
                itemCount: open.items.filter((i) => isBillableItem(i.status)).length,
                total: ticketTotals(open.items, ticketDiscountOf(open)).total,
              }
            : null,
        }
      }),
    )
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error("Error fetching restaurant tables:", error)
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
    if (!name) return NextResponse.json({ error: "Masa adı zorunlu" }, { status: 400 })

    const clash = await prisma.restaurantTable.findFirst({ where: { companyId, name } })
    if (clash) return NextResponse.json({ error: "Bu adda bir masa zaten var" }, { status: 409 })

    const areaId = body.areaId ? String(body.areaId) : null
    if (areaId) {
      const area = await prisma.restaurantArea.findFirst({ where: { id: areaId, companyId } })
      if (!area) return NextResponse.json({ error: "Bölge bulunamadı" }, { status: 404 })
    }

    const shape = TABLE_SHAPES.includes(body.shape) ? body.shape : "SQUARE"
    const width = clampSize(body.width, 2)
    const height = clampSize(body.height, 2)

    // Koordinat verilmediyse aynı bölgedeki masa sayısına göre boş bir hücreye
    // yerleştir — yeni masa daima üst üste binmeden görünür, kullanıcı sonra
    // sürükleyerek düzeltir.
    let x = Number.isFinite(Number(body.x)) ? Math.max(0, Math.trunc(Number(body.x))) : null
    let y = Number.isFinite(Number(body.y)) ? Math.max(0, Math.trunc(Number(body.y))) : null
    if (x == null || y == null) {
      const count = await prisma.restaurantTable.count({ where: { companyId, areaId } })
      const perRow = 6
      x = (count % perRow) * (width + 1)
      y = Math.floor(count / perRow) * (height + 1)
    }

    const table = await prisma.restaurantTable.create({
      data: {
        companyId,
        areaId,
        name,
        capacity: Number.isFinite(Number(body.capacity)) ? Number(body.capacity) : null,
        shape,
        x,
        y,
        width,
        height,
      },
    })

    return NextResponse.json(table, { status: 201 })
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error("Error creating restaurant table:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/** Ölçüler 1–12 hücre arasında; 0/negatif masa görünmez olurdu. */
function clampSize(value: unknown, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(12, Math.max(1, Math.trunc(n)))
}
