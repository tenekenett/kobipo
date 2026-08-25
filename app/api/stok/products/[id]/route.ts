import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { resolveSlugId } from "@/lib/slug-resolve"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"
import { normalizeUnitCode } from "@/lib/data/units"
import { findRecipeUnitConflicts } from "@/lib/stock/recipe"
import { deleteProductImage, readImageUrlField } from "@/lib/stock/product-image"
import { adjustWarehouseStock, closeProductStock, ensureDefaultWarehouseId } from "@/lib/stock/warehouse"


export const dynamic = 'force-dynamic'

/**
 * Ürünün stoğunun tutulduğu depo: en çok bakiyenin olduğu depo, hiç kaydı yoksa
 * varsayılan. Kart üzerinden yapılan düzeltme oraya yazılmalı — varsayılana
 * kaymasaydı bile "ürün A deposunda ama düzeltme B'ye gitti" hâli doğardı.
 */
async function resolveProductWarehouseId(companyId: string, productId: string): Promise<string> {
  const row = await prisma.warehouseStock.findFirst({
    where: { productId, warehouse: { companyId } },
    orderBy: { quantity: "desc" },
    select: { warehouseId: true },
  })
  return row?.warehouseId ?? (await ensureDefaultWarehouseId(prisma, companyId))
}

export const GET = withApiErrors(async function GET(
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
      return accessDeniedResponse(error)
    }
    console.error("Error fetching product:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
})

export const PUT = withApiErrors(async function PUT(
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

    await ensureCompanyWrite(product.companyId)

    const body = await request.json()
    const {
      code,
      name,
      barcode,
      category,
      shelfCode,
      unit,
      vatRate,
      purchasePrice,
      salePrice,
      currency,
      salePriceVatIncluded,
      purchasePriceVatIncluded,
      minStockLevel,
      isService,
      isActive,
      isSellable,
      isIngredient,
    } = body

    // Stok birimi değişiyorsa: bu ürünü bileşen olarak kullanan reçetelerde
    // miktarlar çevrilemez hale gelebilir. Bunu burada kesmezsek hata satışa
    // kadar taşınır ve orada SESSİZ kalır (bileşen atlanır, stok düşmez).
    // Bkz. lib/stock/recipe.ts findRecipeUnitConflicts.
    if (unit !== undefined) {
      const nextUnit = normalizeUnitCode(unit)
      if (nextUnit && nextUnit !== normalizeUnitCode(product.unit)) {
        const conflicts = await findRecipeUnitConflicts(
          prisma,
          product.companyId,
          product.id,
          nextUnit
        )
        if (conflicts.length > 0) {
          const detail = conflicts
            .slice(0, 5)
            .map((c) => `${c.recipeProductName} (${c.itemUnit})`)
            .join(", ")
          return NextResponse.json(
            {
              error:
                `Birim ${product.unit} → ${nextUnit} olarak değiştirilemez: bu ürün ` +
                `${conflicts.length} reçete kaleminde çevrilemeyecek bir birimle geçiyor — ` +
                `${detail}${conflicts.length > 5 ? "…" : ""}. Önce o reçetelerdeki birimi ` +
                `güncelleyin (yeni birimle aynı ölçü ailesinden olmalı: KG↔GR, LT↔ML).`,
            },
            { status: 400 }
          )
        }
      }
    }

    // Fotoğraf. Gövdede `imageUrl` YOKSA alana dokunulmaz: bu ucu çağıran eski
    // formlar (Stok ürün düzenleme) fotoğrafı hiç bilmiyor, göndermedikleri için
    // menüdeki fotoğrafın silinmesi kabul edilemez.
    const image = readImageUrlField(body)
    if (image.changed && "error" in image) {
      return NextResponse.json({ error: image.error }, { status: 400 })
    }

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
        // Gövdede yoksa dokunulmaz: bu ucu rafı hiç bilmeyen formlar da çağırıyor.
        shelfCode:
          shelfCode !== undefined
            ? (String(shelfCode).trim() ? String(shelfCode).trim() : null)
            : product.shelfCode,
        imageUrl: image.changed && "url" in image ? image.url : product.imageUrl,
        // Yukarıdaki reçete kontrolü normalize edilmiş birimle yapıldı; kayıt da
        // aynı değeri yazmalı, aksi halde doğrulanan ile saklanan ayrışır.
        unit: unit !== undefined ? normalizeUnitCode(unit) || product.unit : product.unit,
        vatRate: vatForCalc,
        purchasePrice: toNetPrice(purchasePrice, Boolean(purchasePriceVatIncluded)),
        salePrice: toNetPrice(salePrice, Boolean(salePriceVatIncluded)),
        currency:
          typeof currency === "string" && currency.trim()
            ? currency.trim().toUpperCase()
            : product.currency,
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
        isSellable: isSellable !== undefined ? Boolean(isSellable) : product.isSellable,
        isIngredient:
          isIngredient !== undefined ? Boolean(isIngredient) : product.isIngredient,
      },
    })

    // STOK: karta doğrudan yazılmaz, FARKI hareket olarak işlenir. Tek kapı
    // `adjustWarehouseStock` — kart, depo bakiyesi ve hareket defteri birlikte
    // güncellensin (bkz. lib/stock/warehouse.ts). Doğrudan `stockQuantity` yazmak
    // Σ(WarehouseStock) = Product.stockQuantity değişmezini bozardı.
    //
    // Gövdede alan YOKSA dokunulmaz: bu ucu stoğu hiç göndermeyen formlar da
    // çağırıyor (components/stok/product-edit-dialog.tsx) — yokluğu "0 yap"
    // sayılsaydı ürünün stoğu adı düzeltilirken sıfırlanırdı.
    let newStock = Number(product.stockQuantity)
    if (!updated.isService && body.stockQuantity !== undefined && body.stockQuantity !== "") {
      const target = parseFloat(String(body.stockQuantity))
      if (!Number.isFinite(target)) {
        return NextResponse.json({ error: "Stok miktarı sayı olmalı" }, { status: 400 })
      }
      // 4 ondalık: kartın hassasiyeti (reçetede gram/mililitre düşümü için).
      const delta = Math.round((target - newStock) * 10000) / 10000
      if (delta !== 0) {
        await adjustWarehouseStock(prisma, {
          companyId: product.companyId,
          productId: product.id,
          warehouseId: await resolveProductWarehouseId(product.companyId, product.id),
          delta,
          type: "ADJUSTMENT",
          description: "Ürün kartından stok düzeltmesi",
          createdBy: user.id,
        })
        newStock = target
      }
    }

    // ÜRÜN → HİZMET: kalan bakiye kapatılır. Hizmet kalemi bir daha stok hareketi
    // üretmeyeceği için bakiye kartta donar ve kullanıcı bunu "stoğum düşmüyor"
    // olarak yaşar (bkz. closeProductStock).
    if (!product.isService && updated.isService) {
      await closeProductStock(prisma, {
        companyId: product.companyId,
        productId: product.id,
        description: "Hizmete çevrildi — stok bakiyesi kapatıldı",
        createdBy: user.id,
      })
      newStock = 0
    }

    // Eski fotoğrafın nesnesi depoda yetim kalmasın. Kayıt BAŞARILI olduktan
    // sonra silinir: önce silseydik update patladığında ürün hâlâ artık var
    // olmayan bir görseli gösteriyor olurdu.
    if (image.changed && "url" in image && product.imageUrl !== image.url) {
      await deleteProductImage(product.imageUrl)
    }

    // stockQuantity'yi `updated`ten değil hesaptan basıyoruz: update kaydı stok
    // düzeltmesinden ÖNCE okundu, eski bakiyeyi taşıyor.
    return NextResponse.json({ ...updated, stockQuantity: newStock })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error updating product:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
})

