"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { ArrowDownRight, ArrowUpRight, ChevronRight, Package, Search } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ProductLink } from "@/components/raporlar/rapor-link"
import type { SalesPurchaseProduct } from "@/lib/raporlar/satis-alis"
import { trMatcher } from "@/lib/text/tr-fold"
import { cn } from "@/lib/utils"

/**
 * Alış raporunun ANA listesi: dönemde alınan ürünler (kural
 * `lib/raporlar/satis-alis-urunler.ts`). Tablo kartın içinde KAYAR: yükseklik
 * yaklaşık altı satırda sabittir, fazlası kendi kaydırma çubuğuyla aşağıda
 * kalır ve başlık satırı üstte yapışık durur — liste uzadıkça sayfa uzamaz.
 * Toplam satırı ve Excel "Alınan Ürünler" bölüm sayfasındadır.
 *
 * Son alış fiyatı ortalamadan belirgin saparsa (≥ %1) okla işaretlenir: alışta
 * yükselen fiyat kötü haberdir (kırmızı), düşen iyi (yeşil).
 */

/**
 * Kaydırma alanında çizilen satır tavanı. Tavan, binlerce ürünlü firmada
 * tarayıcıyı yormamak için; aşılırsa tam liste düğmesi çıkar.
 */
const MAX_ROWS = 200

const TL = (value: number) =>
  `₺${value.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtQty = (value: number) =>
  value.toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 4 })

/** Son fiyatın ortalamaya göre yüzde farkı; ölçülemiyorsa ya da < %1 ise null. */
function priceDrift(row: SalesPurchaseProduct): number | null {
  if (row.avgUnitPrice == null || row.lastUnitPrice == null || row.avgUnitPrice <= 0) return null
  const pct = ((row.lastUnitPrice - row.avgUnitPrice) / row.avgUnitPrice) * 100
  return Math.abs(pct) < 1 ? null : pct
}

export function AlinanUrunlerKarti({
  companyId,
  products,
  isLoading,
  href,
  byParty,
}: {
  companyId: string
  products: SalesPurchaseProduct[]
  isLoading: boolean
  /** "Alınan Ürünler" bölüm sayfası — dönem ve süzgeçler taşınmış hâli. */
  href: string
  /** Tek tedarikçiye süzülmüş mü — "son tedarikçi" sütunu o zaman düşer. */
  byParty: boolean
}) {
  const [search, setSearch] = useState("")
  const matches = useMemo(() => {
    if (!search.trim()) return products
    const match = trMatcher(search)
    return products.filter((row) => match(row.name, row.productCode))
  }, [products, search])
  const rows = matches.slice(0, MAX_ROWS)

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-kobipo-blue/10 p-2.5 text-kobipo-blue dark:bg-primary/15 dark:text-primary">
            <Package className="h-5 w-5" />
          </span>
          <div>
            <CardTitle>
              <Link
                href={href}
                className="inline-flex items-center gap-1.5 text-primary underline-offset-4 hover:underline"
              >
                Alınan Ürünler
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </CardTitle>
            <CardDescription>
              {byParty ? "Bu tedarikçiden dönemde alınan ürünler" : "Dönemde alınan ürünler"} · tutara göre
              sıralı; iadeler düşülmüş. Fiyatlar KDV hariçtir.
            </CardDescription>
          </div>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Ürün adı veya kodu ara…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Çıplak <table>: ortak Table bileşeni kendi overflow kabını açıyor; yapışık
            başlık en yakın kaydırma kabına tutunduğu için kap burada TEK olmalı.
            432 px ≈ başlık + altı satır. */}
        <div className="max-h-[432px] overflow-auto rounded-lg border">
          <table className="w-full caption-bottom text-sm">
            <TableHeader className="sticky top-0 z-10 bg-muted shadow-[0_1px_0_hsl(var(--border))]">
              <TableRow className="hover:bg-transparent">
                <TableHead>Ürün / Hizmet</TableHead>
                <TableHead className="text-right">Miktar</TableHead>
                <TableHead className="text-right">Ort. Alış Fiyatı</TableHead>
                <TableHead className="text-right">Son Alış Fiyatı</TableHead>
                {!byParty && <TableHead>Son Tedarikçi</TableHead>}
                <TableHead className="text-right">KDV Hariç</TableHead>
                <TableHead className="text-right">Toplam</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && products.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={byParty ? 6 : 7} className="py-8 text-center text-muted-foreground">
                    Yükleniyor…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={byParty ? 6 : 7} className="py-8 text-center text-muted-foreground">
                    {search.trim() ? "Aramaya uyan ürün yok" : "Bu dönemde alınan ürün yok"}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  const drift = priceDrift(row)
                  return (
                    <TableRow key={row.key}>
                      <TableCell className="min-w-[220px]">
                        <p className="font-medium">
                          <ProductLink companyId={companyId} productRef={row.productRef}>
                            {row.name}
                          </ProductLink>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {[row.productCode, row.kind !== "Stok" ? row.kind : null, `${row.invoiceCount} belge`]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                        {fmtQty(row.quantity)} <span className="text-xs text-muted-foreground">{row.unit}</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                        {row.avgUnitPrice == null ? "—" : TL(row.avgUnitPrice)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        <span className="font-mono tabular-nums">
                          {row.lastUnitPrice == null ? "—" : TL(row.lastUnitPrice)}
                        </span>
                        {drift != null && (
                          <span
                            className={cn(
                              "ml-1.5 inline-flex items-center text-[11px] font-semibold",
                              drift > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
                            )}
                            title="Son alış fiyatının dönem ortalamasına göre farkı"
                          >
                            {drift > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                            %{Math.abs(drift).toLocaleString("tr-TR", { maximumFractionDigits: 0 })}
                          </span>
                        )}
                        {row.lastDate && (
                          <p className="text-[11px] text-muted-foreground">
                            {new Date(row.lastDate).toLocaleDateString("tr-TR")}
                          </p>
                        )}
                      </TableCell>
                      {!byParty && (
                        <TableCell className="max-w-[220px]">
                          <p className="truncate text-sm">{row.lastCounterpartyName || "—"}</p>
                          {row.counterpartyCount > 1 && (
                            <p className="text-[11px] text-muted-foreground">
                              {row.counterpartyCount} farklı tedarikçi
                            </p>
                          )}
                        </TableCell>
                      )}
                      <TableCell className="whitespace-nowrap text-right font-mono tabular-nums">
                        {TL(row.netAmount)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono font-semibold tabular-nums">
                        {TL(row.totalAmount)}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </table>
        </div>
        {matches.length > MAX_ROWS && (
          <div className="flex justify-center">
            <Button variant="outline" size="sm" asChild>
              <Link href={href}>
                Tüm ürünler ({matches.length})
                <ChevronRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
