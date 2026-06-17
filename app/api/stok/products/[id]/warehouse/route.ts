import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { transferWarehouseStock } from "@/lib/stock/warehouse"

export const dynamic = "force-dynamic"

// Ürünün tüm stoğunu seçilen depoya taşır/konsolide eder (toplam stok değişmez).
// Düzenle ekranından "depo değiştir" için kullanılır.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const body = await request.json()
  const targetWarehouseId: string = body.warehouseId

  const product = await prisma.product.findUnique({ where: { id }, select: { id: true, companyId: true, isService: true } })
  if (!product) return NextResponse.json({ error: "Ürün bulunamadı" }, { status: 404 })
  await ensureCompanyAccess(product.companyId)

  if (product.isService) {
    return NextResponse.json({ error: "Hizmet kartında depo değiştirilemez" }, { status: 400 })
  }
  const target = await prisma.warehouse.findFirst({
    where: { id: targetWarehouseId, companyId: product.companyId },
    select: { id: true },
  })
  if (!target) return NextResponse.json({ error: "Hedef depo bulunamadı" }, { status: 404 })

  await prisma.$transaction(async (tx) => {
    const rows = await tx.warehouseStock.findMany({
      where: { productId: id, warehouse: { companyId: product.companyId } },
      select: { warehouseId: true, quantity: true },
    })

    // Diğer depolardaki stoğu hedefe taşı.
    for (const row of rows) {
      if (row.warehouseId === targetWarehouseId) continue
      const qty = Number(row.quantity)
      if (qty !== 0) {
        await transferWarehouseStock(tx, {
          companyId: product.companyId,
          productId: id,
          fromWarehouseId: row.warehouseId,
          toWarehouseId: targetWarehouseId,
          quantity: qty,
          description: "Depo değişikliği",
          createdBy: user.id,
        })
      }
    }

    // Hedef depoda kayıt olsun (boş bile olsa).
    await tx.warehouseStock.upsert({
      where: { warehouseId_productId: { warehouseId: targetWarehouseId, productId: id } },
      create: { warehouseId: targetWarehouseId, productId: id, quantity: 0 },
      update: {},
    })

    // Hedef dışındaki boşalmış (0) kayıtları temizle — ürün tek depoda görünsün.
    await tx.warehouseStock.deleteMany({
      where: { productId: id, quantity: 0, warehouseId: { not: targetWarehouseId } },
    })
  })

  return NextResponse.json({ success: true })
}
