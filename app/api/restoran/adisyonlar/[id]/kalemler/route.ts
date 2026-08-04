import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import {
  assertRestaurantModule,
  optionEffect,
  parseItemOptions,
  serializeTicket,
  ticketInclude,
  type TicketItemOption,
} from "@/lib/restoran/tickets"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

/**
 * `RestaurantTicketItem.unitPrice` kolonu `Decimal(15, 6)`. Seçenek farkı net'e
 * çevrilirken (`grossDelta / (1 + kdv/100)`) 6 haneyi aşan bir sayı çıkabiliyor:
 * DB yazarken yuvarlıyor, aşağıdaki "aynı kalem var mı" sorgusu yuvarlanmamış
 * değerle aradığı için eşleşmiyordu — aynı ürün adisyonda iki satır oluyordu.
 * Yazılan ve aranan değer aynı olsun diye tek yerde yuvarlanıyor.
 */
const round6 = (v: number) => Math.round(v * 1_000_000) / 1_000_000

/**
 * Adisyona kalem ekler. Stok DÜŞMEZ — adisyon kapanınca fiş kesilir ve stok o an
 * reçeteyle genişletilip düşer (ASAMA2.md "Stok ne zaman düşer").
 *
 * Ürün seçildiyse ad/birim/fiyat/KDV ürün kartından KOPYALANIR: ürün sonradan
 * yeniden adlandırılsa ya da zamlansa açık adisyon değişmez — masadaki müşteriye
 * söylenen fiyat neyse o kalır.
 *
 * `merge` (varsayılan açık): aynı ürün + aynı not + aynı fiyat zaten varsa yeni
 * satır açmak yerine adedi artırır. "2 çay" sonra "1 çay" → tek satır "3 çay".
 */
