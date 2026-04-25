import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"


export const dynamic = 'force-dynamic'
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    const product = await prisma.product.findUnique({
      where: { id: resolvedParams.id },
      include: {
        stockMovements: {
          orderBy: { createdAt: "desc" },
          take: 50,
        },
      },
    })

    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 })
    }

    await ensureCompanyAccess(product.companyId)

    // Calculate totals
    const totalIn = product.stockMovements
      .filter(m => m.type === "IN" || (m.type === "TRANSFER" && Number(m.quantity) > 0))
      .reduce((sum, m) => sum + Number(m.quantity), 0)
    
    const totalOut = product.stockMovements
      .filter(m => m.type === "OUT" || (m.type === "TRANSFER" && Number(m.quantity) < 0))
      .reduce((sum, m) => sum + Math.abs(Number(m.quantity)), 0)

    // Calculate balance after each movement
    let runningBalance = Number(product.stockQuantity)
    const movements = product.stockMovements.map((movement, index) => {
      const qty = Number(movement.quantity)
      if (movement.type === "IN" || (movement.type === "TRANSFER" && qty > 0)) {
        runningBalance -= qty // Reverse calculation
      } else {
        runningBalance += Math.abs(qty)
      }
      return {
        id: movement.id,
        date: movement.createdAt.toISOString(),
        type: movement.type,
        quantity: Math.abs(qty),
        unitPrice: Number(movement.unitPrice || 0),
        totalAmount: Math.abs(qty) * Number(movement.unitPrice || 0),
        description: movement.description || "",
        referenceNo: movement.reference || undefined,
        balanceAfter: runningBalance,
      }
    }).reverse() // Reverse to show oldest first

    return NextResponse.json({
      ...product,
      totalIn,
      totalOut,
      movements,
    })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error fetching product:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    const product = await prisma.product.findUnique({
      where: { id: resolvedParams.id },
    })

    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 })
    }

    await ensureCompanyAccess(product.companyId)

    const body = await request.json()
    const {
      code,
      name,
      barcode,
      unit,
      vatRate,
      purchasePrice,
      salePrice,
      minStockLevel,
      isService,
      isActive,
    } = body

    const updated = await prisma.product.update({
      where: { id: resolvedParams.id },
      data: {
        code,
        name,
        barcode,
        unit,
        vatRate: vatRate ? parseFloat(vatRate) : product.vatRate,
        purchasePrice: purchasePrice ? parseFloat(purchasePrice) : null,
        salePrice: salePrice ? parseFloat(salePrice) : null,
        minStockLevel: minStockLevel ? parseFloat(minStockLevel) : null,
        isService: isService !== undefined ? isService : product.isService,
        isActive: isActive !== undefined ? isActive : product.isActive,
      },
    })

    return NextResponse.json(updated)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error updating product:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    const product = await prisma.product.findUnique({
      where: { id: resolvedParams.id },
    })

    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 })
    }

    await ensureCompanyAccess(product.companyId)

    await prisma.product.delete({
      where: { id: resolvedParams.id },
    })

    return NextResponse.json({ message: "Product deleted" })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error deleting product:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

