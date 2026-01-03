import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get("companyId")

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

    await ensureCompanyAccess(companyId)

    // Transfer işlemi: Çıkış ve giriş kayıtları oluştur
    const transferDate = date ? new Date(date) : new Date()

    // Çıkış kaydı
    await prisma.stockMovement.create({
      data: {
        companyId,
        warehouseId: fromWarehouseId,
        productId,
        type: "TRANSFER",
        quantity: -parseFloat(quantity), // Negatif: çıkış
        description: notes || `Depo transfer - ${fromWarehouseId} -> ${toWarehouseId}`,
        createdBy: user.id,
      },
    })

    // Giriş kaydı
    await prisma.stockMovement.create({
      data: {
        companyId,
        warehouseId: toWarehouseId,
        productId,
        type: "TRANSFER",
        quantity: parseFloat(quantity), // Pozitif: giriş
        description: notes || `Depo transfer - ${fromWarehouseId} -> ${toWarehouseId}`,
        createdBy: user.id,
      },
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

