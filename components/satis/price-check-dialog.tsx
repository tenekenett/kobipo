"use client"

// Fiyat gör / ayrıntılı ürün arama (Hızlı Satış, F7).
//
// Müşteri "bu kaça?" diye sorduğunda barkod okutulur: fiyat ve stok görünür,
// ürün SEPETE EKLENMEZ. Aynı pencere ayrıntılı arama işini de görür — kod,
// barkod, depo bazında stok — çünkü ikisi aynı soruya cevap veriyor. Sepete
// eklemek istenirse satırdaki düğme açıkça basılır.

import { useEffect, useMemo, useRef, useState } from "react"
import { Plus, Tag } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { formatMoney } from "@/lib/format"
import { trFold } from "@/lib/text/tr-fold"
import type { RefProduct, RefWarehouse, RefWarehouseStock } from "@/lib/swr/use-company-data"

const MAX_ROWS = 30

const qtyFmt = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 3 })

export function PriceCheckDialog({
  open,
  onOpenChange,
  products,
  warehouses,
  warehouseStocks,
  onAdd,
  onClosed,
  recipeProductIds,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  products: RefProduct[]
  warehouses: RefWarehouse[]
  warehouseStocks: RefWarehouseStock[]
  /** Satırdaki "Sepete ekle" düğmesi. */
  onAdd: (product: RefProduct) => void
  /** Pencere kapandıktan sonra (odağı barkod kutusuna döndürmek için). */
  onClosed?: () => void
  /** Reçeteli (sanal) ürünler — stokları tutulmaz, satışta hammaddesi düşer. */
  recipeProductIds?: { has: (id: string) => boolean }
}) {
  const [query, setQuery] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) setQuery("")
  }, [open])

  const whName = useMemo(() => new Map(warehouses.map((w) => [w.id, w.name])), [warehouses])
  const stocksByProduct = useMemo(() => {
    const m = new Map<string, RefWarehouseStock[]>()
    for (const s of warehouseStocks) {
      const list = m.get(s.productId) ?? []
      list.push(s)
      m.set(s.productId, list)
    }
    return m
  }, [warehouseStocks])

  // Arama: ad, kod, barkod (Türkçe duyarsız — lib/text/tr-fold). Barkodu BİREBİR
  // tutan ürün en üstte: okutan kişi ilk satıra bakar.
  const rows = useMemo(() => {
    const q = trFold(query.trim())
    if (!q) return []
    const exact = products.filter((p) => p.barcode && trFold(String(p.barcode)) === q)
    const rest = products.filter(
      (p) =>
        !exact.includes(p) &&
        (trFold(p.name).includes(q) ||
          (p.code && trFold(String(p.code)).includes(q)) ||
          (p.barcode && trFold(String(p.barcode)).includes(q)))
    )
    return [...exact, ...rest].slice(0, MAX_ROWS)
  }, [products, query])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-3xl"
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          inputRef.current?.focus()
        }}
        onCloseAutoFocus={(e) => {
          if (!onClosed) return
          e.preventDefault()
          onClosed()
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="h-5 w-5 text-kobipo-blue dark:text-primary" />
            Fiyat Gör
          </DialogTitle>
          <DialogDescription>
            Barkod okutun ya da ürün adı/kodu yazın. Fiyat ve stok görünür; ürün sepete eklenmez.
          </DialogDescription>
        </DialogHeader>

        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Barkod, ürün adı ya da kodu"
          className="h-11 text-base"
          // Okuyucunun Enter'ı formu/diyaloğu tetiklemesin; sonuç zaten anında çıkıyor.
          onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
        />

        <div className="max-h-[55vh] overflow-auto">
          {query.trim() === "" ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Aramak için yazın ya da okutun.</p>
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Eşleşen ürün yok.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="p-2 font-medium">Ürün</th>
                  <th className="p-2 text-right font-medium">Fiyat (KDV dahil)</th>
                  <th className="p-2 text-right font-medium">Stok</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((p, i) => {
                  const vat = Number(p.vatRate) || 0
                  const net = p.salePrice != null ? Number(p.salePrice) : null
                  const gross = net != null ? net * (1 + vat / 100) : null
                  const perWh = (stocksByProduct.get(p.id) ?? []).filter((s) => s.quantity !== 0)
                  const total = Number(p.stockQuantity ?? 0)
                  return (
                    <tr key={p.id} className={cn(i === 0 && "bg-kobipo-blue/5 dark:bg-primary/10")}>
                      <td className="p-2">
                        <div className="font-medium">{p.name}</div>
                        {(p.code || p.barcode) && (
                          <div className="font-mono text-[11px] text-muted-foreground">
                            {[p.code, p.barcode ? `⌷ ${p.barcode}` : null].filter(Boolean).join("  ")}
                          </div>
                        )}
                      </td>
                      <td className="whitespace-nowrap p-2 text-right">
                        {gross != null ? (
                          <>
                            <div className="text-base font-bold tabular-nums text-kobipo-blue dark:text-primary">
                              {formatMoney(gross, p.currency)}
                            </div>
                            <div className="text-[11px] tabular-nums text-muted-foreground">
                              KDV hariç {formatMoney(net!, p.currency)} · %{vat}
                            </div>
                          </>
                        ) : (
                          <span className="text-muted-foreground">Fiyat yok</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap p-2 text-right">
                        {recipeProductIds?.has(p.id) ? (
                          <span className="text-xs text-muted-foreground">Reçeteli — stok tutulmaz</span>
                        ) : (
                          <>
                            <div
                              className={cn(
                                "font-semibold tabular-nums",
                                total <= 0 && "text-amber-600 dark:text-amber-400"
                              )}
                            >
                              {qtyFmt(total)} {p.unit ?? ""}
                            </div>
                            {warehouses.length > 1 && perWh.length > 0 && (
                              <div className="text-[11px] text-muted-foreground">
                                {perWh
                                  .map((s) => `${whName.get(s.warehouseId) ?? "Depo"} ${qtyFmt(s.quantity)}`)
                                  .join(" · ")}
                              </div>
                            )}
                          </>
                        )}
                      </td>
                      <td className="p-2 text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1"
                          onClick={() => {
                            onAdd(p)
                            onOpenChange(false)
                          }}
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Sepete ekle
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
