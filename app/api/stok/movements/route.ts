import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get("companyId")
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
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error fetching stock movements:", error)
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
    const { companyId, productId, type, quantity, unitPrice, description, reference } = body

    if (!companyId || !productId || !type || !quantity) {
      return NextResponse.json(
        { error: "companyId, productId, type, and quantity are required" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)

    const product = await prisma.product.findUnique({
      where: { id: productId },
    })

    if (!product || product.companyId !== companyId) {
      return NextResponse.json(
        { error: "Product not found" },
        { status: 404 }
      )
    }

    // Calculate new stock quantity
    let newQuantity = Number(product.stockQuantity)
    if (type === "IN") {
      newQuantity += parseFloat(quantity)
    } else if (type === "OUT") {
      newQuantity -= parseFloat(quantity)
      if (newQuantity < 0) {
        return NextResponse.json(
          { error: "Yetersiz stok" },
          { status: 400 }
        )
      }
    } else if (type === "ADJUSTMENT") {
      newQuantity = parseFloat(quantity)
    }

    // Create movement
    const movement = await prisma.stockMovement.create({
      data: {
        companyId,
        productId,
        type,
        quantity: parseFloat(quantity),
        unitPrice: unitPrice ? parseFloat(unitPrice) : null,
        description,
        reference,
        createdBy: user.id,
      },
    })

    // Update product stock
    await prisma.product.update({
      where: { id: productId },
      data: {
        stockQuantity: newQuantity,
      },
    })

    return NextResponse.json(movement, { status: 201 })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error creating stock movement:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

