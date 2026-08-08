import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { assertRestaurantModule } from "@/lib/restoran/tickets"
import {
  clampDuration,
  expireStaleReservations,
  findReservationClash,
  reservationDayRange,
  reservationInclude,
  serializeReservation,
} from "@/lib/restoran/reservations"
import { accessDeniedResponse } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

// Rezervasyon — masanın GELECEKTEKİ dolusu. Adisyondan ayrı tablodur ve hiçbir
// ciro/stok sorgusuna girmez (gerekçe: lib/restoran/reservations.ts).

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyAccess(companyId))

    // Süresi geçmiş bekleyenler önce NOSHOW'a düşer: "oturdu" yalnız adisyon
    // açılışıyla verildiği için gelmeyen misafirin kaydı aksi halde sonsuza
    // kadar PENDING kalıyor ve gelmeme oranı ölçülemiyordu.
    await expireStaleReservations(prisma, companyId)

    const tableId = searchParams.get("tableId")?.trim()
    const reservations = await prisma.restaurantReservation.findMany({
      where: {
        companyId,
        reservedAt: reservationDayRange(searchParams.get("from"), searchParams.get("to")),
        ...(tableId ? { tableId } : {}),
      },
      orderBy: { reservedAt: "asc" },
      include: reservationInclude,
    })

    return NextResponse.json(reservations.map(serializeReservation))
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error, error.message)
    }
    console.error("Error fetching reservations:", error)
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

    const guestName = String(body.guestName || "").trim()
    if (!guestName) return NextResponse.json({ error: "İsim zorunlu" }, { status: 400 })

    const reservedAt = new Date(body.reservedAt)
    if (Number.isNaN(reservedAt.getTime())) {
      return NextResponse.json({ error: "Geçerli bir tarih/saat girin" }, { status: 400 })
    }

    const durationMin = clampDuration(body.durationMin)
    const tableId = body.tableId ? String(body.tableId) : null

    // Masa seçmek ZORUNLU DEĞİL: "cumartesi 20:00, 6 kişi" rezervasyonu masası
    // belli olmadan alınır, masa gün içinde atanır.
    if (tableId) {
      const table = await prisma.restaurantTable.findFirst({ where: { id: tableId, companyId } })
      if (!table) return NextResponse.json({ error: "Masa bulunamadı" }, { status: 404 })

      const clash = await findReservationClash(prisma, {
        companyId,
        tableId,
        reservedAt,
        durationMin,
      })
      if (clash) {
        return NextResponse.json(
          { error: `Bu masada çakışan rezervasyon var: ${clash}` },
          { status: 409 },
        )
      }
    }

    const reservation = await prisma.restaurantReservation.create({
      data: {
        companyId,
        tableId,
        guestName,
        phone: body.phone ? String(body.phone).trim() : null,
        guestCount: Number.isFinite(Number(body.guestCount)) ? Number(body.guestCount) : null,
        reservedAt,
        durationMin,
        note: body.note ? String(body.note).trim() : null,
        createdBy: user.id,
      },
      include: reservationInclude,
    })

    return NextResponse.json(serializeReservation(reservation), { status: 201 })
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error, error.message)
    }
    console.error("Error creating reservation:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
