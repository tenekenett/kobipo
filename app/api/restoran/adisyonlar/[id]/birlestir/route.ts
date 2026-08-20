import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { assertRestaurantModule, serializeTicket, ticketInclude } from "@/lib/restoran/tickets"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

/**
 * İki açık adisyonu tek hesapta birleştirir. `[id]` HEDEFtir (hesabın toplanacağı
 * adisyon), gövdedeki `sourceTicketId` kaynaktır.
 *
 * Kaynak SİLİNMEZ, `CANCELLED` + `mergedIntoId` olur. Silmek en kolayıydı ama
 * "ADS-0007 nereye gitti" sorusunun cevabı kalmazdı; iptalden ayırt edilmesi de
 * şart çünkü cirosu kaybolmadı, hedefe geçti.
 *
 * Kalemler taşınır, KOPYALANMAZ: kopyalasaydık aynı ürün iki adisyonda görünür,
 * ikram/zayi sayımı ve stok düşümü ikiye katlanırdı.
 */
export const POST = withApiErrors(async function POST(request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const companyId = await resolveCompanyId(body.companyId)
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyWrite(companyId))

    const { id } = await params
    const sourceId = String(body.sourceTicketId || "")
    if (!sourceId) {
      return NextResponse.json({ error: "sourceTicketId zorunlu" }, { status: 400 })
    }
    if (sourceId === id) {
      return NextResponse.json({ error: "Adisyon kendisiyle birleştirilemez" }, { status: 400 })
    }

    const [target, source] = await Promise.all([
      prisma.restaurantTicket.findFirst({
        where: { id, companyId },
        include: { items: { select: { order: true } }, table: { select: { name: true } } },
      }),
      prisma.restaurantTicket.findFirst({
        where: { id: sourceId, companyId },
        include: { items: { select: { id: true, order: true } }, table: { select: { name: true } } },
      }),
    ])

    if (!target) return NextResponse.json({ error: "Hedef adisyon bulunamadı" }, { status: 404 })
    if (!source) return NextResponse.json({ error: "Kaynak adisyon bulunamadı" }, { status: 404 })
    if (target.status !== "OPEN" || source.status !== "OPEN") {
      return NextResponse.json(
        { error: "Yalnız açık adisyonlar birleştirilebilir" },
        { status: 409 },
      )
    }

    // Kalem sırası hedefin sonundan devam eder: iki adisyonun `order`'ı 0'dan
    // başladığı için taşımadan sonra sıralar iç içe geçer, adisyon karışık görünürdü.
    const offset = target.items.reduce((max, i) => Math.max(max, i.order), -1) + 1

    // Kaynağın iskontosu birleşmede DÜŞER: iki farklı iskonto tek hesapta
    // toplanamaz (yüzde + tutar karışımı anlamsız olurdu). Kullanıcı hedefte
    // yeniden verir; not satırı ne olduğunu söylüyor.
    const trace = `${source.code} birleştirildi${source.table?.name ? ` (${source.table.name})` : ""}`
    const note = [target.note, trace].filter(Boolean).join(" · ")

    await prisma.$transaction([
      ...source.items.map((item) =>
        prisma.restaurantTicketItem.update({
          where: { id: item.id },
          data: { ticketId: id, order: offset + item.order },
        }),
      ),
      prisma.restaurantTicket.update({
        where: { id },
        data: {
          note: note.slice(0, 2000),
          guestCount:
            target.guestCount != null || source.guestCount != null
              ? (target.guestCount ?? 0) + (source.guestCount ?? 0)
              : null,
          // Kaynakta hesap istenmişse hedefte de istenmiş sayılır: müşteri
          // kalkmaya hazır, masa birleşti diye işaret kaybolmamalı.
          billRequestedAt: target.billRequestedAt ?? source.billRequestedAt,
        },
      }),
      prisma.restaurantTicket.update({
        where: { id: sourceId },
        data: {
          status: "CANCELLED",
          mergedIntoId: id,
          closedAt: new Date(),
          closedBy: user.id,
          billRequestedAt: null,
          billRequestedBy: null,
        },
      }),
      // Kaynak masa boşaldı ama müşteri kalkmadı — hesabı taşındı. "Temizlenecek"
      // damgası basılmaz; masa doğrudan boşa döner.
      ...(source.tableId
        ? [
            prisma.restaurantTable.updateMany({
              where: { id: source.tableId, companyId },
              data: { cleaningSince: null },
            }),
          ]
        : []),
    ])

    const merged = await prisma.restaurantTicket.findUnique({
      where: { id },
      include: ticketInclude,
    })

    return NextResponse.json({
      success: true,
      movedItems: source.items.length,
      sourceCode: source.code,
      ticket: merged ? serializeTicket(merged) : null,
    })
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error, error.message)
    }
    console.error("Error merging tickets:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
