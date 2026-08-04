import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { assertRestaurantModule, TICKET_ITEM_REASONS } from "@/lib/restoran/tickets"
import { writeCompWasteStock, type CompWasteLine } from "@/lib/restoran/comp-waste-stock"
import { parseRecipeEffects } from "@/lib/stock/recipe-expand"

export const dynamic = "force-dynamic"

/**
 * TEZGÂH ikramı/zayisi — Kahveci Satış ekranının karşılığı.
 *
 * Masada bu iş adisyon kalemine `COMP`/`WASTE` yazılarak yapılıyor ve kapanışta
 * `writeCompWasteStock` çalışıyor. Tezgâhta ADİSYON YOK: sepet yalnız tarayıcıda
 * yaşıyor, kasiyerin elinde "personel kahvesi" için hiçbir yol yoktu — ürün ya
 * hiç girilmiyordu (malzeme stokta duruyor, maliyet raporu yalan söylüyor) ya da
 * tam fiyattan satılmış görünüyordu. Bu uç o boşluğu kapatıyor.
 *
 * `invoiceId` verilirse referans FİŞİN id'si olur: fiş iptal edildiğinde
 * `revertStockByReference` ikram malzemesini de kendiliğinden geri alır (adisyon
 * kapanışındaki kuralın aynısı). Sepetin tamamı ikramsa fiş kesilmez; o zaman
 * referans kendi üretilen koddur ve geri alma yolu yoktur — zaten bir belge de
 * yoktur.
 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const companyId = await resolveCompanyId(body.companyId)
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyWrite(companyId))

    const rawLines = Array.isArray(body.lines) ? body.lines : []
    const lines: CompWasteLine[] = []
    for (const raw of rawLines) {
      const status = String(raw?.status || "").toUpperCase()
      if (status !== "COMP" && status !== "WASTE") {
        return NextResponse.json({ error: "Kalem ikram ya da zayi olmalı" }, { status: 400 })
      }
      const productId = raw?.productId ? String(raw.productId) : null
      if (!productId) {
        return NextResponse.json({ error: "Ürünsüz kalem stoktan düşülemez" }, { status: 400 })
      }
      const quantity = Number(raw?.quantity)
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return NextResponse.json({ error: "Adet sıfırdan büyük olmalı" }, { status: 400 })
      }
      // Sebep ZORUNLU ve listeden: kalem ⋮ menüsündeki kuralın aynısı, aksi
      // halde denetim raporu gruplanamaz.
      const reasonCode = String(raw?.reasonCode || "").trim()
      if (!TICKET_ITEM_REASONS[status].some((r) => r.code === reasonCode)) {
        return NextResponse.json({ error: "Sebep seçilmeli" }, { status: 400 })
      }
      lines.push({
        productId,
        quantity,
        status,
        reasonCode,
        description: String(raw?.description || "").slice(0, 255) || "Ürün",
        // İstemciden gelen etki güvenli okuyucudan geçirilir (fiş ucundaki
        // `recipeEffects` ile aynı kural).
        effects: parseRecipeEffects(Array.isArray(raw?.effects) ? raw.effects : []),
        recipeFactor: Number.isFinite(Number(raw?.recipeFactor)) ? Number(raw.recipeFactor) : 1,
      })
    }
    if (lines.length === 0) {
      return NextResponse.json({ error: "Kalem yok" }, { status: 400 })
    }

    // Ürünlerin firmaya ait olduğu doğrulanır — tenant sızıntısı önlemi
    // (reçete ucundaki kuralın aynısı).
    const productIds = [...new Set(lines.map((l) => l.productId as string))]
    const owned = await prisma.product.count({
      where: { id: { in: productIds }, companyId },
    })
    if (owned !== productIds.length) {
      return NextResponse.json({ error: "Ürün bulunamadı" }, { status: 404 })
    }

    let reference = ""
    let label = ""
    const invoiceId = body.invoiceId ? String(body.invoiceId) : null
    if (invoiceId) {
      const invoice = await prisma.invoice.findFirst({
        where: { id: invoiceId, companyId },
        select: { id: true, invoiceNo: true },
      })
      if (!invoice) return NextResponse.json({ error: "Fiş bulunamadı" }, { status: 404 })
      reference = invoice.id
      label = invoice.invoiceNo || "Fiş"
    } else {
      reference = `IKR-${Date.now().toString(36).toUpperCase()}`
      label = reference
    }

    const result = await writeCompWasteStock({
      companyId,
      lines,
      ticketCode: label,
      reference,
      warehouseId: body.warehouseId ? String(body.warehouseId) : null,
      createdBy: user.id,
    })

    if (result.failed) {
      return NextResponse.json({ error: "Stok düzeltmesi yazılamadı" }, { status: 500 })
    }

    return NextResponse.json({ success: true, reference, written: result.written })
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error("Error writing comp/waste:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
