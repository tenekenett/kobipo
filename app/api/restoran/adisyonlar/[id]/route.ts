import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import {
  assertRestaurantModule,
  serializeTicket,
  ticketInclude,
  ticketTotals,
  TICKET_CANCEL_REASONS,
  TICKET_DISCOUNT_REASONS,
  TICKET_DISCOUNT_TYPES,
} from "@/lib/restoran/tickets"
import {
  discountExceedsLimit,
  discountLimitError,
  normalizeDiscountLimit,
} from "@/lib/restoran/discount-limit"
import { buildTicketDetail } from "@/lib/restoran/ticket-detail"
import { accessDeniedResponse } from "@/lib/api/errors"

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

    const base = serializeTicket(ticket)

    // Denetim alanları YALNIZ istendiğinde hesaplanır: canlı satış ekranı bu ucu
    // her kalem eklemede yeniden çekiyor, personel/ödeme sorguları oraya yük
    // olmamalı. Kararlar: docs/restoran/ADISYON-DETAY.md K2.
    if (searchParams.get("detail") === "1") {
      const detail = await buildTicketDetail(ticket.id, companyId)
      return NextResponse.json({ ...base, ...detail })
    }

    return NextResponse.json(base)
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error, error.message)
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
    // `discountType: null` iskontoyu kaldırır — kaldırırken personel ve iz
    // alanları da temizlenir, aksi halde "iskontosuz ama personelli" bir kayıt
    // kalır ve rapor onu iskonto sanardı.
    if (body.discountType !== undefined) {
      const type = body.discountType ? String(body.discountType).toUpperCase() : null
      if (type === null) {
        data.discountType = null
        data.discountValue = null
        data.discountReasonCode = null
        data.discountReason = null
        data.discountEmployeeId = null
        data.discountBy = null
        data.discountAt = null
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

        // İŞLETME TAVANI. Diyalog "Uygula"yı zaten kilitliyor; buradaki kontrol
        // ucun doğrudan çağrıldığı hâl için — tavan istemcide kalsaydı hiç
        // olmazdı. Kalemler tutar iskontosu YÜZÜNDEN okunuyor: "50 lira indirim"
        // ancak hesabın toplamıyla oranlanınca bir yüzdeye karşılık gelir.
        const limit = normalizeDiscountLimit(
          (
            await prisma.company.findUnique({
              where: { id: companyId },
              select: { restaurantMaxDiscountPercent: true },
            })
          )?.restaurantMaxDiscountPercent,
        )
        if (limit !== null) {
          const items = await prisma.restaurantTicketItem.findMany({
            where: { ticketId: id },
            select: { quantity: true, unitPrice: true, vatRate: true, status: true },
          })
          const { gross } = ticketTotals(items)
          if (discountExceedsLimit({ type: type as "PERCENT" | "AMOUNT", value }, gross, limit)) {
            return NextResponse.json({ error: discountLimitError(limit, gross) }, { status: 400 })
          }
        }

        const reasonCode = body.discountReasonCode
          ? String(body.discountReasonCode).trim().toUpperCase()
          : null
        if (reasonCode && !TICKET_DISCOUNT_REASONS.some((r) => r.code === reasonCode)) {
          return NextResponse.json({ error: "Geçersiz iskonto sebebi" }, { status: 400 })
        }

        // Serbest AÇIKLAMA da zorunlu (2026-08-07). Sebep kodu raporun gruplama
        // ekseni; "%20 · Sadık müşteri" ise denetimde tek başına bir şey
        // anlatmıyor — hangi müşteri, hangi söz. İkisi farklı iş görüyor.
        const reasonText = body.discountReason
          ? String(body.discountReason).trim().slice(0, 255)
          : ""
        if (!reasonText) {
          return NextResponse.json({ error: "İskonto açıklaması yazılmalı" }, { status: 400 })
        }

        // İskontoyu uygulayan personel. Firmanın İK kartı olmalı — başka firmanın
        // personeli seçilemesin. ZORUNLULUK KOŞULLU: personel kartı hiç
        // tanımlanmamış (ya da `hr` modülü kapalı) firmada iskonto kilitlenmemeli,
        // yoksa bugüne kadar çalışan bir akış tek alan yüzünden dururdu.
        const employeeId = body.discountEmployeeId ? String(body.discountEmployeeId) : null
        if (employeeId) {
          const employee = await prisma.employee.findFirst({
            where: { id: employeeId, companyId },
            select: { id: true },
          })
          if (!employee) return NextResponse.json({ error: "Personel bulunamadı" }, { status: 404 })
        } else {
          const hasEmployees = await prisma.employee.count({
            where: { companyId, status: "ACTIVE" },
          })
          if (hasEmployees > 0) {
            return NextResponse.json(
              { error: "İskontoyu uygulayan personel seçilmeli" },
              { status: 400 },
            )
          }
        }

        data.discountType = type
        data.discountValue = value
        data.discountReasonCode = reasonCode
        data.discountReason = reasonText
        data.discountEmployeeId = employeeId
        data.discountBy = user.id
        data.discountAt = new Date()
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
      return accessDeniedResponse(error, error.message)
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
 *
 * **Kalemi varsa SEBEP ZORUNLU** (`?reasonCode=`). Kalem iptalinde sebep baştan
 * zorunluydu ama dolu bir hesabı tek tıkla iptal etmek sebepsizdi — kaçak tek
 * kalemde değil, hesabın tamamında yapılır. Boş adisyonda sorulmuyor: yanlış
 * açılmış boş kayıt için sebep sormak gürültüdür.
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

    const reasonCode = String(searchParams.get("reasonCode") || "").trim()
    if (!TICKET_CANCEL_REASONS.some((r) => r.code === reasonCode)) {
      return NextResponse.json(
        {
          error: "İptal sebebi seçilmeli",
          reasons: TICKET_CANCEL_REASONS.map((r) => ({ code: r.code, label: r.label })),
        },
        { status: 400 },
      )
    }
    const reason = String(searchParams.get("reason") || "").trim().slice(0, 255) || null

    await prisma.restaurantTicket.update({
      where: { id },
      data: {
        status: "CANCELLED",
        closedAt: new Date(),
        closedBy: user.id,
        cancelReasonCode: reasonCode,
        cancelReason: reason,
      },
    })
    return NextResponse.json({ success: true, deleted: false, reasonCode })
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error, error.message)
    }
    console.error("Error cancelling ticket:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
