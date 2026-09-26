import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { resolveAllUnitCosts } from "@/lib/stock/cost"
import { movementTypeLabel, signedMovementQuantity } from "@/lib/stock/movement-sign"

export const dynamic = 'force-dynamic'

/**
 * Depo detayı: kart + bu depodaki ürün bakiyeleri (birim maliyet ve değerle) +
 * bu depoya yazılmış son hareketler. Tek istek, çünkü ekran üçünü birlikte basar.
 *
 * Maliyet firma geneli ağırlıklı ortalamadır (lib/stock/cost.ts) — depo bazlı
 * maliyet tutulmuyor; aynı ürün iki depoda aynı birim maliyetle değerlenir.
 * Hareket işareti tek kaynaktan: signedMovementQuantity (+ giriş, − çıkış).
 */
const MOVEMENT_LIMIT = 200

export const GET = withApiErrors(async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: resolvedParams.id },
      select: {
        id: true,
        companyId: true,
        code: true,
        name: true,
        address: true,
        city: true,
        isDefault: true,
        isActive: true,
        createdAt: true,
      },
    })

    if (!warehouse) {
      return NextResponse.json({ error: "Depo bulunamadı" }, { status: 404 })
    }

    await ensureCompanyAccess(warehouse.companyId)

    // Seçili firma verildiyse depo o firmanın olmalı: erişimi olan kullanıcı başka
    // firmanın deposunu seçili firmanın ekranında görmesin (bkz. CLAUDE.md ?company=).
    const requested = new URL(request.url).searchParams.get("companyId")
    if (requested && (await resolveCompanyId(requested)) !== warehouse.companyId) {
      return NextResponse.json({ error: "Depo bulunamadı" }, { status: 404 })
    }

    const [stockRows, movementRows, movementCount, unitCosts] = await Promise.all([
      prisma.warehouseStock.findMany({
        where: { warehouseId: warehouse.id },
        include: {
          product: {
            select: { id: true, slug: true, code: true, name: true, unit: true, category: true, isActive: true },
          },
        },
      }),
      prisma.stockMovement.findMany({
        where: { warehouseId: warehouse.id },
        orderBy: { createdAt: "desc" },
        take: MOVEMENT_LIMIT,
        select: {
          id: true,
          type: true,
          quantity: true,
          reason: true,
          description: true,
          createdAt: true,
          product: { select: { id: true, slug: true, name: true, code: true, unit: true } },
        },
      }),
      prisma.stockMovement.count({ where: { warehouseId: warehouse.id } }),
      resolveAllUnitCosts(warehouse.companyId),
    ])

    const stocks = stockRows
      .map((r) => {
        const quantity = Number(r.quantity)
        const unitCost = unitCosts.get(r.productId) ?? null
        return {
          productId: r.productId,
          slug: r.product.slug || null,
          code: r.product.code,
          name: r.product.name,
          unit: r.product.unit,
          category: r.product.category,
          isActive: r.product.isActive,
          quantity,
          unitCost,
          value: unitCost != null ? Math.round(quantity * unitCost * 100) / 100 : null,
        }
      })
      .sort((a, b) => a.name.localeCompare(b.name, "tr"))

    const nonZero = stocks.filter((s) => s.quantity !== 0)
    const totals = {
      productCount: nonZero.length,
      negativeCount: nonZero.filter((s) => s.quantity < 0).length,
      // Değer yalnız POZİTİF bakiyeden ve maliyeti bilinen üründen kurulur; eksi
      // bakiye "stokta değer" değildir, maliyetsiz ürün de tahmin edilmez.
      stockValue:
        Math.round(nonZero.reduce((sum, s) => sum + (s.quantity > 0 && s.value != null ? s.value : 0), 0) * 100) / 100,
      unvaluedCount: nonZero.filter((s) => s.quantity > 0 && s.unitCost == null).length,
    }

    const movements = movementRows.map((m) => ({
      id: m.id,
      date: m.createdAt.toISOString(),
      type: m.type,
      reason: m.reason,
      label: movementTypeLabel(m),
      quantity: signedMovementQuantity(m),
      description: m.description,
      product: { ...m.product, slug: m.product.slug || null },
    }))

    const { companyId: _companyId, ...card } = warehouse
    return NextResponse.json({
      warehouse: card,
      stocks,
      totals,
      movements,
      movementCount,
      movementsTruncated: movementCount > movements.length,
    })
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error fetching warehouse:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const PUT = withApiErrors(async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: resolvedParams.id },
    })

    if (!warehouse) {
      return NextResponse.json(
        { error: "Warehouse not found" },
        { status: 404 }
      )
    }

    await ensureCompanyWrite(warehouse.companyId)

    const body = await request.json()
    const { code, name, address, city, isActive } = body

    const updated = await prisma.warehouse.update({
      where: { id: resolvedParams.id },
      data: {
        code: code !== undefined ? code : warehouse.code,
        name: name !== undefined ? name : warehouse.name,
        address: address !== undefined ? address : warehouse.address,
        city: city !== undefined ? city : warehouse.city,
        isActive: isActive !== undefined ? isActive : warehouse.isActive,
      },
    })

    return NextResponse.json(updated)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error updating warehouse:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
})

export const DELETE = withApiErrors(async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: resolvedParams.id },
    })

    if (!warehouse) {
      return NextResponse.json(
        { error: "Warehouse not found" },
        { status: 404 }
      )
    }

    await ensureCompanyWrite(warehouse.companyId)

    // Depoyu pasif yap (silme)
    await prisma.warehouse.update({
      where: { id: resolvedParams.id },
      data: { isActive: false },
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error deleting warehouse:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
})

