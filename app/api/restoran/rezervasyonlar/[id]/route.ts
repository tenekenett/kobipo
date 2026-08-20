import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { assertRestaurantModule } from "@/lib/restoran/tickets"
import {
  RESERVATION_STATUSES,
  clampDuration,
  findReservationClash,
  reservationInclude,
  serializeReservation,
  type ReservationStatus,
} from "@/lib/restoran/reservations"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

/** Rezervasyonu düzenler: masa, saat, süre, kişi ve DURUM (gelmedi/iptal). */
export const PATCH = withApiErrors(async function PATCH(request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const companyId = await resolveCompanyId(body.companyId)
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyWrite(companyId))

    const { id } = await params
    const existing = await prisma.restaurantReservation.findFirst({ where: { id, companyId } })
    if (!existing) return NextResponse.json({ error: "Rezervasyon bulunamadı" }, { status: 404 })

    const data: Record<string, unknown> = {}

    if (body.guestName !== undefined) {
      const guestName = String(body.guestName || "").trim()
      if (!guestName) return NextResponse.json({ error: "İsim zorunlu" }, { status: 400 })
      data.guestName = guestName
    }
    if (body.phone !== undefined) data.phone = String(body.phone || "").trim() || null
    if (body.note !== undefined) data.note = String(body.note || "").trim() || null
    if (body.guestCount !== undefined) {
      data.guestCount = Number.isFinite(Number(body.guestCount)) ? Number(body.guestCount) : null
    }

    const reservedAt =
      body.reservedAt !== undefined ? new Date(body.reservedAt) : existing.reservedAt
    if (Number.isNaN(reservedAt.getTime())) {
      return NextResponse.json({ error: "Geçerli bir tarih/saat girin" }, { status: 400 })
    }
    if (body.reservedAt !== undefined) data.reservedAt = reservedAt

    const durationMin =
      body.durationMin !== undefined ? clampDuration(body.durationMin) : existing.durationMin
    if (body.durationMin !== undefined) data.durationMin = durationMin

    const tableId =
      body.tableId !== undefined ? (body.tableId ? String(body.tableId) : null) : existing.tableId
    if (body.tableId !== undefined) {
      if (tableId) {
        const table = await prisma.restaurantTable.findFirst({ where: { id: tableId, companyId } })
        if (!table) return NextResponse.json({ error: "Masa bulunamadı" }, { status: 404 })
      }
      data.tableId = tableId
    }

    // Masa/saat/süreden HERHANGİ biri değiştiyse çakışma yeniden bakılır: yalnız
    // saati değiştirmek de aynı masada iki rezervasyonu üst üste bindirebilir.
    const geometryChanged =
      body.tableId !== undefined || body.reservedAt !== undefined || body.durationMin !== undefined
    if (geometryChanged && tableId && existing.status === "PENDING") {
      const clash = await findReservationClash(prisma, {
        companyId,
        tableId,
        reservedAt,
        durationMin,
        excludeId: id,
      })
      if (clash) {
        return NextResponse.json(
          { error: `Bu masada çakışan rezervasyon var: ${clash}` },
          { status: 409 },
        )
      }
    }

    if (body.status !== undefined) {
      const status = String(body.status).toUpperCase() as ReservationStatus
      if (!RESERVATION_STATUSES.includes(status)) {
        return NextResponse.json({ error: "Geçersiz durum" }, { status: 400 })
      }
      // SEATED yalnız adisyon açılışıyla verilir (POST /adisyonlar) — elle
      // işaretlenebilseydi hiçbir adisyona bağlı olmayan "oturdu" kayıtları
      // birikir, rezervasyon–ciro bağı anlamını yitirirdi.
      if (status === "SEATED") {
        return NextResponse.json(
          { error: "Oturdu durumu masaya adisyon açılarak verilir" },
          { status: 409 },
        )
      }
      data.status = status
    }

    const reservation = await prisma.restaurantReservation.update({
      where: { id },
      data,
      include: reservationInclude,
    })

    return NextResponse.json(serializeReservation(reservation))
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error, error.message)
    }
    console.error("Error updating reservation:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

/**
 * Rezervasyonu siler. Misafiri OTURMUŞ rezervasyon silinmez, iptal edilir:
 * adisyona bağlıdır ve "bu ciro rezervasyondan geldi" izini taşır.
 */
export const DELETE = withApiErrors(async function DELETE(request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyWrite(companyId))

    const { id } = await params
    const existing = await prisma.restaurantReservation.findFirst({ where: { id, companyId } })
    if (!existing) return NextResponse.json({ error: "Rezervasyon bulunamadı" }, { status: 404 })

    if (existing.status === "SEATED") {
      await prisma.restaurantReservation.update({
        where: { id },
        data: { status: "CANCELLED" },
      })
      return NextResponse.json({ success: true, cancelled: true })
    }

    await prisma.restaurantReservation.delete({ where: { id } })
    return NextResponse.json({ success: true, cancelled: false })
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error, error.message)
    }
    console.error("Error deleting reservation:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
