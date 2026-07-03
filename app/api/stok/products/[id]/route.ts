import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { resolveSlugId } from "@/lib/slug-resolve"


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
    resolvedParams.id = await resolveSlugId("product", resolvedParams.id, await resolveCompanyId(new URL(request.url).searchParams.get("companyId")))
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

    // Eski kayıtlarda unitPrice null olabilir; bu durumda hareket tipine göre
    // ürünün alış/satış fiyatını fallback olarak kullan, böylece tablo 0 göstermez.
    const purchasePrice = Number(product.purchasePrice || 0)
    const salePrice = Number(product.salePrice || 0)
    const inboundTypes = ["IN", "PURCHASE", "SALE_CANCEL", "RETURN"]

    // Calculate balance after each movement
    let runningBalance = Number(product.stockQuantity)
    const movements = product.stockMovements.map((movement, index) => {
      const qty = Number(movement.quantity)
      if (movement.type === "IN" || (movement.type === "TRANSFER" && qty > 0)) {
        runningBalance -= qty // Reverse calculation
      } else {
        runningBalance += Math.abs(qty)
      }

      const isInbound = inboundTypes.includes(movement.type) || qty > 0
      const unitPrice =
        movement.unitPrice != null
          ? Number(movement.unitPrice)
          : isInbound
            ? purchasePrice
            : salePrice

      return {
        id: movement.id,
        date: movement.createdAt.toISOString(),
        type: movement.type,
        quantity: Math.abs(qty),
        unitPrice,
        totalAmount: Math.abs(qty) * unitPrice,
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
    resolvedParams.id = await resolveSlugId("product", resolvedParams.id, await resolveCompanyId(new URL(request.url).searchParams.get("companyId")))
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
      category,
      unit,
      vatRate,
      purchasePrice,
      salePrice,
      salePriceVatIncluded,
      purchasePriceVatIncluded,
      minStockLevel,
      isService,
      isActive,
    } = body

    // KDV dahil girilen fiyatları net'e çevir (DB net saklar).
    const vatForCalc = vatRate ? parseFloat(vatRate) : Number(product.vatRate)
    const toNetPrice = (raw: unknown, included: boolean): number | null => {
      if (raw == null || raw === "") return null
      const v = parseFloat(String(raw))
      if (Number.isNaN(v)) return null
      return included && vatForCalc > 0 ? v / (1 + vatForCalc / 100) : v
    }

    const updated = await prisma.product.update({
      where: { id: resolvedParams.id },
      data: {
        code,
        name,
        barcode,
        category:
          category !== undefined
            ? (String(category).trim() ? String(category).trim() : null)
            : product.category,
        unit,
        vatRate: vatForCalc,
        purchasePrice: toNetPrice(purchasePrice, Boolean(purchasePriceVatIncluded)),
        salePrice: toNetPrice(salePrice, Boolean(salePriceVatIncluded)),
        salePriceVatIncluded:
          salePriceVatIncluded !== undefined
            ? Boolean(salePriceVatIncluded)
            : product.salePriceVatIncluded,
        purchasePriceVatIncluded:
          purchasePriceVatIncluded !== undefined
            ? Boolean(purchasePriceVatIncluded)
            : product.purchasePriceVatIncluded,
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
    resolvedParams.id = await resolveSlugId("product", resolvedParams.id, await resolveCompanyId(new URL(request.url).searchParams.get("companyId")))
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

