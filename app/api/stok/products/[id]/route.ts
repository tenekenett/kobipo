import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import {
  isInboundMovement,
  OUTBOUND_MOVEMENT_TYPES,
  signedMovementQuantity,
} from "@/lib/stock/movement-sign"
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
import { resolveLastPurchases, resolveUnitCosts } from "@/lib/stock/cost"
import { effectiveAvgSale, emptyAvgSalePrice, resolveAvgSalePrices } from "@/lib/stock/sale-price"


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

    /**
     * Hareketin İŞARETLİ etkisi (+ giriş, − çıkış).
     *
     * Bugün her hareket `adjustWarehouseStock` üzerinden işaretli yazılır, o yüzden
     * miktarın kendisi yeterli. Tipe yalnız tek kapı ÖNCESİ yazılmış satırlar için
     * bakılıyor: onlarda çıkışlar pozitif miktarla duruyor.
     */
    // Kural lib/stock/movement-sign.ts'te — stok hareket raporu da aynı yeri okur.
    const signedQuantity = signedMovementQuantity

    // Toplam giriş/çıkış İŞARETE göre sayılır. Eskiden yalnız `IN`/`OUT` (ve
    // TRANSFER) sayılıyordu; sayım/elle düzeltme (ADJUSTMENT) hiçbir toplama
    // girmiyordu. Aynı satır, hareket tablosunda "Giriş" etiketiyle görünüyordu:
    // kullanıcı listede gördüğü girişi üstteki toplamda bulamıyordu.
    //
    // TOPLAM, VERİTABANINDA hesaplanır — yukarıdaki listeden DEĞİL. Liste ekranda
    // gösterilecek son 50 hareketle sınırlı (`take: 50`); toplamlar da o listeden
    // türetildiği sürece "Toplam Giriş/Çıkış" kartları aslında "son 50 hareketin
    // girişi/çıkışı"nı gösteriyordu ve etiketleriyle çelişiyordu. Somut hâli:
    // 6 giriş, 144 çıkış, ama mevcut stok 1.062 — üçü hiçbir aritmetikle
    // bağdaşmıyordu (gerçek toplamlar 31.231.324 / 31.230.262 idi).
    //
    // İşaret kuralı SQL'e kopyalanmıyor: çıkış tipleri lib/stock/movement-sign.ts
    // sabitinden geliyor, yoksa aynı kuralın ikinci bir sürümü doğardı.
    const [movementTotals] = await prisma.$queryRaw<
      Array<{ total_in: unknown; total_out: unknown }>
    >`
      SELECT
        COALESCE(SUM(CASE WHEN s.signed_qty > 0 THEN s.signed_qty ELSE 0 END), 0) AS total_in,
        COALESCE(SUM(CASE WHEN s.signed_qty < 0 THEN -s.signed_qty ELSE 0 END), 0) AS total_out
      FROM (
        SELECT CASE
                 WHEN m.quantity > 0 AND m.type IN (${Prisma.join(OUTBOUND_MOVEMENT_TYPES)})
                 THEN -m.quantity
                 ELSE m.quantity
               END AS signed_qty
        FROM stock_movements m
        WHERE m."productId" = ${product.id}
          AND m."companyId" = ${product.companyId}
      ) s
    `

    const totalIn = Number(movementTotals?.total_in ?? 0)
    const totalOut = Number(movementTotals?.total_out ?? 0)

    // Eski kayıtlarda unitPrice null olabilir; bu durumda hareket tipine göre
    // ürünün alış/satış fiyatını fallback olarak kullan, böylece tablo 0 göstermez.
    const purchasePrice = Number(product.purchasePrice || 0)
    const salePrice = Number(product.salePrice || 0)

    // Hareketteki fiyat KAYNAK BELGENİN para birimindedir (stock_movements'ta
    // currency kolonu yok). Ürün kartı USD ama fiş TRY olabilir — sembolü ürünün
    // para biriminden basarsak TRY tutarı "$" ile görünür. Bu yüzden fatura/fiş
    // referansı olan hareketlerin para birimi belgeden okunur; referansı olmayan
    // (elle düzeltme, açılış) veya fiyatı null olup karttan doldurulan satırlar
    // ürünün para birimindedir.
    const invoiceRefs = Array.from(
      new Set(product.stockMovements.map((m) => m.reference).filter((r): r is string => !!r)),
    )
    // Referans iki biçimde gelir: fatura id'si ya da "waybill:<id>" (irsaliye).
    const WAYBILL_PREFIX = "waybill:"
    const waybillIds = invoiceRefs
      .filter((r) => r.startsWith(WAYBILL_PREFIX))
      .map((r) => r.slice(WAYBILL_PREFIX.length))
    const plainRefs = invoiceRefs.filter((r) => !r.startsWith(WAYBILL_PREFIX))

    const invoiceCurrency = new Map<string, string>()
    /**
     * Referansı fatura olan hareketler için belge kimliği. Liste eskiden ham cuid
     * basıyordu; kullanıcı hangi fatura olduğunu göremiyordu. Numara olarak
     * e-Belge numarası (Mysoft/GİB'e giden asıl numara) tercih edilir, yoksa iç
     * fatura numarasına düşülür.
     */
    const invoiceRef = new Map<string, { id: string; no: string; type: string }>()
    if (plainRefs.length > 0) {
      const invoices = await prisma.invoice.findMany({
        where: { id: { in: plainRefs }, companyId: product.companyId },
        select: { id: true, currency: true, invoiceNo: true, eDocumentNo: true, type: true },
      })
      for (const inv of invoices) {
        invoiceCurrency.set(inv.id, inv.currency || "TRY")
        invoiceRef.set(inv.id, {
          id: inv.id,
          no: inv.eDocumentNo || inv.invoiceNo,
          type: inv.type,
        })
      }
    }

    /**
     * İrsaliye kaynaklı hareketler. Ekran bunlarda yalnız "İrsaliye" yazıyordu —
     * hangi irsaliye olduğu görünmüyordu; oysa stok hareket raporu aynı hareketi
     * numarasıyla çözüyor (`lib/raporlar/stok-hareket.ts`). Numara buradan gelir,
     * bağlantı ilgili irsaliye listesini o numarayla süzülü açar (irsaliyenin
     * ayrı bir detay sayfası yok).
     */
    const waybillRef = new Map<string, { id: string; no: string; type: string }>()
    if (waybillIds.length > 0) {
      const waybills = await prisma.waybill.findMany({
        where: { id: { in: waybillIds }, companyId: product.companyId },
        select: { id: true, waybillNo: true, type: true },
      })
      for (const w of waybills) {
        waybillRef.set(`${WAYBILL_PREFIX}${w.id}`, { id: w.id, no: w.waybillNo, type: w.type })
      }
    }

    // "Kalan" sütunu: her hareketten SONRAKİ bakiye. Kart bugünkü bakiyeyi
    // taşıdığı için liste yeniden eskiye doğru GERİ SARILARAK hesaplanır.
    //
    // İki hata birlikte düzeltildi:
    //  • Bakiye, satırın kendi etkisi düşüldükten SONRA yazılıyordu; yani her
    //    satır bir ÖNCEKİNİN bakiyesini gösteriyordu — en yeni hareket hiçbir
    //    zaman güncel stoğu göstermiyor, en eski satır hep 0 çıkıyordu.
    //  • Geri sarma İŞARETE değil TİPE bakıyordu ("IN değilse ekle"): pozitif
    //    ADJUSTMENT (sayım artışı, karttan elle düzeltme) çıkış sanılıyor ve o
    //    satırdan sonraki tüm bakiyeler kayıyordu.
    //
    // Bugün her hareket `adjustWarehouseStock` üzerinden İŞARETLİ yazılır
    // (giriş +, çıkış −), dolayısıyla işaret tek başına yeter. Tipe yalnız tek
    // kapı ÖNCESİ yazılmış satırlar için bakılıyor: onlarda çıkışlar pozitif
    // miktarla duruyor.
    let runningBalance = Number(product.stockQuantity)
    const movements = product.stockMovements.map((movement) => {
      const qty = Number(movement.quantity)
      const signed = signedQuantity(movement)
      const balanceAfter = Math.round(runningBalance * 10000) / 10000
      runningBalance = Math.round((runningBalance - signed) * 10000) / 10000

      const isInbound = isInboundMovement(movement)
      const hasOwnPrice = movement.unitPrice != null
      const unitPrice = hasOwnPrice
        ? Number(movement.unitPrice)
        : isInbound
          ? purchasePrice
          : salePrice

      return {
        id: movement.id,
        currency:
          (hasOwnPrice && movement.reference ? invoiceCurrency.get(movement.reference) : null) ??
          product.currency ??
          "TRY",
        date: movement.createdAt.toISOString(),
        type: movement.type,
        // İŞARETLİ miktar: ekran yönü buradan okuyor (+ giriş, − çıkış) ve mutlak
        // değeri kendisi basıyor. Burası `Math.abs` döndürdüğü sürece ekrandaki
        // "miktar > 0 ise Giriş" kuralı HER satırı giriş sanıyordu — satışlar bile
        // yeşil "Giriş" olarak listeleniyordu.
        quantity: signed,
        unitPrice,
        totalAmount: Math.abs(qty) * unitPrice,
        description: movement.description || "",
        referenceNo: movement.reference || undefined,
        // Fatura kaynaklı hareket: ekran numarayı basar ve faturaya link verir.
        // Referans adisyon ya da SİLİNMİŞ bir fatura ise eşleşme olmaz, alan null
        // kalır (açıklama satırı belge numarasını yine taşır).
        invoice: (movement.reference && invoiceRef.get(movement.reference)) || null,
        waybill: (movement.reference && waybillRef.get(movement.reference)) || null,
        balanceAfter,
      }
    }).reverse() // Reverse to show oldest first

    // ── TÜRETİLMİŞ FİYATLAR ─────────────────────────────────────────────────
    // Kart iki sayıyı YAN YANA gösterir: elle girilen fiyat ve belgelerden çıkan
    // gerçek. Hiçbiri karta OTOMATİK yazılmaz — kullanıcı "Fiyatı güncelle" derse yazılır
    // (gerekçe: lib/stock/sale-price.ts başlığı, liste fiyatı geri besleme döngüsü).
    //
    // Tanımlar burada DEĞİL, ortak modüllerde: maliyet lib/stock/cost.ts (AVCO),
    // satış lib/stock/sale-price.ts. Buraya kopyalansaydı liste ekranı, reçete
    // ekranı ve bu kart aynı ürün için farklı maliyet gösterirdi.
    const [costByProduct, lastPurchases, avgSales] = await Promise.all([
      resolveUnitCosts(product.companyId, [product.id]),
      resolveLastPurchases(product.companyId, [product.id]),
      resolveAvgSalePrices(product.companyId, [product.id]),
    ])

    const avgSale = avgSales.get(product.id) ?? emptyAvgSalePrice()
    const effectiveSale = effectiveAvgSale(avgSale)
    const lastPurchase = lastPurchases.get(product.id) ?? null

    return NextResponse.json({
      ...product,
      totalIn,
      totalOut,
      movements,
      /** AVCO — alış faturalarından türeyen ağırlıklı ortalama maliyet; yoksa null. */
      avgPurchasePrice: costByProduct.get(product.id) ?? null,
      lastPurchase: lastPurchase
        ? { unitPrice: lastPurchase.unitPrice, date: lastPurchase.date.toISOString() }
        : null,
      /**
       * Gerçekleşen satış fiyatı. `scope` hangi aralıktan geldiğini söyler:
       * pencere doluysa "PERIOD", değilse "ALL". Ekran etiketi buna bağlı —
       * etiketsiz basılırsa iki farklı soru aynı sayıymış gibi okunur.
       */
      avgSalePrice: effectiveSale
        ? {
            price: effectiveSale.price,
            quantity: effectiveSale.quantity,
            scope: effectiveSale.scope,
            periodDays: avgSale.periodDays,
            lastSaleDate: avgSale.lastSaleDate ? avgSale.lastSaleDate.toISOString() : null,
          }
        : null,
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
        // Gövdede ALAN YOKSA dokunulmaz — yukarıdaki shelfCode/unit ile aynı kural.
        // Eskiden koşulsuz yazılıyordu: yalnız bir fiyatı güncelleyen kısmi bir
        // istek (ürün detayındaki "Fiyatı güncelle") ötekini sessizce NULL'a çekerdi.
        // Alanı BOŞ göndermek ("") hâlâ silmektir; formlar temizlemeyi böyle yapar.
        purchasePrice:
          purchasePrice !== undefined
            ? toNetPrice(purchasePrice, Boolean(purchasePriceVatIncluded))
            : product.purchasePrice,
        salePrice:
          salePrice !== undefined
            ? toNetPrice(salePrice, Boolean(salePriceVatIncluded))
            : product.salePrice,
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
        // Fiyatlarla aynı gerekçe: alan gövdede yoksa dokunma, boşsa temizle.
        minStockLevel:
          minStockLevel !== undefined
            ? (minStockLevel ? parseFloat(minStockLevel) : null)
            : product.minStockLevel,
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

