"use client"

// Depo detayı: kart, bu depodaki ürün bakiyeleri (değeriyle) ve bu depoya yazılmış
// son stok hareketleri. Veri tek uçtan: GET /api/depolar/[id].
//
// Değer firma geneli ortalama maliyetle hesaplanır (depo bazlı maliyet yok) ve
// yalnız pozitif bakiyeden kurulur; maliyeti bilinmeyen ürün sayılır, tahmin edilmez.

import { useEffect, useMemo, useRef, useState } from "react"
import { useParams, useSearchParams } from "next/navigation"
import Link from "next/link"
import { AlertTriangle, ArrowLeft, ArrowLeftRight, Boxes, History, MapPin, Package, Search, Wallet } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table"
import {
  StyledTableContainer,
  StyledTableHeaderRow,
  StyledTableHead,
  StyledTableRow,
  EntityCell,
  MonoCell,
} from "@/components/ui/styled-table"
import { TablePagination, usePagedRows } from "@/components/ui/table-pagination"
import { CompanyLink } from "@/components/dashboard/company-link"
import { withCompanyHref } from "@/lib/company/href"
import { formatMoney } from "@/lib/format"
import { trMatcher } from "@/lib/text/tr-fold"

type StockRow = {
  productId: string
  slug: string | null
  code: string | null
  name: string
  unit: string
  category: string | null
  isActive: boolean
  quantity: number
  unitCost: number | null
  value: number | null
}

type MovementRow = {
  id: string
  date: string
  type: string
  label: string
  quantity: number
  description: string | null
  product: { id: string; slug: string | null; name: string; code: string | null; unit: string }
}

type WarehouseDetail = {
  warehouse: {
    id: string
    code: string | null
    name: string
    address: string | null
    city: string | null
    isDefault: boolean
    isActive: boolean
    createdAt: string
  }
  stocks: StockRow[]
  totals: { productCount: number; negativeCount: number; stockValue: number; unvaluedCount: number }
  movements: MovementRow[]
  movementCount: number
  movementsTruncated: boolean
}

const fmtQty = (n: number) =>
  Number(n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 4 })

const TONE_BADGE = {
  in: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
  out: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  flat: "bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300",
} as const

const tone = (q: number) => (q > 0 ? "in" : q < 0 ? "out" : "flat")

