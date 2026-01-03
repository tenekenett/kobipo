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
          take: 20,
        },
      },
    })

    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 })
    }

    await ensureCompanyAccess(product.companyId)

    return NextResponse.json(product)
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

