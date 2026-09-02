"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { SearchSelect } from "@/components/ui/search-select"
import { ExportButton } from "@/components/export/export-button"
import { ArrowLeft } from "lucide-react"
import {
  useCompanyDefinitions,
  useCustomers,
  useSuppliers, useClassificationLabels } from "@/lib/swr/use-company-data"
import type { StockMovementReport } from "@/lib/raporlar/stok-hareket"
import { defaultReportRange } from "@/lib/raporlar/date-range"

/**
 * Stok hareketleri — stok raporundan ayrılmış kendi sayfası.
 *
 * Süzgeçler tarih, cari (müşteri/tedarikçi) ve cari tanımı (Sınıflandırma 1/2)
 * bazındadır. Hareketin üzerinde cari YOKTUR; kaynak belge (fatura/irsaliye)
 * üzerinden çözülür — bu yüzden cari süzgeci seçilince belgesiz hareketler
 * (sayım, transfer, açılış stoğu) listede görünmez. Bkz. lib/raporlar/stok-hareket.ts
 */

const fmtQty = (value: number) =>
  value.toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 4 })

const fmtMoney = (value: number) =>
  `₺${value.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function StokHareketleriPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")

  const { labels: classLabels } = useClassificationLabels(companyId)
  // Dönem varsayılanı SON 30 GÜN (satış/alış raporlarıyla aynı kural): yılbaşı
  // varsayılanı hem gereğinden geniş bir aralık çekiyor hem de UTC'ye kayıp
  // kutuda bir önceki yılı gösteriyordu.
  const [startDate, setStartDate] = useState(() => defaultReportRange().startDate)
  const [endDate, setEndDate] = useState(() => defaultReportRange().endDate)
  const [customerId, setCustomerId] = useState("")
  const [supplierId, setSupplierId] = useState("")
  const [class1Id, setClass1Id] = useState("")
  const [class2Id, setClass2Id] = useState("")
  const [search, setSearch] = useState("")

  const [report, setReport] = useState<StockMovementReport | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const { customers } = useCustomers(companyId)
  const { suppliers } = useSuppliers(companyId)
  const { definitions: class1Options } = useCompanyDefinitions(companyId, "CLASS_1")
  const { definitions: class2Options } = useCompanyDefinitions(companyId, "CLASS_2")

  const exportParams = {
    startDate,
    endDate,
    customerId,
    supplierId,
    class1Id,
    class2Id,
    search,
  }

  const fetchReport = useCallback(async () => {
    if (!companyId) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({ companyId })
      for (const [key, value] of Object.entries(exportParams)) {
        if (value) params.set(key, String(value))
      }
      const res = await fetch(`/api/raporlar/stok-hareket?${params}`, { cache: "no-store" })
      if (!res.ok) throw new Error(await res.text())
      setReport(await res.json())
    } catch (error) {
      console.error("Stok hareket raporu alınamadı:", error)
      setReport(null)
    } finally {
      setIsLoading(false)
    }
    // exportParams her render'da yeniden kurulur; bağımlılık alanların kendisi.
  }, [companyId, startDate, endDate, customerId, supplierId, class1Id, class2Id, search])

  useEffect(() => {
    void fetchReport()
  }, [fetchReport])

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Stok Hareketleri</CardTitle>
          <CardDescription>Lütfen bir firma seçin</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const rows = report?.rows ?? []

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-kobipo-navy dark:text-foreground">Stok Hareketleri</h1>
          <p className="text-sm text-muted-foreground">
            Tarih, cari ve tanım bazında tüm giriş/çıkış hareketleri
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton
            dataset="rapor-stok-hareket"
            companyId={companyId}
            size="default"
            params={exportParams}
          />
          <Link href={`/raporlar/stok?company=${encodeURIComponent(companyId)}`}>
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Stok raporu
            </Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="hareket-baslangic">Başlangıç tarihi</Label>
            <Input
              id="hareket-baslangic"
              type="date"
              value={startDate}
              max={endDate || undefined}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hareket-bitis">Bitiş tarihi</Label>
            <Input
              id="hareket-bitis"
              type="date"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hareket-musteri">Müşteri</Label>
            <SearchSelect
              id="hareket-musteri"
              options={customers.map((c) => ({ id: c.id, name: c.name }))}
              value={customerId}
              onChange={setCustomerId}
              placeholder="Tüm müşteriler"
              allowClear
              clearLabel="Tüm müşteriler"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hareket-tedarikci">Tedarikçi</Label>
            <SearchSelect
              id="hareket-tedarikci"
              options={suppliers.map((s) => ({ id: s.id, name: s.name }))}
              value={supplierId}
              onChange={setSupplierId}
              placeholder="Tüm tedarikçiler"
              allowClear
              clearLabel="Tüm tedarikçiler"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hareket-sinif1">{classLabels.class1}</Label>
            <SearchSelect
              id="hareket-sinif1"
              options={class1Options.map((d) => ({ id: d.id, name: d.label }))}
              value={class1Id}
              onChange={setClass1Id}
              placeholder="Tüm tanımlar"
              allowClear
              clearLabel="Tüm tanımlar"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hareket-sinif2">{classLabels.class2}</Label>
            <SearchSelect
              id="hareket-sinif2"
              options={class2Options.map((d) => ({ id: d.id, name: d.label }))}
              value={class2Id}
              onChange={setClass2Id}
              placeholder="Tüm tanımlar"
              allowClear
              clearLabel="Tüm tanımlar"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hareket-urun">Ürün</Label>
            <Input
              id="hareket-urun"
              placeholder="Ad, kod veya barkod"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex items-end">
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => {
                setCustomerId("")
                setSupplierId("")
                setClass1Id("")
                setClass2Id("")
                setSearch("")
              }}
              disabled={!customerId && !supplierId && !class1Id && !class2Id && !search}
            >
              Süzgeçleri temizle
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hareket</p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums">{report?.totals.count ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Toplam Giriş</p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-emerald-600">
              {fmtQty(report?.totals.totalIn ?? 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Toplam Çıkış</p>
            <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-rose-600">
              {fmtQty(report?.totals.totalOut ?? 0)}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Hareket listesi</CardTitle>
          <CardDescription>
            {report?.truncated
              ? "İlk 1000 hareket listeleniyor — dönemi daraltın ya da dosyaya aktarın."
              : "Seçili döneme ait tüm hareketler"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tarih</TableHead>
                <TableHead>Hareket</TableHead>
                <TableHead>Ürün</TableHead>
                <TableHead>Depo</TableHead>
                <TableHead>Belge</TableHead>
                <TableHead>Cari</TableHead>
                <TableHead>Sınıflandırma 1</TableHead>
                <TableHead>Sınıflandırma 2</TableHead>
                <TableHead className="text-right">Miktar</TableHead>
                <TableHead className="text-right">Birim Fiyat</TableHead>
                <TableHead className="text-right">Tutar</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={11} className="py-8 text-center text-muted-foreground">
                    Yükleniyor…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={11} className="py-8 text-center text-muted-foreground">
                    Bu süzgeçlerle hareket bulunamadı
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap">
                      {new Date(row.date).toLocaleDateString("tr-TR")}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`rounded px-2 py-1 text-xs ${
                          row.quantity < 0
                            ? "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"
                            : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                        }`}
                      >
                        {row.typeLabel}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/stok/${row.productId}?company=${encodeURIComponent(companyId)}`}
                        className="font-medium text-primary underline-offset-2 hover:underline"
                      >
                        {row.productName}
                      </Link>
                      {row.productCode ? (
                        <p className="text-xs text-muted-foreground">{row.productCode}</p>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.warehouseName || "—"}
                    </TableCell>
                    <TableCell>
                      {/* Faturaya link verilir; irsaliye/adisyon için numara düz metin. */}
                      {row.documentKind === "INVOICE" && row.documentId ? (
                        <Link
                          href={`/faturalar/${row.documentId}/onizleme?company=${encodeURIComponent(
                            companyId
                          )}&from=${encodeURIComponent("/raporlar/stok/hareketler")}`}
                          className="font-medium text-primary underline-offset-2 hover:underline"
                        >
                          {row.documentNo}
                        </Link>
                      ) : (
                        <span className="text-sm text-muted-foreground">{row.documentNo || "—"}</span>
                      )}
                    </TableCell>
                    <TableCell>{row.counterpartyName || "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{row.class1 || "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{row.class2 || "—"}</TableCell>
                    <TableCell
                      className={`text-right font-mono tabular-nums ${
                        row.quantity < 0 ? "text-rose-600" : "text-emerald-600"
                      }`}
                    >
                      {row.quantity > 0 ? "+" : ""}
                      {fmtQty(row.quantity)} {row.unit}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {fmtMoney(row.unitPrice)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {fmtMoney(row.totalAmount)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
