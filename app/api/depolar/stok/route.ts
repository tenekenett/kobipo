import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { ensureDefaultWarehouseId } from "@/lib/stock/warehouse"

export const dynamic = "force-dynamic"

// Depo bazlı stok. Filtreler: warehouseId, productId (opsiyonel).
// Döner: { warehouses: [{...özet}], stocks: [{...satır}] }
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get("companyId")
    const warehouseId = searchParams.get("warehouseId")
    const productId = searchParams.get("productId")
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    await ensureCompanyAccess(companyId)

    // Tembel materyalizasyon (bir kerelik, idempotent): depoya hiç atanmamış ama
    // global stoğu olan ürünleri varsayılan depoya yaz. Böylece depo bazlı görünüm
    // ve filtre eski verilerle de tutarlı olur ("—" yerine "Ana Depo" görünür).
    const productsWithStock = await prisma.product.findMany({
      where: { companyId, isService: false, stockQuantity: { not: 0 } },
      select: { id: true, stockQuantity: true },
    })
    if (productsWithStock.length > 0) {
      const ids = productsWithStock.map((p) => p.id)
      const existing = await prisma.warehouseStock.findMany({
        where: { productId: { in: ids } },
        select: { productId: true },
      })
      const has = new Set(existing.map((e) => e.productId))
      const missing = productsWithStock.filter((p) => !has.has(p.id))
      if (missing.length > 0) {
        const defId = await ensureDefaultWarehouseId(prisma, companyId)
        await prisma.warehouseStock.createMany({
          data: missing.map((p) => ({ warehouseId: defId, productId: p.id, quantity: p.stockQuantity })),
          skipDuplicates: true,
        })
      }
    }

    const [warehouses, rows] = await Promise.all([
      prisma.warehouse.findMany({
        where: { companyId, isActive: true },
        orderBy: [{ isDefault: "desc" }, { name: "asc" }],
        select: { id: true, name: true, code: true, isDefault: true },
      }),
      prisma.warehouseStock.findMany({
        where: {
          warehouse: { companyId },
          ...(warehouseId ? { warehouseId } : {}),
          ...(productId ? { productId } : {}),
        },
        include: {
          product: { select: { id: true, name: true, code: true, unit: true } },
          warehouse: { select: { id: true, name: true } },
        },
      }),
    ])

    const stocks = rows.map((r) => ({
      warehouseId: r.warehouseId,
      warehouseName: r.warehouse.name,
      productId: r.productId,
      productName: r.product.name,
      productCode: r.product.code,
      unit: r.product.unit,
      quantity: Number(r.quantity),
    }))

    // Depo başına özet (yalnızca stok satırı olanlardan).
    const summaryMap = new Map<string, { productCount: number; totalQuantity: number }>()
    for (const s of stocks) {
      const acc = summaryMap.get(s.warehouseId) || { productCount: 0, totalQuantity: 0 }
      if (s.quantity !== 0) acc.productCount += 1
      acc.totalQuantity += s.quantity
      summaryMap.set(s.warehouseId, acc)
    }

    const warehousesWithSummary = warehouses.map((w) => ({
      ...w,
      productCount: summaryMap.get(w.id)?.productCount ?? 0,
      totalQuantity: summaryMap.get(w.id)?.totalQuantity ?? 0,
    }))

    return NextResponse.json({ warehouses: warehousesWithSummary, stocks })
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error fetching warehouse stock:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