export default function DepoDetayPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const id = params.id as string
  const companyId = searchParams.get("company")

  const [data, setData] = useState<WarehouseDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [showZero, setShowZero] = useState(false)
  const requestSeq = useRef(0)

  useEffect(() => {
    if (!companyId || !id) return
    const seq = ++requestSeq.current
    setData(null)
    setError(null)
    fetch(`/api/depolar/${encodeURIComponent(id)}?companyId=${encodeURIComponent(companyId)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (seq !== requestSeq.current) return
        if (!res.ok) setError(body.error || "Depo yüklenemedi")
        else setData(body)
      })
      .catch(() => {
        if (seq === requestSeq.current) setError("Depo yüklenemedi")
      })
  }, [companyId, id])

  const stocks = useMemo(() => {
    if (!data) return []
    const matches = trMatcher(search)
    return data.stocks.filter((s) => (showZero || s.quantity !== 0) && matches(s.name, s.code, s.category))
  }, [data, search, showZero])
  const zeroCount = data ? data.stocks.filter((s) => s.quantity === 0).length : 0

  const pagedStocks = usePagedRows(stocks, { resetKey: `${search}|${showZero}` })
  const pagedMovements = usePagedRows(data?.movements ?? [], { resetKey: id })

  const productHref = (p: { slug: string | null; productId?: string; id?: string }) =>
    withCompanyHref(`/stok/${p.slug || p.productId || p.id}`, companyId)

  const backLink = (
    <CompanyLink href="/depolar">
      <Button variant="ghost" size="icon" aria-label="Depo listesine dön">
        <ArrowLeft className="h-5 w-5" />
      </Button>
    </CompanyLink>
  )

  if (error) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          {backLink}
          <h1 className="text-2xl font-bold">Depo</h1>
        </div>
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">{error}</CardContent>
        </Card>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          {backLink}
          <h1 className="text-2xl font-bold text-muted-foreground">Yükleniyor…</h1>
        </div>
      </div>
    )
  }

  const { warehouse: w, totals } = data
  const place = [w.address, w.city].filter(Boolean).join(" · ")

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          {backLink}
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-bold">{w.name}</h1>
              {w.isDefault && <Badge variant="outline">Ana Depo</Badge>}
              <Badge variant={w.isActive ? "default" : "secondary"}>{w.isActive ? "Aktif" : "Pasif"}</Badge>
            </div>
            <p className="flex flex-wrap items-center gap-x-3 text-sm text-muted-foreground">
              <span>Depo{w.code ? ` | Kod: ${w.code}` : ""}</span>
              {place && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="h-3.5 w-3.5" />
                  {place}
                </span>
              )}
            </p>
          </div>
        </div>
        <CompanyLink href="/stok/transfer">
          <Button variant="outline">
            <ArrowLeftRight className="mr-2 h-4 w-4" />
            Stok Transferi
          </Button>
        </CompanyLink>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Stoklu Ürün</CardTitle>
            <Boxes className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.productCount}</div>
            <p className="text-xs text-muted-foreground">Bakiyesi sıfır olmayan ürün çeşidi</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Stok Değeri</CardTitle>
            <Wallet className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatMoney(totals.stockValue, "TRY")}</div>
            <p className="text-xs text-muted-foreground">
              Ortalama maliyetten, KDV hariç
              {totals.unvaluedCount > 0 && ` · ${totals.unvaluedCount} ürünün maliyeti bilinmiyor`}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Eksi Bakiye</CardTitle>
            <AlertTriangle
              className={`h-4 w-4 ${totals.negativeCount > 0 ? "text-red-600" : "text-muted-foreground"}`}
            />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${totals.negativeCount > 0 ? "text-red-600" : ""}`}>
              {totals.negativeCount}
            </div>
            <p className="text-xs text-muted-foreground">
              {totals.negativeCount > 0 ? "Girişi yapılmadan çıkış görmüş ürün" : "Eksiye düşmüş ürün yok"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Stok Hareketi</CardTitle>
            <History className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.movementCount.toLocaleString("tr-TR")}</div>
            <p className="text-xs text-muted-foreground">
              {data.movements[0]
                ? `Son hareket ${new Date(data.movements[0].date).toLocaleDateString("tr-TR")}`
                : "Bu depoya hareket yazılmamış"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="space-y-3">
          <div>
            <CardTitle>Depodaki Ürünler</CardTitle>
            <CardDescription>
              {stocks.length} ürün
              {!showZero && zeroCount > 0 && ` · bakiyesi sıfır ${zeroCount} ürün gizli`}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Ürün adı, kodu veya kategorisi ara…"
                className="pl-9"
              />
            </div>
            {zeroCount > 0 && (
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={showZero}
                  onChange={(e) => setShowZero(e.target.checked)}
                />
                Sıfır bakiyeleri göster
              </label>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <StyledTableContainer>
            <Table>
              <TableHeader>
                <StyledTableHeaderRow>
                  <StyledTableHead>Kod</StyledTableHead>
                  <StyledTableHead>Ürün</StyledTableHead>
                  <StyledTableHead>Kategori</StyledTableHead>
                  <StyledTableHead className="text-right">Miktar</StyledTableHead>
                  <StyledTableHead className="text-right">Birim Maliyet</StyledTableHead>
                  <StyledTableHead className="text-right">Değer</StyledTableHead>
                </StyledTableHeaderRow>
              </TableHeader>
              <TableBody>
                {stocks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center">
                      <Package className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
                      <p className="text-sm text-muted-foreground">
                        {search.trim() ? "Aramaya uyan ürün yok." : "Bu depoda stok kaydı yok."}
                      </p>
                    </TableCell>
                  </TableRow>
                ) : (
                  pagedStocks.pageRows.map((s, idx) => (
                    <StyledTableRow
                      key={s.productId}
                      index={idx}
                      className="cursor-pointer"
                      href={productHref(s)}
                      hrefLabel={`${s.name} detayı`}
                    >
                      <TableCell><MonoCell value={s.code} /></TableCell>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-1.5">
                          <EntityCell name={s.name} />
                          {!s.isActive && (
                            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                              Pasif
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {s.category ? (
                          <span className="inline-block rounded-full bg-muted px-2 py-0.5 text-xs">{s.category}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell
                        className={`text-right whitespace-nowrap font-semibold ${s.quantity < 0 ? "text-red-600" : ""}`}
                      >
                        {fmtQty(s.quantity)} {s.unit}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {s.unitCost != null ? formatMoney(s.unitCost, "TRY") : "—"}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {s.value != null && s.quantity > 0 ? formatMoney(s.value, "TRY") : "—"}
                      </TableCell>
                    </StyledTableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </StyledTableContainer>
          <TablePagination {...pagedStocks} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Son Stok Hareketleri</CardTitle>
          <CardDescription>
            {data.movementsTruncated
              ? `Bu depoya yazılmış son ${data.movements.length} hareket (toplam ${data.movementCount.toLocaleString("tr-TR")}).`
              : "Bu depoya yazılmış tüm hareketler."}{" "}
            Tüm dönem için{" "}
            <CompanyLink href="/raporlar/stok/hareketler" className="underline underline-offset-2">
              stok hareket raporu
            </CompanyLink>
            .
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StyledTableContainer>
            <Table>
              <TableHeader>
                <StyledTableHeaderRow>
                  <StyledTableHead>Tarih</StyledTableHead>
                  <StyledTableHead>Ürün</StyledTableHead>
                  <StyledTableHead>Hareket</StyledTableHead>
                  <StyledTableHead>Açıklama</StyledTableHead>
                  <StyledTableHead className="text-right">Miktar</StyledTableHead>
                </StyledTableHeaderRow>
              </TableHeader>
              <TableBody>
                {data.movements.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                      Bu depoya henüz stok hareketi yazılmamış.
                    </TableCell>
                  </TableRow>
                ) : (
                  pagedMovements.pageRows.map((m, idx) => (
                    <StyledTableRow key={m.id} index={idx}>
                      <TableCell className="whitespace-nowrap">
                        {new Date(m.date).toLocaleDateString("tr-TR")}
                      </TableCell>
                      <TableCell className="font-medium">
                        <Link href={productHref(m.product)} className="hover:underline underline-offset-2">
                          {m.product.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <span className={`rounded px-2 py-1 text-xs ${TONE_BADGE[tone(m.quantity)]}`}>{m.label}</span>
                      </TableCell>
                      <TableCell className="max-w-[360px] truncate text-muted-foreground" title={m.description || ""}>
                        {m.description || "—"}
                      </TableCell>
                      <TableCell
                        className={`text-right whitespace-nowrap ${
                          m.quantity > 0 ? "text-green-600" : m.quantity < 0 ? "text-red-600" : ""
                        }`}
                      >
                        {m.quantity > 0 ? "+" : m.quantity < 0 ? "−" : ""}
                        {fmtQty(Math.abs(m.quantity))} {m.product.unit}
                      </TableCell>
                    </StyledTableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </StyledTableContainer>
          <TablePagination {...pagedMovements} />
        </CardContent>
      </Card>
    </div>
  )
}