export async function POST(request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const companyId = await resolveCompanyId(body.companyId)
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyWrite(companyId))

    const { id } = await params
    const ticket = await prisma.restaurantTicket.findFirst({
      where: { id, companyId },
      include: { items: true },
    })
    if (!ticket) return NextResponse.json({ error: "Adisyon bulunamadı" }, { status: 404 })
    if (ticket.status !== "OPEN") {
      return NextResponse.json({ error: "Kapanmış adisyona kalem eklenemez" }, { status: 409 })
    }

    // Tek kalem ya da dizi — ekran ilk açılışta birden çok kalem gönderebilsin.
    const raw = Array.isArray(body.items) ? body.items : [body]
    if (raw.length === 0) return NextResponse.json({ error: "Kalem yok" }, { status: 400 })

    const merge = body.merge !== false
    const created: string[] = []

    for (const line of raw) {
      const quantity = Number(line?.quantity ?? 1)
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return NextResponse.json({ error: "Adet sıfırdan büyük olmalı" }, { status: 400 })
      }

      const productId = line?.productId ? String(line.productId) : null
      let description = String(line?.description || "").trim()
      let unit = String(line?.unit || "").trim() || "ADET"
      let unitPrice = Number(line?.unitPrice)
      let vatRate = Number(line?.vatRate)

      if (productId) {
        const product = await prisma.product.findFirst({
          where: { id: productId, companyId },
          select: { id: true, name: true, unit: true, salePrice: true, vatRate: true },
        })
        if (!product) return NextResponse.json({ error: "Ürün bulunamadı" }, { status: 404 })
        if (!description) description = product.name
        if (!line?.unit) unit = product.unit
        // `salePrice` NET tutulur (şema: "Fiyatlar DB'de DAİMA net").
        if (!Number.isFinite(unitPrice)) unitPrice = Number(product.salePrice ?? 0)
        if (!Number.isFinite(vatRate)) vatRate = Number(product.vatRate ?? 20)
      }

      if (!description) {
        return NextResponse.json({ error: "Kalem açıklaması zorunlu" }, { status: 400 })
      }
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        return NextResponse.json({ error: "Geçersiz fiyat" }, { status: 400 })
      }
      if (!Number.isFinite(vatRate)) vatRate = 20

      const note = line?.note ? String(line.note).trim() : null

      // Seçenekler (porsiyon/modifier). Fiyat farkını İSTEMCİ DEĞİL sunucu
      // hesaplar — fiyatın ürün kartından kopyalanmasıyla aynı gerekçe: ekrana
      // güvenilirse zamlanmış seçenek eski fiyattan satılabilir.
      let options: TicketItemOption[] = []
      const optionIds: string[] = Array.isArray(line?.optionIds)
        ? line.optionIds.map((v: unknown) => String(v)).filter(Boolean)
        : []
      if (optionIds.length > 0) {
        if (!productId) {
          return NextResponse.json({ error: "Seçenek için ürün gerekli" }, { status: 400 })
        }
        const picked = await prisma.productOption.findMany({
          where: { id: { in: optionIds }, group: { productId, companyId } },
          include: { group: { select: { name: true, order: true } } },
          orderBy: [{ group: { order: "asc" } }, { order: "asc" }],
        })
        if (picked.length !== optionIds.length) {
          return NextResponse.json({ error: "Seçenek bulunamadı" }, { status: 404 })
        }
        options = picked.map((o) => ({
          groupName: o.group.name,
          optionName: o.name,
          priceDelta: Number(o.priceDelta),
          // Reçete etkisi de fiyatla AYNI ANDA kopyalanır: menü sonradan
          // düzenlense (soya sütü başka karta bağlansa, çarpan değişse) açık
          // adisyonun stok karşılığı değişmemeli.
          effect: optionEffect({
            effectMode: o.effectMode,
            fromProductId: o.fromProductId,
            toProductId: o.toProductId,
            effectQuantity: o.effectQuantity != null ? Number(o.effectQuantity) : null,
            effectUnit: o.effectUnit,
          }),
          recipeFactor: o.recipeFactor != null ? Number(o.recipeFactor) : null,
        }))
        // `priceDelta` KDV DAHİL girilir (menü fiyatı gibi); kalem NET tutulur.
        const grossDelta = options.reduce((s, o) => s + o.priceDelta, 0)
        unitPrice = unitPrice + grossDelta / (1 + vatRate / 100)
        if (unitPrice < 0) unitPrice = 0
      }

      unitPrice = round6(unitPrice)

      const optionsKey = options.map((o) => `${o.groupName}:${o.optionName}`).join("|")

      // Birleştirme yalnız GERÇEKTEN aynı kalemde: seçenekleri farklı iki kahve
      // (soya / laktozsuz) fiyatı eşit olsa bile ayrı satırdır — mutfağa ve
      // müşteriye giden bilgi farklı. İkram/zayi işaretli satıra da eklenmez.
      const twins =
        merge && productId
          ? await prisma.restaurantTicketItem.findMany({
              where: {
                ticketId: id,
                productId,
                note: note ?? null,
                unitPrice,
                vatRate,
                status: "NORMAL",
              },
            })
          : []
      const twin =
        twins.find(
          (t) =>
            parseItemOptions(t.options)
              .map((o) => `${o.groupName}:${o.optionName}`)
              .join("|") === optionsKey,
        ) ?? null

      if (twin) {
        await prisma.restaurantTicketItem.update({
          where: { id: twin.id },
          data: { quantity: { increment: quantity } },
        })
        created.push(twin.id)
        continue
      }

      const last = await prisma.restaurantTicketItem.findFirst({
        where: { ticketId: id },
        orderBy: { order: "desc" },
        select: { order: true },
      })

      const item = await prisma.restaurantTicketItem.create({
        data: {
          ticketId: id,
          productId,
          description,
          unit,
          quantity,
          unitPrice,
          vatRate,
          note,
          options: options.length > 0 ? options : undefined,
          order: (last?.order ?? -1) + 1,
          createdBy: user.id,
        },
      })
      created.push(item.id)
    }

    const fresh = await prisma.restaurantTicket.findUnique({
      where: { id },
      include: ticketInclude,
    })
    return NextResponse.json(
      { ...serializeTicket(fresh!), addedItemIds: created },
      { status: 201 },
    )
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error("Error adding ticket item:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
