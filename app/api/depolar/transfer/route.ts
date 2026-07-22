import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { transferWarehouseStock } from "@/lib/stock/warehouse"

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
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
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error fetching transfers:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
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
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error creating transfer:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

