import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"
import { adjustWarehouseStock, ensureDefaultWarehouseId } from "@/lib/stock/warehouse"

export const dynamic = 'force-dynamic'


export const GET = withApiErrors(async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    const productId = searchParams.get("productId")

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)

    const where: any = {
      companyId,
    }

    if (productId) {
      where.productId = productId
    }

    const movements = await prisma.stockMovement.findMany({
      where,
      include: {
        product: true,
      },
      orderBy: { createdAt: "desc" },
    })

    return NextResponse.json(movements)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error fetching stock movements:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
})

export const POST = withApiErrors(async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    body.companyId = await resolveCompanyId(body.companyId)
    const { companyId, productId, type, quantity, unitPrice, description, reference, warehouseId } = body

    // Miktar 0 GEÇERLİDİR: ADJUSTMENT'ta "stok sıfır olsun" demenin tek yolu bu.
    // `!quantity` ile elenirken kullanıcı stoğu sıfırlayamıyordu.
    const quantityMissing = quantity === undefined || quantity === null || quantity === ""
    if (!companyId || !productId || !type || quantityMissing) {
      return NextResponse.json(
        { error: "companyId, productId, type, and quantity are required" },
        { status: 400 }
      )
    }

    await ensureCompanyWrite(companyId)

    const product = await prisma.product.findUnique({
      where: { id: productId },
    })

    if (!product || product.companyId !== companyId) {
      return NextResponse.json(
        { error: "Product not found" },
        { status: 404 }
      )
    }

    if (product.isService) {
      return NextResponse.json(
        { error: "Hizmet kaleminde stok hareketi olmaz" },
        { status: 400 }
      )
    }

    const raw = parseFloat(quantity)
    if (!Number.isFinite(raw)) {
      return NextResponse.json({ error: "Miktar sayı olmalı" }, { status: 400 })
    }

    // Hareketin İŞARETLİ değişimi. ADJUSTMENT'ta gövdedeki miktar HEDEF bakiyedir
    // (ekran "stok kaç olsun" diye sorar), deftere yazılan ise FARK olmalı: mutlak
    // değeri hareket olarak yazmak defteri kartla ayrıştırıyordu — hedef 1.097 girilen
    // bir üründe hareket toplamı milyonlara çıkıp raporları anlamsızlaştırdı.
    const current = Number(product.stockQuantity)
    let delta: number
    if (type === "IN") {
      delta = Math.abs(raw)
    } else if (type === "OUT") {
      delta = -Math.abs(raw)
      if (current + delta < 0) {
        return NextResponse.json({ error: "Yetersiz stok" }, { status: 400 })
      }
    } else if (type === "ADJUSTMENT") {
      if (raw < 0) {
        return NextResponse.json({ error: "Hedef stok negatif olamaz" }, { status: 400 })
      }
      delta = Math.round((raw - current) * 10000) / 10000
    } else {
      return NextResponse.json(
        { error: "Geçersiz hareket tipi (IN | OUT | ADJUSTMENT)" },
        { status: 400 }
      )
    }

    if (delta === 0) {
      return NextResponse.json({ ok: true, stockQuantity: current, unchanged: true })
    }

    // Depo verilmişse SAHİPLİĞİ doğrulanır: id istemciden geliyor ve firma değiştiren
    // bir ekranda eski firmanın deposu state'te kalabiliyor — doğrulamazsak stok
    // başka firmanın deposuna yazılır (canlıda böyle satırlar oluştu).
    let targetWarehouseId: string
    if (warehouseId) {
      const wh = await prisma.warehouse.findFirst({
        where: { id: String(warehouseId), companyId },
        select: { id: true },
      })
      if (!wh) {
        return NextResponse.json({ error: "Depo bu firmaya ait değil" }, { status: 400 })
      }
      targetWarehouseId = wh.id
    } else {
      const existing = await prisma.warehouseStock.findFirst({
        where: { productId, warehouse: { companyId } },
        orderBy: { quantity: "desc" },
        select: { warehouseId: true },
      })
      targetWarehouseId = existing?.warehouseId ?? (await ensureDefaultWarehouseId(prisma, companyId))
    }

    // Tek kapı: kart + depo bakiyesi + hareket birlikte yazılır. Eskiden bu uç
    // hareketi ve kartı elle yazıp WarehouseStock'a hiç dokunmuyordu; depo dökümü
    // kartla ayrışıyordu.
    await adjustWarehouseStock(prisma, {
      companyId,
      productId,
      warehouseId: targetWarehouseId,
      delta,
      type,
      unitPrice: unitPrice ? parseFloat(unitPrice) : null,
      description,
      reference,
      createdBy: user.id,
    })

    return NextResponse.json(
      { ok: true, stockQuantity: Math.round((current + delta) * 10000) / 10000, delta },
      { status: 201 }
    )
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error creating stock movement:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
})