// Kısmi güncelleme: yalnızca gövdede gönderilen alanları değiştirir, geri kalan
// alanları (fiyat, stok, minStokSeviyesi vb.) OLDUĞU GİBİ korur. Fatura ekranından
// hızlı barkod düzenlemesi için kullanılır — PUT tüm alanları beklediğinden burada
// güvenli tekil alan güncellemesi yapılır.
export const PATCH = withApiErrors(async function PATCH(
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

    await ensureCompanyWrite(product.companyId)

    const body = await request.json()
    const data: Record<string, unknown> = {}

    if ("barcode" in body) {
      const raw = body.barcode
      const trimmed = raw == null ? "" : String(raw).trim()
      data.barcode = trimmed ? trimmed : null
    }

    // Tür bayrakları (lib/stock/product-kind.ts). Menü & Reçeteler ekranındaki
    // tür seçici üçünü BİRLİKTE gönderir — tek tek yazılsaydı ara adımda ürün
    // hiçbir listede görünmeyen bir duruma düşebilirdi. Fiyat/stok alanlarına
    // dokunulmaz.
    //
    // `isService` de kabul edilmeli: aksi halde "hizmete çevir" isteği sessizce
    // yutulur ve istemci başarılı sanır (yanıt 200, alan değişmemiş).
    for (const field of ["isService", "isSellable", "isIngredient"] as const) {
      if (field in body) data[field] = Boolean(body[field])
    }

    // Fotoğraf — Menü & Reçeteler ekranındaki fotoğraf diyaloğu buradan yazar.
    // PUT değil PATCH kullanılmasının sebebi: PUT gövdesinde gelmeyen fiyat/stok
    // alanlarını sıfırlar, fotoğraf değiştirmek fiyat silmemeli.
    const image = readImageUrlField(body)
    if (image.changed) {
      if ("error" in image) {
        return NextResponse.json({ error: image.error }, { status: 400 })
      }
      data.imageUrl = image.url
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No updatable fields provided" }, { status: 400 })
    }

    const updated = await prisma.product.update({
      where: { id: resolvedParams.id },
      data,
    })

    // ÜRÜN → HİZMET: bakiye kapatılır. Tür seçici (Menü & Reçeteler) bu ucu
    // kullanıyor; PUT ile aynı kural burada da geçerli, yoksa hayalet bakiye
    // yalnızca yolu değiştirerek geri gelirdi.
    let patchedStock = Number(product.stockQuantity)
    if (!product.isService && updated.isService) {
      await closeProductStock(prisma, {
        companyId: product.companyId,
        productId: product.id,
        description: "Hizmete çevrildi — stok bakiyesi kapatıldı",
        createdBy: user.id,
      })
      patchedStock = 0
    }

    // Eski fotoğraf kayıt BAŞARILI olduktan sonra silinir — bkz. PUT'taki not.
    if (image.changed && "url" in image && product.imageUrl !== image.url) {
      await deleteProductImage(product.imageUrl)
    }

    return NextResponse.json({ ...updated, stockQuantity: patchedStock })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error patching product:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
})

export const DELETE = withApiErrors(async function DELETE(
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

    await ensureCompanyWrite(product.companyId)

    await prisma.product.delete({
      where: { id: resolvedParams.id },
    })

    // Ürünle birlikte fotoğrafı da gitsin — kayıt silindikten sonra ona hiçbir
    // yerden ulaşılamaz, depoda tutmanın anlamı yok.
    await deleteProductImage(product.imageUrl)

    return NextResponse.json({ message: "Product deleted" })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error deleting product:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
})

