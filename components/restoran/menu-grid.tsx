"use client"

// Menü ızgarası — Kahveci Satış ve Adisyon ekranlarının ORTAK parçası.
//
// Ayrı bir bileşen olmasının sebebi tekrar değil, AYRIŞMA riski: iki ekranda da
// "menüde hangi ürünler görünür" sorusunun cevabı aynı olmalı (aktif + satılabilir
// + hizmet değil). İki kopya olsaydı biri `isSellable`'ı unuttuğu anda kasiyer bir
// ekranda görüp diğerinde göremediği ürünlerle uğraşırdı — İş 9'daki üç bayrak
// dağınıklığının aynısı.
//
// Rozet (sağ üstteki adet) çağırana bırakılır: satışta sepetteki adet, adisyonda
// adisyondaki adet gösterilir.

import { useMemo, useState } from "react"
import { CompanyLink } from "@/components/dashboard/company-link"
import { ChefHat, CupSoda, Search } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { FetchErrorText } from "@/components/ui/fetch-error"
import { Input } from "@/components/ui/input"
import { currency } from "@/lib/fis/receipt-html"
import { qty } from "@/lib/format"
import type { RefProduct } from "@/lib/swr/use-company-data"
import { cn } from "@/lib/utils"

const ALL_CATEGORIES = "__ALL__"

/** Menüde gösterilen KDV dahil fiyat — kahvecide fiyat listesi brüttür. */
export const grossPrice = (p: { salePrice: number | null; vatRate: number }) =>
  (p.salePrice ?? 0) * (1 + (Number(p.vatRate) || 0) / 100)

/** Menüde görünen ürünler: aktif + satılabilir + hizmet değil. TEK tanım. */
export function menuProductsOf(products: RefProduct[]): RefProduct[] {
  return products.filter((p) => p.isActive && p.isSellable && !p.isService)
}

type MenuGridProps = {
  products: RefProduct[]
  /** Reçetesi olan ürünlerde kaşık ikonu gösterilir. */
  recipeMap?: Map<string, unknown>
  isLoading?: boolean
  error?: unknown
  /** Kartın sağ üstündeki adet rozeti; null/0 ise rozet çizilmez. */
  badgeOf?: (productId: string) => number | null | undefined
  onPick: (product: RefProduct) => void
}

export function MenuGrid({
  products,
  recipeMap,
  isLoading,
  error,
  badgeOf,
  onPick,
}: MenuGridProps) {
  const [search, setSearch] = useState("")
  const [activeCat, setActiveCat] = useState<string>(ALL_CATEGORIES)

  const menuProducts = useMemo(() => menuProductsOf(products), [products])

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const p of menuProducts) if (p.category) set.add(p.category)
    return Array.from(set).sort((a, b) => a.localeCompare(b, "tr-TR"))
  }, [menuProducts])

  const visibleProducts = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("tr-TR")
    return menuProducts
      .filter((p) => activeCat === ALL_CATEGORIES || p.category === activeCat)
      .filter(
        (p) =>
          !q ||
          p.name.toLocaleLowerCase("tr-TR").includes(q) ||
          (p.code ?? "").toLocaleLowerCase("tr-TR").includes(q) ||
          (p.barcode ?? "").toLocaleLowerCase("tr-TR").includes(q)
      )
      .sort((a, b) => a.name.localeCompare(b.name, "tr-TR"))
  }, [menuProducts, activeCat, search])

  const catTab = (isActive: boolean) =>
    cn(
      "shrink-0 rounded-full px-4 py-2 text-sm font-semibold transition-colors",
      isActive
        ? "bg-kobipo-blue text-white dark:bg-primary dark:text-primary-foreground"
        : "bg-muted text-muted-foreground hover:bg-muted/70"
    )

  return (
    <Card>
      <CardContent className="space-y-3 p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <CupSoda className="h-4 w-4 text-kobipo-blue dark:text-primary" />
            <span className="text-sm font-semibold">Menü</span>
            <span className="text-xs text-muted-foreground">
              ({menuProducts.length} ürün · fiyatlar KDV dahil)
            </span>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Ürün ara…"
              className="h-10 pl-9"
            />
          </div>
        </div>

        {categories.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setActiveCat(ALL_CATEGORIES)}
              className={catTab(activeCat === ALL_CATEGORIES)}
            >
              Tümü
            </button>
            {categories.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setActiveCat(c)}
                className={catTab(activeCat === c)}
              >
                {c}
              </button>
            ))}
          </div>
        )}

        {/* Yükleme ve hata durumu boş menüden AYRI: ürün listesi çekilemediğinde
            "menüde ürün yok" demek kasiyeri yanıltır — menü dolu ama ekran boş. */}
        {error ? (
          <div className="py-12 text-center text-sm text-red-600 dark:text-red-400">
            <FetchErrorText error={error} subject="Menü" />
          </div>
        ) : isLoading && products.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Menü yükleniyor…</div>
        ) : visibleProducts.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {menuProducts.length === 0 ? (
              // Kurulum artık tek yerde (Menü & Reçeteler) — iki ayrı yol tarif
              // etmek yerine doğrudan oraya bağlıyoruz.
              <>
                Menüde ürün yok.{" "}
                <CompanyLink
                  href="/restoran/menu"
                  className="font-semibold text-kobipo-blue underline-offset-4 hover:underline dark:text-primary"
                >
                  Menü &amp; Reçeteler
                </CompanyLink>{" "}
                ekranından ürünlerinizi menüye alın.
              </>
            ) : (
              "Bu aramaya/kategoriye uyan ürün yok"
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {visibleProducts.map((p) => {
              const badge = badgeOf?.(p.id) ?? null
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => onPick(p)}
                  className={cn(
                    "relative flex min-h-[86px] flex-col justify-between gap-2 rounded-xl border-2 p-3 text-left transition-colors",
                    badge
                      ? "border-kobipo-blue bg-kobipo-blue/5 dark:border-primary dark:bg-primary/10"
                      : "border-border hover:border-kobipo-blue hover:bg-kobipo-blue/5 dark:hover:border-primary dark:hover:bg-primary/10"
                  )}
                >
                  {!!badge && (
                    <span className="absolute right-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-kobipo-blue px-1.5 text-xs font-bold text-white dark:bg-primary dark:text-primary-foreground">
                      {qty(badge)}
                    </span>
                  )}
                  <span className="line-clamp-2 pr-7 text-sm font-semibold">{p.name}</span>
                  <span className="flex items-center gap-1.5">
                    <span className="text-sm font-bold text-kobipo-blue dark:text-primary">
                      {p.salePrice != null ? currency(grossPrice(p)) : "—"}
                    </span>
                    {recipeMap?.has(p.id) && (
                      <ChefHat className="h-3.5 w-3.5 text-muted-foreground" aria-label="Reçeteli" />
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
