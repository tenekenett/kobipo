import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { assertRestaurantModule } from "@/lib/restoran/tickets"
import { accessDeniedResponse } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 })
    }

    assertRestaurantModule(await ensureCompanyAccess(companyId))

    const { id } = await params
    const recipe = await prisma.productRecipe.findFirst({
      where: { id, companyId },
      include: {
        product: { select: { id: true, name: true, unit: true, salePrice: true } },
        items: {
          include: {
            component: {
              select: { id: true, name: true, unit: true, purchasePrice: true, stockQuantity: true },
            },
          },
          orderBy: { order: "asc" },
        },
      },
    })

    if (!recipe) return NextResponse.json({ error: "Reçete bulunamadı" }, { status: 404 })

    return NextResponse.json(recipe)
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error fetching recipe:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * Reçeteyi siler. Ürün silinmez — reçetesi kalkan ürün bundan sonra normal bir
 * stok kalemi gibi davranır (satışta kendisi düşer). Kalemler onDelete: Cascade
 * ile birlikte gider.
 */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 })
    }

    assertRestaurantModule(await ensureCompanyWrite(companyId))

    const { id } = await params
    const recipe = await prisma.productRecipe.findFirst({
      where: { id, companyId },
      select: { id: true },
    })
    if (!recipe) return NextResponse.json({ error: "Reçete bulunamadı" }, { status: 404 })

    await prisma.productRecipe.delete({ where: { id: recipe.id } })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error deleting recipe:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
