import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { ensureDefaultWarehouseId, transferWarehouseStock } from "@/lib/stock/warehouse"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"
import { assertOwnedByCompany } from "@/lib/company/owned"

export const dynamic = 'force-dynamic'

export const GET = withApiErrors(async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)

    // Depo transfer işlemleri için StockMovement kullanılabilir
    // Transfer tipi için type = "TRANSFER" kullanılabilir
    const transfers = await prisma.stockMovement.findMany({
      where: {
        companyId,
        type: "TRANSFER",
      },
      include: {
        product: true,
        warehouse: true,
      },
      orderBy: { createdAt: "desc" },
    })

    return NextResponse.json(transfers)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error fetching transfers:", error)
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
    const {
      companyId,
      fromWarehouseId,
      toWarehouseId,
      productId,
      quantity,
      date,
      notes,
    } = body

    if (!companyId || !fromWarehouseId || !toWarehouseId || !productId || !quantity) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }
    if (fromWarehouseId === toWarehouseId) {
      return NextResponse.json({ error: "Kaynak ve hedef depo aynı olamaz" }, { status: 400 })
    }
    const qty = parseFloat(quantity)
    if (!Number.isFinite(qty) || qty <= 0) {
      return NextResponse.json({ error: "Geçerli bir miktar girin" }, { status: 400 })
    }

    await ensureCompanyWrite(companyId)

    // Sahiplik: ürün ve iki depo bu firmanın olmalı. `transferWarehouseStock` da
    // kendi içinde kontrol eder (ikinci duvar); burada hata mesajı ve hizmet/ bakiye
    // kararı için ürün ayrıca okunur.
    await assertOwnedByCompany(companyId, {
      product: productId,
      warehouse: [fromWarehouseId, toWarehouseId],
    })
    const product = await prisma.product.findUnique({
      where: { id: String(productId) },
      select: { isService: true, stockQuantity: true },
    })
    if (!product) return NextResponse.json({ error: "Ürün bulunamadı" }, { status: 404 })
    if (product.isService) {
      return NextResponse.json({ error: "Hizmet kaleminde depo transferi olmaz" }, { status: 400 })
    }

    // Kaynak depoda yeterli bakiye var mı? (stok/movements ucuyla aynı kural — çıkış
    // bakiyeyi eksiye düşüremez; transfer de kaynak için bir çıkıştır.) Hiç depo
    // satırı olmayan eski ürünün bakiyesi kartta durur ve ilk işlemde varsayılan
    // depoya materyalize edilir; o hâlde varsayılan depo için kart bakiyesi geçerli.
    const sourceRow = await prisma.warehouseStock.findUnique({
      where: { warehouseId_productId: { warehouseId: String(fromWarehouseId), productId: String(productId) } },
      select: { quantity: true },
    })
    let available = Number(sourceRow?.quantity ?? 0)
    if (!sourceRow) {
      const anyRow = await prisma.warehouseStock.findFirst({
        where: { productId: String(productId), warehouse: { companyId } },
        select: { id: true },
      })
      if (!anyRow && (await ensureDefaultWarehouseId(prisma, companyId)) === String(fromWarehouseId)) {
        available = Number(product.stockQuantity)
      }
    }
    if (available + 1e-9 < qty) {
      return NextResponse.json(
        { error: `Kaynak depoda yeterli stok yok (mevcut: ${available}, istenen: ${qty})` },
        { status: 400 },
      )
    }

    // Gerçek transfer: kaynak depo stoğunu düşür, hedef depo stoğunu artır
    // (toplam stok değişmez); her iki tarafa TRANSFER hareketi yazılır.
    await prisma.$transaction(async (tx) => {
      await transferWarehouseStock(tx, {
        companyId,
        productId,
        fromWarehouseId,
        toWarehouseId,
        quantity: qty,
        description: notes || "Depo transferi",
        createdBy: user.id,
      })
    })

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error creating transfer:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
})

