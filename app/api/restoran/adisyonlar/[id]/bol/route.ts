import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import {
  assertRestaurantModule,
  nextTicketCode,
  serializeTicket,
  ticketDiscountOf,
  ticketInclude,
} from "@/lib/restoran/tickets"
import { grossOf, parseSplitParts, planTicketSplit, splitTicketDiscount } from "@/lib/restoran/split"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

/** Kaynak, işlem sırasında kapandı/birleştirildi. */
class SplitConflictError extends Error {}

/**
 * Adisyonu AYRI HESAPLARA böler: seçilen kalemler (adet bölünebilir) yeni
 * adisyonlara taşınır; her parça kendi fişiyle kapanır. Kural: lib/restoran/split.ts
 *
 *   POST { companyId, parts: [{ items: [{ itemId, quantity }] }] }
 *   → { source, parts: [...] }   (hepsi serializeTicket biçiminde)
 *
 * "Masada tek açık adisyon" kuralı YENİ adisyon açarken aynen durur (iki garson
 * yanlışlıkla ayrı hesap açmasın); aynı masada birden çok açık hesap YALNIZ bu
 * yoldan doğar ve parçalar `splitFromId` ile kaynağa bağlıdır.
 *
 * Parçalar kaynağın `openedAt`ini taşır: masanın oturumu o an başladı, bölme
 * ödeme anında yapılır — yeni saat yazılsaydı "0 dk açık" görünür, masada
 * geçen süre raporu bozulurdu.
 */
export const POST = withApiErrors(async function POST(request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const companyId = await resolveCompanyId(body.companyId)
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyWrite(companyId))

    const parts = parseSplitParts(body)
    if (typeof parts === "string") return NextResponse.json({ error: parts }, { status: 400 })

    const { id } = await params
    const source = await prisma.restaurantTicket.findFirst({
      where: { id, companyId },
      include: { items: true },
    })
    if (!source) return NextResponse.json({ error: "Adisyon bulunamadı" }, { status: 404 })
    if (source.status !== "OPEN") {
      return NextResponse.json({ error: "Yalnız açık adisyon bölünebilir" }, { status: 409 })
    }

    const sourceItems = source.items.map((item) => ({
      id: item.id,
      quantity: Number(item.quantity),
      status: item.status ?? "NORMAL",
      unitPrice: Number(item.unitPrice),
      vatRate: Number(item.vatRate),
    }))
    const plan = planTicketSplit(sourceItems, parts)
    if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: 400 })

    // Bölme SONRASI brütler → iskonto dağılımı.
    const byId = new Map(sourceItems.map((item) => [item.id, item]))
    const partGrosses = parts.map((_, partIndex) =>
      grossOf(
        plan.moves
          .filter((m) => m.partIndex === partIndex)
          .map((m) => ({ ...byId.get(m.itemId)!, quantity: m.quantity })),
      ),
    )
    const sourceGross = grossOf(
      sourceItems
        .filter((item) => item.status === "NORMAL")
        .map((item) => ({ ...item, quantity: plan.sourceRemaining[item.id] ?? item.quantity })),
    )
    const discounts = splitTicketDiscount(ticketDiscountOf(source), sourceGross, partGrosses)
    const discountMeta = {
      discountReasonCode: source.discountReasonCode,
      discountReason: source.discountReason,
      discountEmployeeId: source.discountEmployeeId,
      discountBy: source.discountBy,
      discountAt: source.discountAt,
    }
    const discountData = (d: (typeof discounts)["source"]) =>
      d
        ? { discountType: d.type, discountValue: d.value, ...discountMeta }
        : {
            discountType: null,
            discountValue: null,
            discountReasonCode: null,
            discountReason: null,
            discountEmployeeId: null,
            discountBy: null,
            discountAt: null,
          }

    const originals = new Map(source.items.map((item) => [item.id, item]))
    let order = source.items.reduce((max, item) => Math.max(max, item.order), -1) + 1

    const createdIds = await prisma.$transaction(async (tx) => {
      // Yarış kapısı: kapanış/birleştirme ile aynı anda gelen bölme, kapanmış
      // hesabı bölemesin. Kaynağa zararsız bir yazma yapıp OPEN'ı SUNUCUDA sorarız.
      const still = await tx.restaurantTicket.updateMany({
        where: { id, companyId, status: "OPEN" },
        data: discountData(discounts.source),
      })
      if (still.count === 0) throw new SplitConflictError()

      const ids: string[] = []
      for (const [partIndex] of parts.entries()) {
        const code = await nextTicketCode(tx, companyId)
        const part = await tx.restaurantTicket.create({
          data: {
            companyId,
            tableId: source.tableId,
            code,
            status: "OPEN",
            openedAt: source.openedAt,
            openedBy: user.id,
            splitFromId: source.id,
            billRequestedAt: source.billRequestedAt,
            billRequestedBy: source.billRequestedBy,
            ...discountData(discounts.parts[partIndex]),
          },
          select: { id: true },
        })
        ids.push(part.id)
      }

      for (const move of plan.moves) {
        const original = originals.get(move.itemId)!
        const targetId = ids[move.partIndex]
        if (move.reuseRow) {
          await tx.restaurantTicketItem.update({
            where: { id: original.id },
            data: { ticketId: targetId, quantity: move.quantity, order: order++ },
          })
        } else {
          await tx.restaurantTicketItem.create({
            data: {
              ticketId: targetId,
              productId: original.productId,
              description: original.description,
              unit: original.unit,
              quantity: move.quantity,
              unitPrice: original.unitPrice,
              vatRate: original.vatRate,
              note: original.note,
              status: "NORMAL",
              options: original.options === null ? Prisma.JsonNull : (original.options as Prisma.InputJsonValue),
              order: order++,
              // Kalem ne zaman girildiyse o: "masaya ne zaman ne geldi" izi bozulmasın.
              createdAt: original.createdAt,
              createdBy: original.createdBy,
            },
          })
        }
      }

      for (const [itemId, remaining] of Object.entries(plan.sourceRemaining)) {
        if (remaining > 0) {
          await tx.restaurantTicketItem.update({ where: { id: itemId }, data: { quantity: remaining } })
        }
      }
      return ids
    })

    const [freshSource, freshParts] = await Promise.all([
      prisma.restaurantTicket.findUnique({ where: { id }, include: ticketInclude }),
      prisma.restaurantTicket.findMany({ where: { id: { in: createdIds } }, include: ticketInclude }),
    ])
    const ordered = createdIds.map((pid) => freshParts.find((p) => p.id === pid)!).filter(Boolean)

    return NextResponse.json({
      source: serializeTicket(freshSource!),
      parts: ordered.map(serializeTicket),
    })
  } catch (error: any) {
    if (error instanceof SplitConflictError) {
      return NextResponse.json({ error: "Adisyon bu sırada kapatıldı; bölünemedi" }, { status: 409 })
    }
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error, error.message)
    }
    if (error?.code === "P2002") {
      return NextResponse.json({ error: "Adisyon numarası çakıştı, tekrar deneyin" }, { status: 409 })
    }
    console.error("Error splitting ticket:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

