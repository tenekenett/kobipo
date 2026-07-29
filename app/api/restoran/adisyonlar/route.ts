import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import {
  assertRestaurantModule,
  nextTicketCode,
  serializeTicket,
  ticketInclude,
  TICKET_STATUSES,
} from "@/lib/restoran/tickets"

export const dynamic = "force-dynamic"

// Adisyon = masaya bağlı, saatlerce açık kalan ÇALIŞMA kaydı. Stoğa ve cariye
// DOKUNMAZ; muhasebe etkisi yalnız kapanışta (fiş) doğar — ASAMA2.md.

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyAccess(companyId))

    const statusParam = searchParams.get("status")?.toUpperCase()
    const status = TICKET_STATUSES.find((s) => s === statusParam)
    const tableId = searchParams.get("tableId")?.trim() || undefined
    const limitRaw = Number(searchParams.get("limit"))
    const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 100

    const from = searchParams.get("from")
    const to = searchParams.get("to")

    const tickets = await prisma.restaurantTicket.findMany({
      where: {
        companyId,
        // Varsayılan AÇIK adisyonlar: ekranın %99'u bunu istiyor, kapanmış
        // adisyonların tamamını çekmek zamanla ağırlaşır.
        status: status ?? "OPEN",
        ...(tableId ? { tableId } : {}),
        ...(from || to
          ? {
              openedAt: {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to ? { lte: new Date(to) } : {}),
              },
            }
          : {}),
      },
      orderBy: { openedAt: "desc" },
      take: limit,
      include: ticketInclude,
    })

    return NextResponse.json(tickets.map(serializeTicket))
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error("Error fetching tickets:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * Adisyon açar. Masa opsiyoneldir (paket/gel-al masasız açılır).
 *
 * Bir masada AYNI ANDA tek açık adisyon olur: aksi halde iki garson aynı masaya
 * ayrı adisyon açar ve hesap ikiye bölünür. Zaten açık adisyon varsa 409 döner
 * ve mevcut adisyon yanıtta gelir — ekran onu açar, kullanıcı hata görmez.
 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const companyId = await resolveCompanyId(body.companyId)
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyWrite(companyId))

    const tableId = body.tableId ? String(body.tableId) : null
    if (tableId) {
      const table = await prisma.restaurantTable.findFirst({ where: { id: tableId, companyId } })
      if (!table) return NextResponse.json({ error: "Masa bulunamadı" }, { status: 404 })
      if (!table.isActive) {
        return NextResponse.json({ error: "Masa kullanım dışı" }, { status: 409 })
      }

      const open = await prisma.restaurantTicket.findFirst({
        where: { companyId, tableId, status: "OPEN" },
        include: ticketInclude,
      })
      if (open) {
        return NextResponse.json(
          { error: "Masada zaten açık adisyon var", ticket: serializeTicket(open) },
          { status: 409 },
        )
      }
    }

    const customerId = body.customerId ? String(body.customerId) : null
    if (customerId) {
      const customer = await prisma.customer.findFirst({ where: { id: customerId, companyId } })
      if (!customer) return NextResponse.json({ error: "Müşteri bulunamadı" }, { status: 404 })
    }

    const code = await nextTicketCode(prisma, companyId)

    const ticket = await prisma.restaurantTicket.create({
      data: {
        companyId,
        tableId,
        code,
        customerId,
        guestCount: Number.isFinite(Number(body.guestCount)) ? Number(body.guestCount) : null,
        note: body.note ? String(body.note).trim() : null,
        openedBy: user.id,
      },
      include: ticketInclude,
    })

    return NextResponse.json(serializeTicket(ticket), { status: 201 })
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    // Eşzamanlı iki "adisyon aç" isteği aynı numarayı üretirse benzersizlik
    // kısıtı devreye girer; kullanıcı tekrar denesin diye açık mesaj dönüyoruz.
    if (error?.code === "P2002") {
      return NextResponse.json({ error: "Adisyon numarası çakıştı, tekrar deneyin" }, { status: 409 })
    }
    console.error("Error creating ticket:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
