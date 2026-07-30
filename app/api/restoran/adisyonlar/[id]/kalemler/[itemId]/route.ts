import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import {
  assertRestaurantModule,
  serializeTicket,
  ticketInclude,
  TICKET_ITEM_REASONS,
  TICKET_ITEM_STATUSES,
  type TicketItemStatus,
} from "@/lib/restoran/tickets"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string; itemId: string }> }

/** Adisyon kaleminin adedini/notunu/fiyatını değiştirir (adisyon açıkken). */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const companyId = await resolveCompanyId(body.companyId)
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyWrite(companyId))

    const { id, itemId } = await params
    const ticket = await prisma.restaurantTicket.findFirst({ where: { id, companyId } })
    if (!ticket) return NextResponse.json({ error: "Adisyon bulunamadı" }, { status: 404 })
    if (ticket.status !== "OPEN") {
      return NextResponse.json({ error: "Kapanmış adisyon değiştirilemez" }, { status: 409 })
    }

    const item = await prisma.restaurantTicketItem.findFirst({ where: { id: itemId, ticketId: id } })
    if (!item) return NextResponse.json({ error: "Kalem bulunamadı" }, { status: 404 })

    const data: Record<string, unknown> = {}

    if (body.quantity !== undefined) {
      const quantity = Number(body.quantity)
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return NextResponse.json({ error: "Adet sıfırdan büyük olmalı" }, { status: 400 })
      }
      data.quantity = quantity
    }
    if (body.unitPrice !== undefined) {
      const unitPrice = Number(body.unitPrice)
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        return NextResponse.json({ error: "Geçersiz fiyat" }, { status: 400 })
      }
      data.unitPrice = unitPrice
    }
    if (body.vatRate !== undefined && Number.isFinite(Number(body.vatRate))) {
      data.vatRate = Number(body.vatRate)
    }
    if (body.note !== undefined) {
      const note = String(body.note || "").trim()
      data.note = note || null
    }

    // İkram / zayi / iptal. Silmek yerine işaretlemenin sebebi: silinen kalem
    // ölçülemez ve — daha kötüsü — stok kapanışta düştüğü için malzemesi hiç
    // düşmez. Sebep zorunlu: raporun gruplanabilmesi buna bağlı.
    if (body.status !== undefined) {
      const status = String(body.status || "NORMAL").toUpperCase()
      if (!TICKET_ITEM_STATUSES.includes(status as TicketItemStatus)) {
        return NextResponse.json({ error: "Geçersiz kalem durumu" }, { status: 400 })
      }
      if (status === "NORMAL") {
        data.status = "NORMAL"
        data.reasonCode = null
        data.reason = null
      } else {
        const allowed = TICKET_ITEM_REASONS[status as Exclude<TicketItemStatus, "NORMAL">]
        const code = String(body.reasonCode || "").trim()
        if (!allowed.some((r) => r.code === code)) {
          return NextResponse.json({ error: "Sebep seçilmeli" }, { status: 400 })
        }
        data.status = status
        data.reasonCode = code
        data.reason = body.reason ? String(body.reason).trim().slice(0, 255) || null : null
      }
    }

    await prisma.restaurantTicketItem.update({ where: { id: itemId }, data })

    const fresh = await prisma.restaurantTicket.findUnique({ where: { id }, include: ticketInclude })
    return NextResponse.json(serializeTicket(fresh!))
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error("Error updating ticket item:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * Kalemi siler. Adisyon açıkken serbesttir: v1'de mutfak/kasa ayrımı yok, ürün
 * hazırlanmadan önce kalem silmek normal iştir ve stok henüz düşmemiştir.
 */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyWrite(companyId))

    const { id, itemId } = await params
    const ticket = await prisma.restaurantTicket.findFirst({ where: { id, companyId } })
    if (!ticket) return NextResponse.json({ error: "Adisyon bulunamadı" }, { status: 404 })
    if (ticket.status !== "OPEN") {
      return NextResponse.json({ error: "Kapanmış adisyon değiştirilemez" }, { status: 409 })
    }

    const item = await prisma.restaurantTicketItem.findFirst({ where: { id: itemId, ticketId: id } })
    if (!item) return NextResponse.json({ error: "Kalem bulunamadı" }, { status: 404 })

    await prisma.restaurantTicketItem.delete({ where: { id: itemId } })

    const fresh = await prisma.restaurantTicket.findUnique({ where: { id }, include: ticketInclude })
    return NextResponse.json(serializeTicket(fresh!))
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error("Error deleting ticket item:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
