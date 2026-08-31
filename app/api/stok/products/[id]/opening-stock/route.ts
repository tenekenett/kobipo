import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"
import { resolveSlugId } from "@/lib/slug-resolve"
import { parseMovementDate } from "@/lib/stock/movement-date"
import { getOpeningStock, setOpeningStock } from "@/lib/stock/warehouse"

export const dynamic = "force-dynamic"

/**
 * AÇILIŞ (BAŞLANGIÇ) STOĞU.
 *
 * Ayrı bir uç, çünkü açılışı değiştirmek "stok hareketi girmek" DEĞİL: yeni bir
 * hareket yazmaz, ürünün ilk hareketini yerinde düzeltir ve farkı bakiyeye
 * yansıtır. Aynı gövdeyi /api/stok/movements'a taşımak, "hareket ekle" ucunu
 * "hareket düzenle" ucuna çevirirdi. Kural ve gerekçeleri:
 * lib/stock/opening-stock.ts + setOpeningStock.
 */

export const GET = withApiErrors(async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 })
    }
    await ensureCompanyAccess(companyId)

    const { id } = await params
    const productId = await resolveSlugId("product", id, companyId)

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, companyId: true, isService: true, unit: true, stockQuantity: true },
    })
    if (!product || product.companyId !== companyId) {
      return NextResponse.json({ error: "Ürün bulunamadı" }, { status: 404 })
    }

    const opening = await getOpeningStock(prisma, companyId, product.id)
    return NextResponse.json({
      ...opening,
      productId: product.id,
      unit: product.unit,
      stockQuantity: Number(product.stockQuantity),
    })
  } catch (error: any) {
    if (error?.message?.includes("Access denied")) return accessDeniedResponse(error)
    console.error("Error fetching opening stock:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const PUT = withApiErrors(async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const companyId = await resolveCompanyId(body.companyId)
    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 })
    }
    await ensureCompanyWrite(companyId)

    const { id } = await params
    const productId = await resolveSlugId("product", id, companyId)

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { companyId: true, isService: true },
    })
    if (!product || product.companyId !== companyId) {
      return NextResponse.json({ error: "Ürün bulunamadı" }, { status: 404 })
    }
    if (product.isService) {
      return NextResponse.json({ error: "Hizmet kaleminde stok hareketi olmaz" }, { status: 400 })
    }

    const quantity = parseFloat(String(body.quantity))
    if (!Number.isFinite(quantity)) {
      return NextResponse.json({ error: "Açılış stoğu sayı olmalı" }, { status: 400 })
    }

    // Açılış GÜN BAŞINA çapalanır: aynı gün girilmiş satışların önünde dursun.
    const parsedDate = parseMovementDate(body.date, new Date(), { anchor: "dayStart" })
    if (!parsedDate.ok) {
      return NextResponse.json({ error: parsedDate.error }, { status: 400 })
    }

    // Depo sahipliği: id istemciden geliyor, doğrulanmazsa stok başka firmanın
    // deposuna yazılır (aynı gerekçe /api/stok/movements'ta da yazılı).
    let warehouseId: string | null = null
    if (body.warehouseId) {
      const wh = await prisma.warehouse.findFirst({
        where: { id: String(body.warehouseId), companyId },
        select: { id: true },
      })
      if (!wh) return NextResponse.json({ error: "Depo bu firmaya ait değil" }, { status: 400 })
      warehouseId = wh.id
    }

    // Birim maliyet BOŞ bırakılabilir: "" gelirse alan temizlenir (null), hiç
    // gelmezse mevcut maliyet korunur. İkisi aynı sayılsaydı kullanıcı tarihi
    // düzeltirken maliyeti sessizce silerdi.
    let unitPrice: number | null | undefined
    if (body.unitPrice === undefined) unitPrice = undefined
    else if (body.unitPrice === null || body.unitPrice === "") unitPrice = null
    else {
      const parsed = parseFloat(String(body.unitPrice))
      if (!Number.isFinite(parsed) || parsed < 0) {
        return NextResponse.json({ error: "Birim maliyet geçersiz" }, { status: 400 })
      }
      unitPrice = parsed
    }

    // Tek işlem: hareket + depo satırı + kart bakiyesi birlikte değişmeli.
    // Yarıda kalırsa Σ(WarehouseStock) = Product.stockQuantity değişmezi bozulurdu.
    const result = await prisma.$transaction((tx) =>
      setOpeningStock(tx, {
        companyId,
        productId,
        quantity,
        unitPrice,
        warehouseId,
        date: parsedDate.date,
        createdBy: user.id,
      })
    )

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json(result)
  } catch (error: any) {
    if (error?.message?.includes("Access denied")) return accessDeniedResponse(error)
    console.error("Error updating opening stock:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
