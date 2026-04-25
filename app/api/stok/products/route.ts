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
    const search = searchParams.get("search")
    const isService = searchParams.get("isService")

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

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { code: { contains: search, mode: "insensitive" } },
        { barcode: { contains: search, mode: "insensitive" } },
      ]
    }

    if (isService !== null) {
      where.isService = isService === "true"
    }

    const products = await prisma.product.findMany({
      where,
      orderBy: { name: "asc" },
    })

    return NextResponse.json(products)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error fetching products:", error)
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
      code,
      name,
      barcode,
      unit,
      vatRate,
      purchasePrice,
      salePrice,
      stockQuantity,
      minStockLevel,
      isService,
    } = body

    if (!companyId || !name) {
      return NextResponse.json(
        { error: "companyId and name are required" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)

    const product = await prisma.product.create({
      data: {
        companyId,
        code,
        name,
        barcode,
        unit: unit || "ADET",
        vatRate: vatRate ? parseFloat(vatRate) : 20,
        purchasePrice: purchasePrice ? parseFloat(purchasePrice) : null,
        salePrice: salePrice ? parseFloat(salePrice) : null,
        stockQuantity: stockQuantity ? parseFloat(stockQuantity) : 0,
        minStockLevel: minStockLevel ? parseFloat(minStockLevel) : null,
        isService: isService || false,
      },
    })

    return NextResponse.json(product, { status: 201 })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error creating product:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

