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
import { accessDeniedResponse } from "@/lib/api/errors"

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
    // `status=ALL` → durum filtresi yok. Adisyon listesi bir GÜNÜN tamamını
    // (açık + kapanan + iptal) tek çağrıda ister; varsayılan yine OPEN kalıyor
    // çünkü salon/plan tarafındaki çağrıların tamamı yalnız açık hesapla ilgili.
    const anyStatus = statusParam === "ALL"
    const tableId = searchParams.get("tableId")?.trim() || undefined
    // `Number(null)` 0'dır ve `Number.isFinite(0)` doğrudur — eski hâlde limit
    // VERİLMEYEN her çağrı `Math.max(1, 0)` = 1 ile tek adisyon çekiyordu:
    // beş dolu masanın yalnız en yenisi listede görünüyordu. Varsayılana
    // düşme koşulu artık "sayı mı" değil, "geçerli bir limit mi".
    const limitRaw = Number(searchParams.get("limit"))
    const limit = limitRaw >= 1 ? Math.min(200, Math.floor(limitRaw)) : 100

    const from = searchParams.get("from")
    const to = searchParams.get("to")

    const tickets = await prisma.restaurantTicket.findMany({
      where: {
        companyId,
        // Varsayılan AÇIK adisyonlar: ekranın %99'u bunu istiyor, kapanmış
        // adisyonların tamamını çekmek zamanla ağırlaşır.
        ...(anyStatus ? {} : { status: status ?? "OPEN" }),
        ...(tableId ? { tableId } : {}),
        // Tarih ekseni AÇILIŞ: "o gün kesilen adisyon" adisyonun kendi günüdür,
        // kapanışı ertesi güne sarkmış olsa bile (gece yarısını geçen masa) —
        // adisyon numarası da (`ADS-YYYY-NNNN`) bu eksende ilerliyor.
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
      return accessDeniedResponse(error, error.message)
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

    // Rezervasyondan oturtma: hangi rezervasyonun gerçekleştiği TAHMİN EDİLMEZ,
    // ekran açıkça söyler. Masada bekleyen rezervasyon varken oraya oturan
    // gelen geçen müşteri rezervasyonu tüketmiş olurdu.
    const reservationId = body.reservationId ? String(body.reservationId) : null
    if (reservationId) {
      const reservation = await prisma.restaurantReservation.findFirst({
        where: { id: reservationId, companyId },
        select: { id: true, status: true },
      })
      if (!reservation) {
        return NextResponse.json({ error: "Rezervasyon bulunamadı" }, { status: 404 })
      }
      if (reservation.status !== "PENDING") {
        return NextResponse.json({ error: "Rezervasyon zaten işlenmiş" }, { status: 409 })
      }
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

    if (tableId) {
      // Masaya yeni müşteri oturdu → "temizlenecek" damgası anlamını yitirdi.
      await prisma.restaurantTable.updateMany({
        where: { id: tableId, companyId, cleaningSince: { not: null } },
        data: { cleaningSince: null },
      })
    }

    if (reservationId) {
      await prisma.restaurantReservation.updateMany({
        where: { id: reservationId, companyId, status: "PENDING" },
        data: { status: "SEATED", ticketId: ticket.id, ...(tableId ? { tableId } : {}) },
      })
    }

    return NextResponse.json(serializeTicket(ticket), { status: 201 })
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error, error.message)
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
