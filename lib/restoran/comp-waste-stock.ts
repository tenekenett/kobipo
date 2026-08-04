// İkram (COMP) ve zayi (WASTE) kalemlerinin STOK etkisi.
//
// Neden ayrı bir yol: bu kalemler fişe GİRMEZ (müşteri ödemez), ama malzemesi
// gerçekten harcanmıştır. Fiş yolu üzerinden düşürmenin tek yolu onları 0 TL
// kalem olarak faturaya yazmaktı — fatura/KDV tarafını kirletirdi. Bu yüzden
// stok düzeltmesi ayrı yazılır; fatura hiç değişmez.
//
// Referans BİLİNÇLİ olarak faturanın id'si: `revertStockByReference` iptalde
// referansa göre net alıp tersini yazıyor. Aynı referansı kullanınca fiş iptal
// edildiğinde ikram/zayi malzemesi de kendiliğinden geri döner — ikinci bir
// geri alma yolu yazmaya gerek kalmaz (lib/stock/warehouse.ts).

import { prisma } from "@/lib/db/prisma"
import { resolveUnitCosts } from "@/lib/stock/cost"
import { expandRecipeLines, type RecipeEffect } from "@/lib/stock/recipe-expand"
import { loadRecipeContext } from "@/lib/stock/recipe"
import { adjustWarehouseStock } from "@/lib/stock/warehouse"
import { reasonLabel } from "@/lib/restoran/tickets"

export type CompWasteLine = {
  productId: string | null
  quantity: number
  status: string
  reasonCode: string | null
  description: string
  /** Kalemin seçeneklerinden kopyalanan reçete sapmaları (soya sütü, ekstra shot). */
  effects?: RecipeEffect[]
  /** Porsiyon çarpanı ("büyük boy" = 1,5). */
  recipeFactor?: number
}

/**
 * İkram/zayi kalemlerinin malzemesini stoktan düşer.
 *
 * Satış yolundaki genişletmenin aynısını kullanır (`expandRecipeLines`): ikram
 * edilen Latte'nin sütü de düşmeli, aksi halde ikram ölçülemez ve stok şişer.
 * Maliyet AVCO'dan gelir — "bu ay ne kadar ikram ettik" sorusunun karşılığı
 * hareketin tutarında durur.
 *
 * Hata durumunda SESSİZ kalır (log'lar): kapanış akışı stok yüzünden çökmemeli,
 * fiş zaten kesilmiş olur. Yine de SONUÇ döner — fiş kesmeden çağıran (tezgâh
 * ikramı) kullanıcıya "kaydedilemedi" diyebilsin; adisyon kapanışı yok sayar.
 */
export async function writeCompWasteStock(args: {
  companyId: string
  lines: CompWasteLine[]
  ticketCode: string
  /** Fişin id'si — iptal geri alması bunun üzerinden çalışır. */
  reference: string
  warehouseId?: string | null
  createdBy?: string | null
}): Promise<{ written: number; failed: boolean }> {
  const lines = args.lines.filter(
    (l) => l.productId && Number(l.quantity) > 0 && (l.status === "COMP" || l.status === "WASTE"),
  )
  if (lines.length === 0) return { written: 0, failed: false }

  try {
    const { recipes, unitOf } = await loadRecipeContext(prisma, args.companyId)

    // Hizmet ürünlerinin stoğu yok; genişletmeden SONRA elenir (reçeteli bir
    // menü ürünü hizmet işaretliyse bile bileşenleri düşmeli).
    const { direct, components, errors } = expandRecipeLines({
      lines: lines.map((l) => ({
        productId: l.productId as string,
        quantity: l.quantity,
        // İkram edilen soya sütlü latte'de de soya sütü düşmeli: seçenek etkisi
        // satış yolundaki ile AYNI (SATIS-EKRANI.md K6).
        effects: l.effects,
        recipeFactor: l.recipeFactor,
      })),
      recipes,
      unitOf,
    })
    if (errors.length > 0) {
      console.error("[İkram/Zayi] Reçete genişletme hataları:", args.ticketCode, errors)
    }

    const ops = [
      ...direct.map((d) => ({ productId: d.productId, quantity: d.quantity, fromRecipe: false })),
      ...components.map((c) => ({ productId: c.productId, quantity: c.quantity, fromRecipe: true })),
    ]
    if (ops.length === 0) return { written: 0, failed: false }

    const serviceIds = new Set(
      (
        await prisma.product.findMany({
          where: { id: { in: ops.map((o) => o.productId) }, isService: true },
          select: { id: true },
        })
      ).map((p) => p.id),
    )
    const stockable = ops.filter((o) => !serviceIds.has(o.productId))
    if (stockable.length === 0) return { written: 0, failed: false }

    const costs = await resolveUnitCosts(
      args.companyId,
      stockable.map((o) => o.productId),
    )

    // Açıklama tek satırda "ne, neden": hareket listesinde ikram ile zayi
    // birbirinden ve normal satıştan ayırt edilebilsin.
    const comps = lines.filter((l) => l.status === "COMP")
    const wastes = lines.filter((l) => l.status === "WASTE")
    const summarize = (list: CompWasteLine[], label: string) =>
      list.length === 0
        ? null
        : `${label}: ${list
            .map((l) => {
              const why = reasonLabel(l.status, l.reasonCode)
              return why ? `${l.description} (${why})` : l.description
            })
            .join(", ")}`
    const note = [summarize(comps, "İkram"), summarize(wastes, "Zayi")]
      .filter(Boolean)
      .join(" · ")

    await prisma.$transaction(async (tx) => {
      for (const op of stockable) {
        await adjustWarehouseStock(tx, {
          companyId: args.companyId,
          productId: op.productId,
          warehouseId: args.warehouseId ?? null,
          delta: -op.quantity,
          // ADJUSTMENT: satış değil. Karlılık raporu satış hareketlerine bakar,
          // bu hareketler oraya karışmaz ama stok bakiyesi doğru kalır.
          type: "ADJUSTMENT",
          unitPrice: costs.get(op.productId) ?? null,
          description: `${args.ticketCode} - ${note}`.slice(0, 500),
          reference: args.reference,
          createdBy: args.createdBy ?? null,
        })
      }
    })

    return { written: stockable.length, failed: false }
  } catch (error) {
    console.error("[İkram/Zayi] Stok düzeltmesi yazılamadı:", args.ticketCode, error)
    return { written: 0, failed: true }
  }
}
