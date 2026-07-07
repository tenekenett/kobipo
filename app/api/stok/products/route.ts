import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { adjustWarehouseStock, ensureDefaultWarehouseId } from "@/lib/stock/warehouse"

export const dynamic = 'force-dynamic'


export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    const search = searchParams.get("search")
    const isService = searchParams.get("isService")
    const category = searchParams.get("category")

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

    if (category) {
      where.category = category
    }

    const products = await prisma.product.findMany({
      where,
      orderBy: { name: "asc" },
    })

    // Ağırlıklı ortalama alış fiyatı (AVCO): geçmiş alış hareketlerinin
    // birim fiyatları, alınan miktarla ağırlıklandırılarak hesaplanır.
    // Sadece fiyatı kayıtlı (unitPrice != null) alış hareketleri dikkate alınır.
    const productIds = products.map((p) => p.id)
    const avgPurchasePriceByProduct = new Map<string, number>()

    if (productIds.length > 0) {
      const purchaseMovements = await prisma.stockMovement.findMany({
        where: {
          companyId,
          productId: { in: productIds },
          type: { in: ["IN", "PURCHASE"] },
          unitPrice: { not: null },
        },
        select: { productId: true, quantity: true, unitPrice: true },
      })

      const totals = new Map<string, { amount: number; qty: number }>()
      for (const m of purchaseMovements) {
        const qty = Math.abs(Number(m.quantity))
        const price = Number(m.unitPrice)
        if (qty <= 0) continue
        const acc = totals.get(m.productId) || { amount: 0, qty: 0 }
        acc.amount += qty * price
        acc.qty += qty
        totals.set(m.productId, acc)
      }

      totals.forEach(({ amount, qty }, productId) => {
        if (qty > 0) avgPurchasePriceByProduct.set(productId, amount / qty)
      })
    }

    const result = products.map((p) => ({
      ...p,
      // Hareketlerden hesaplanan ortalama yoksa manuel girilen alış fiyatına düş.
      avgPurchasePrice:
        avgPurchasePriceByProduct.get(p.id) ??
        (p.purchasePrice != null ? Number(p.purchasePrice) : null),
    }))

    return NextResponse.json(result)
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
    body.companyId = await resolveCompanyId(body.companyId)
    const {
      companyId,
      code,
      name,
      barcode,
      category,
      unit,
      vatRate,
      purchasePrice,
      salePrice,
      currency,
      salePriceVatIncluded,
      purchasePriceVatIncluded,
      stockQuantity,
      minStockLevel,
      isService,
      warehouseId,
    } = body

    if (!companyId || !name) {
      return NextResponse.json(
        { error: "companyId and name are required" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)

    // KDV dahil girilen fiyatları net'e çevir (DB net saklar). Bayrak yalnızca
    // kullanıcı tercihini hatırlamak içindir.
    const vatForCalc = vatRate ? parseFloat(vatRate) : 20
    const toNetPrice = (raw: unknown, included: boolean): number | null => {
      if (raw == null || raw === "") return null
      const v = parseFloat(String(raw))
      if (Number.isNaN(v)) return null
      return included && vatForCalc > 0 ? v / (1 + vatForCalc / 100) : v
    }
    const netSalePrice = toNetPrice(salePrice, Boolean(salePriceVatIncluded))
    const netPurchasePrice = toNetPrice(purchasePrice, Boolean(purchasePriceVatIncluded))

    // Barkod kontrolü
    if (barcode && barcode.trim()) {
      const existingByBarcode = await prisma.product.findFirst({
        where: {
          companyId,
          barcode: barcode.trim(),
        },
      })
      if (existingByBarcode) {
        return NextResponse.json(
          { error: `Aynı barkoda (${barcode}) sahip ürün zaten mevcut` },
          { status: 409 }
        )
      }
    }

    // İsim kontrolü
    if (name && name.trim()) {
      const existingByName = await prisma.product.findFirst({
        where: {
          companyId,
          name: name.trim(),
        },
      })
      if (existingByName) {
        return NextResponse.json(
          { error: `Aynı isimde (${name}) ürün zaten mevcut` },
          { status: 409 }
        )
      }
    }

    const initialQty = !isService && stockQuantity ? parseFloat(stockQuantity) : 0

    // Ürünü 0 stokla oluştur; başlangıç stoğu varsa depo bazlı olarak (varsayılan
    // ya da seçilen depoya) helper üzerinden eklenir — böylece toplam stok ve
    // WarehouseStock tutarlı olur, depo özetinde hemen görünür.
    const product = await prisma.product.create({
      data: {
        companyId,
        code,
        name,
        barcode,
        category: category && String(category).trim() ? String(category).trim() : null,
        unit: unit || "ADET",
        vatRate: vatForCalc,
        purchasePrice: netPurchasePrice,
        salePrice: netSalePrice,
        currency: typeof currency === "string" && currency.trim() ? currency.trim().toUpperCase() : "TRY",
        salePriceVatIncluded: Boolean(salePriceVatIncluded),
        purchasePriceVatIncluded: Boolean(purchasePriceVatIncluded),
        stockQuantity: 0,
        minStockLevel: minStockLevel ? parseFloat(minStockLevel) : null,
        isService: isService || false,
      },
    })

    // Ürün (hizmet değilse) seçilen/varsayılan depoya kaydedilir. Stok > 0 ise
    // helper ile (toplam + hareket); stok 0 olsa bile depoya 0 ile kaydedilir ki
    // depo dağılımında "—" yerine ilgili depo görünsün.
    if (!isService) {
      const whId = warehouseId || (await ensureDefaultWarehouseId(prisma, companyId))
      if (initialQty > 0) {
        await adjustWarehouseStock(prisma, {
          companyId,
          productId: product.id,
          warehouseId: whId,
          delta: initialQty,
          type: "IN",
          description: "Açılış stoğu",
          createdBy: user.id,
        })
      } else {
        await prisma.warehouseStock.upsert({
          where: { warehouseId_productId: { warehouseId: whId, productId: product.id } },
          create: { warehouseId: whId, productId: product.id, quantity: 0 },
          update: {},
        })
      }
    }

    return NextResponse.json({ ...product, stockQuantity: initialQty }, { status: 201 })
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

