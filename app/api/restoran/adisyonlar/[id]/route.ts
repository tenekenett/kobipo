import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import {
  assertRestaurantModule,
  serializeTicket,
  ticketInclude,
  TICKET_DISCOUNT_TYPES,
} from "@/lib/restoran/tickets"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyAccess(companyId))

    const { id } = await params
    const ticket = await prisma.restaurantTicket.findFirst({
      where: { id, companyId },
      include: ticketInclude,
    })
    if (!ticket) return NextResponse.json({ error: "Adisyon bulunamadı" }, { status: 404 })

    return NextResponse.json(serializeTicket(ticket))
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error("Error fetching ticket:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * Adisyonu günceller: not, kişi sayısı, müşteri, İSKONTO ve MASA TAŞIMA.
 *
 * Masa taşıma ayrı bir uç değil çünkü tek alan değişiyor (`tableId`); hedef
 * masada açık adisyon varsa reddedilir — iki hesap sessizce üst üste binmesin.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const companyId = await resolveCompanyId(body.companyId)
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyWrite(companyId))

    const { id } = await params
    const existing = await prisma.restaurantTicket.findFirst({ where: { id, companyId } })
    if (!existing) return NextResponse.json({ error: "Adisyon bulunamadı" }, { status: 404 })
    if (existing.status !== "OPEN") {
      return NextResponse.json({ error: "Kapanmış adisyon değiştirilemez" }, { status: 409 })
    }

    const data: Record<string, unknown> = {}

    if (body.tableId !== undefined) {
      const tableId = body.tableId ? String(body.tableId) : null
      if (tableId) {
        const table = await prisma.restaurantTable.findFirst({ where: { id: tableId, companyId } })
        if (!table) return NextResponse.json({ error: "Masa bulunamadı" }, { status: 404 })
        if (!table.isActive) return NextResponse.json({ error: "Masa kullanım dışı" }, { status: 409 })
        const busy = await prisma.restaurantTicket.findFirst({
          where: { companyId, tableId, status: "OPEN", id: { not: id } },
          select: { code: true },
        })
        if (busy) {
          return NextResponse.json(
            { error: `Hedef masada açık adisyon var (${busy.code})` },
            { status: 409 },
          )
        }
      }
      data.tableId = tableId
    }

    if (body.customerId !== undefined) {
      const customerId = body.customerId ? String(body.customerId) : null
      if (customerId) {
        const customer = await prisma.customer.findFirst({ where: { id: customerId, companyId } })
        if (!customer) return NextResponse.json({ error: "Müşteri bulunamadı" }, { status: 404 })
      }
      data.customerId = customerId
    }

    if (body.guestCount !== undefined) {
      data.guestCount = Number.isFinite(Number(body.guestCount)) ? Number(body.guestCount) : null
    }
    if (body.note !== undefined) {
      const noteValue = String(body.note || "").trim()
      data.note = noteValue || null
    }

    // "Hesap istendi" işareti. Adisyonu KAPATMAZ — kalem eklenmeye devam
    // edebilir; yalnız salon planında masayı öne çıkarır. Zaman damgası
    // saklanıyor ki "hesap ne kadar sürede getirildi" sonradan ölçülebilsin.
    if (body.billRequested !== undefined) {
      const wanted = Boolean(body.billRequested)
      data.billRequestedAt = wanted ? (existing.billRequestedAt ?? new Date()) : null
      data.billRequestedBy = wanted ? (existing.billRequestedBy ?? user.id) : null
    }

    // Hesap iskontosu. `AMOUNT` KDV DAHİL girilir (kullanıcı hesabın altındaki
    // rakama bakıp "50 lira düş" der); faturaya matrah karşılığı gider.
    // `discountType: null` iskontoyu kaldırır.
    if (body.discountType !== undefined) {
      const type = body.discountType ? String(body.discountType).toUpperCase() : null
      if (type === null) {
        data.discountType = null
        data.discountValue = null
        data.discountReason = null
      } else {
        if (!TICKET_DISCOUNT_TYPES.includes(type as (typeof TICKET_DISCOUNT_TYPES)[number])) {
          return NextResponse.json({ error: "Geçersiz iskonto türü" }, { status: 400 })
        }
        const value = Number(body.discountValue)
        if (!Number.isFinite(value) || value <= 0) {
          return NextResponse.json({ error: "İskonto sıfırdan büyük olmalı" }, { status: 400 })
        }
        if (type === "PERCENT" && value > 100) {
          return NextResponse.json({ error: "Yüzde 100'den büyük olamaz" }, { status: 400 })
        }
        data.discountType = type
        data.discountValue = value
        data.discountReason = body.discountReason
          ? String(body.discountReason).trim().slice(0, 255) || null
          : null
      }
    }

    const ticket = await prisma.restaurantTicket.update({
      where: { id },
      data,
      include: ticketInclude,
    })

    return NextResponse.json(serializeTicket(ticket))
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error("Error updating ticket:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * Adisyonu iptal eder. Stok ve cari ETKİLENMEZ — açık adisyon zaten hiçbirine
 * dokunmamıştı (stok kapanışta düşer).
 *
 * Hiç kalemi olmayan adisyon (yanlış açılmış) gerçekten silinir; kalemi olan
 * `CANCELLED` olarak kalır — "masa 3'te 4 kalem girildi, sonra iptal edildi"
 * bilgisi kaybolmasın.
 */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyWrite(companyId))

    const { id } = await params
    const existing = await prisma.restaurantTicket.findFirst({
      where: { id, companyId },
      include: { items: { select: { id: true } } },
    })
    if (!existing) return NextResponse.json({ error: "Adisyon bulunamadı" }, { status: 404 })
    if (existing.status === "CLOSED") {
      return NextResponse.json(
        { error: "Kapanmış adisyon iptal edilemez; fişi iptal edin" },
        { status: 409 },
      )
    }

    if (existing.items.length === 0) {
      await prisma.restaurantTicket.delete({ where: { id } })
      return NextResponse.json({ success: true, deleted: true })
    }

    await prisma.restaurantTicket.update({
      where: { id },
      data: { status: "CANCELLED", closedAt: new Date(), closedBy: user.id },
    })
    return NextResponse.json({ success: true, deleted: false })
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error("Error cancelling ticket:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
