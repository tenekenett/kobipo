/**
 * Firmanın ürünleri → eşleştirme özeti (MevcutUrun). SUNUCU (Prisma).
 * Kafe listesi küçüktür (onlarca–birkaç yüz); tümü bellekte, fark listesi
 * `eslestir.ts`te saf kurulur.
 */

import { prisma } from "@/lib/db/prisma"
import type { MevcutUrun } from "./turler"

export async function mevcutUrunler(companyId: string): Promise<MevcutUrun[]> {
  const rows = await prisma.product.findMany({
    where: { companyId },
    select: {
      id: true,
      name: true,
      slug: true,
      category: true,
      vatRate: true,
      salePrice: true,
      isSellable: true,
      isService: true,
      isActive: true,
      recipe: { select: { isActive: true } },
      _count: { select: { optionGroups: true } },
    },
  })
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug || null,
    category: r.category,
    vatRate: Number(r.vatRate),
    salePrice: r.salePrice == null ? null : Number(r.salePrice),
    isSellable: r.isSellable,
    isService: r.isService,
    isActive: r.isActive,
    receteVar: r.recipe?.isActive === true,
    secenekGrubu: r._count.optionGroups,
  }))
}
