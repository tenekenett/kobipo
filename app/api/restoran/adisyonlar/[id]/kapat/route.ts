import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { assertRestaurantModule, serializeTicket, ticketInclude } from "@/lib/restoran/tickets"
import { writeCompWasteStock } from "@/lib/restoran/comp-waste-stock"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

/**
 * Adisyon kapanışı — İKİ ADIMLI ve bilinçli olarak öyle:
 *
 *   GET  .../kapat  → fiş gövdesini hazır döndürür (kalem eşlemesi tek yerde)
 *   POST .../kapat  → { invoiceId } ile adisyonu fişe bağlar ve KAPATIR
 *
 * Fişi bu uç KENDİSİ oluşturmuyor çünkü fiş yolu (`/api/e-donusum/invoices`)
 * stok düşümü, reçete genişletme, cari ve muhasebe fişini birlikte yürüten
 * kanıtlanmış tek yol. İkinci bir satış yolu açmak, v1'de doğrulanmış her şeyi
 * ikinci kez yazmak demekti.
 *
 * Çift kapanış koruması `updateMany(status: "OPEN")` ile SUNUCUDA: iki kasiyer
 * aynı anda kapatırsa ikincisi 0 satır günceller ve 409 alır. `invoiceId` tekil
 * olduğu için tek fiş iki adisyona da bağlanamaz.
 */
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
    if (ticket.status !== "OPEN") {
      return NextResponse.json({ error: "Adisyon zaten kapalı" }, { status: 409 })
    }
    if (ticket.items.length === 0) {
      return NextResponse.json({ error: "Boş adisyon kapatılamaz" }, { status: 400 })
    }

    const view = serializeTicket(ticket)
    // Fişe yalnız ÖDENEN kalemler girer: ikram 0 TL'lik satır olarak yazılsaydı
    // KDV matrahını ve menü performansı raporunu kirletirdi; zayi/iptal zaten
    // müşterinin hesabı değil. İkram/zayi malzemesi kapanışta AYRI yoldan
    // düşülür (lib/restoran/comp-waste-stock.ts).
    const billable = view.items.filter((item) => item.status === "NORMAL")
    if (billable.length === 0) {
      return NextResponse.json(
        { error: "Hesapta ödenecek kalem yok (tümü ikram/zayi/iptal)" },
        { status: 400 },
      )
    }

    // Fişin notu adisyonu İŞARET EDER: kapanış yarıda kalıp fiş sahipsiz kalırsa
    // (istemci çöktü, ağ gitti) hangi masaya ait olduğu fişten okunabilsin.
    const stamp = [view.code, view.tableName ? `Masa ${view.tableName}` : null]
      .filter(Boolean)
      .join(" · ")

    return NextResponse.json({
      ticket: view,
      invoicePayload: {
        companyId,
        type: "SALES",
        invoiceType: "MANUAL",
        isReceipt: true,
        customerId: view.customerId || null,
        date: new Date().toISOString(),
        currency: "TRY",
        notes: view.note ? `${stamp} — ${view.note}` : stamp,
        sendInvoice: false,
        // Hesap iskontosu fatura ALTI (genel) iskonto olarak gider ve NET
        // beklenir; `ticketTotals` brüt iskontonun matrah karşılığını veriyor.
        globalDiscountAmount: view.totals.netDiscount > 0 ? view.totals.netDiscount : undefined,
        items: billable.map((item) => ({
          productId: item.productId,
          // Seçenekler ve not kalem adına yazılır: fişte "Latte (Büyük · Soya sütü)"
          // görünmezse müşteri ne için para verdiğini okuyamaz.
          description: [
            item.description,
            [item.options.map((o) => o.optionName).join(" · "), item.note]
              .filter(Boolean)
              .join(" · "),
          ]
            .filter(Boolean)
            .join(" — ")
            .slice(0, 500),
          unit: item.unit,
          quantity: item.quantity,
          // NET fiyat — fatura ucu net bekliyor (kahveci ekranıyla aynı kural).
          unitPrice: item.unitPrice,
          vatRate: item.vatRate,
        })),
      },
    })
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error("Error preparing ticket close:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const companyId = await resolveCompanyId(body.companyId)
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyWrite(companyId))

    const { id } = await params
    const invoiceId = String(body.invoiceId || "").trim()
    if (!invoiceId) return NextResponse.json({ error: "invoiceId is required" }, { status: 400 })

    const ticket = await prisma.restaurantTicket.findFirst({ where: { id, companyId } })
    if (!ticket) return NextResponse.json({ error: "Adisyon bulunamadı" }, { status: 404 })
    if (ticket.status !== "OPEN") {
      return NextResponse.json(
        { error: "Adisyon zaten kapalı", status: ticket.status },
        { status: 409 },
      )
    }

    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, companyId },
      select: { id: true, invoiceNo: true, isReceipt: true, type: true },
    })
    if (!invoice) return NextResponse.json({ error: "Fiş bulunamadı" }, { status: 404 })
    if (!invoice.isReceipt || invoice.type !== "SALES") {
      return NextResponse.json(
        { error: "Adisyon yalnızca satış fişine bağlanabilir" },
        { status: 400 },
      )
    }

    const taken = await prisma.restaurantTicket.findFirst({
      where: { invoiceId, id: { not: id } },
      select: { code: true },
    })
    if (taken) {
      return NextResponse.json(
        { error: `Bu fiş başka bir adisyona bağlı (${taken.code})` },
        { status: 409 },
      )
    }

    // Yarış koşulu kapısı: yalnız HÂLÂ açık olan adisyon kapanır.
    const result = await prisma.restaurantTicket.updateMany({
      where: { id, companyId, status: "OPEN" },
      data: { status: "CLOSED", invoiceId, closedAt: new Date(), closedBy: user.id },
    })
    if (result.count === 0) {
      return NextResponse.json({ error: "Adisyon zaten kapatılmış" }, { status: 409 })
    }

    const fresh = await prisma.restaurantTicket.findUnique({ where: { id }, include: ticketInclude })

    // İkram/zayi malzemesi BURADA düşer: fiş kesildi, adisyon kapandı, artık
    // "bu adisyonda gerçekten neler harcandı" kesinleşti. Fişin id'siyle
    // yazılıyor ki fiş iptalinde kendiliğinden geri dönsün.
    await writeCompWasteStock({
      companyId,
      ticketCode: ticket.code,
      reference: invoiceId,
      warehouseId: body.warehouseId ? String(body.warehouseId) : null,
      createdBy: user.id,
      lines: (fresh?.items ?? []).map((item) => ({
        productId: item.productId,
        quantity: Number(item.quantity),
        status: item.status,
        reasonCode: item.reasonCode,
        description: item.description,
      })),
    })

    return NextResponse.json(serializeTicket(fresh!))
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    if (error?.code === "P2002") {
      return NextResponse.json({ error: "Bu fiş başka bir adisyona bağlı" }, { status: 409 })
    }
    console.error("Error closing ticket:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
