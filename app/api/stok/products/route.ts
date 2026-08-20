import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { adjustWarehouseStock, ensureDefaultWarehouseId } from "@/lib/stock/warehouse"
import { resolveAllUnitCosts } from "@/lib/stock/cost"
import { readImageUrlField } from "@/lib/stock/product-image"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = 'force-dynamic'


export const GET = withApiErrors(async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    const search = searchParams.get("search")
    const isService = searchParams.get("isService")
    const isSellable = searchParams.get("isSellable")
    const isIngredient = searchParams.get("isIngredient")
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

    // Menüde görünürlük: satış ekranları ızgarayı buna göre daraltır.
    if (isSellable !== null) {
      where.isSellable = isSellable === "true"
    }

    // Hammadde (reçete bileşeni) ayrımı. isSellable ile BİRBİRİNİ DIŞLAMAZ:
    // kahve çekirdeği hem menüde satılıp hem latte reçetesinde durabilir.
    if (isIngredient !== null) {
      where.isIngredient = isIngredient === "true"
    }

    if (category) {
      where.category = category
    }

    const products = await prisma.product.findMany({
      where,
      orderBy: { name: "asc" },
    })

    // Ağırlıklı ortalama alış fiyatı (AVCO). Tanım TEK yerde: lib/stock/cost.ts.
    // Reçete ekranı, satış anındaki maliyet dondurma ve restoran raporları da
    // aynı kapıyı kullanır — aksi halde aynı ürün için farklı maliyet gösterirler
    // (bkz. docs/restoran/SADELESTIRME.md "İş 2").
    //
    // Eskiden burada firmanın TÜM alış hareketleri belleğe çekilip JS'te
    // toplanıyordu; hareket tablosu her satışla büyüdüğü için bu uç sınırsız
    // yavaşlıyordu. Artık tek GROUP BY sorgusu, satırlar uygulamaya hiç gelmiyor.
    const costByProduct = await resolveAllUnitCosts(companyId)

    const result = products.map((p) => ({
      ...p,
      avgPurchasePrice: costByProduct.get(p.id) ?? null,
    }))

    return NextResponse.json(result)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error fetching products:", error)
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
      isSellable,
      isIngredient,
      warehouseId,
    } = body

    if (!companyId || !name) {
      return NextResponse.json(
        { error: "companyId and name are required" },
        { status: 400 }
      )
    }

    await ensureCompanyWrite(companyId)

    // Fotoğraf: yalnızca kendi bucket'ımızdaki bir nesnenin URL'i kabul edilir.
    const image = readImageUrlField(body)
    if (image.changed && "error" in image) {
      return NextResponse.json({ error: image.error }, { status: 400 })
    }

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
        imageUrl: image.changed && "url" in image ? image.url : null,
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
        // Gönderilmezse true (şema varsayılanı) — mevcut çağıranların davranışı değişmez.
        isSellable: isSellable === undefined ? true : Boolean(isSellable),
        // Reçete bileşeni olarak kullanılan kalem mi. isSellable ile birbirini
        // dışlamaz; varsayılan false (mevcut çağıranlar hammadde üretmiyor).
        isIngredient: Boolean(isIngredient),
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
      return accessDeniedResponse(error)
    }
    console.error("Error creating product:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
})

