"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ExportButton } from "@/components/export/export-button"
import { AlertTriangle, ArrowLeft } from "lucide-react"
import { withCompanyHref } from "@/lib/company/href"
import { describeLineTotalGap } from "@/lib/raporlar/satis-alis-shared"
import type {
  SalesPurchaseInvoice,
  SalesPurchaseInvoiceLine,
  SalesPurchaseKind,
  SalesPurchaseResult,
} from "@/lib/raporlar/satis-alis"
import { reportBasePath, type SalesPurchaseSection } from "@/lib/raporlar/satis-alis-sections"

/**
 * Satış / alış raporunun BİR bölümünün alt sayfası.
 *
 * Dört bölüm (aylık, cariler, faturalar, kalemler) tek gövdeyi paylaşır: hepsi
 * aynı ucu (`/api/raporlar/satis-alis`) aynı tarih aralığıyla çağırır, yalnız
 * çizdikleri tablo değişir. Bölüm başına ayrı sayfa yazılsaydı satışa eklenen bir
 * sütun alışta ya da özet ekranda eksik kalırdı — özet ekranın kartları da aynı
 * bölüm listesinden (`lib/raporlar/satis-alis-sections.ts`) doğuyor.
 *
 * Tarih aralığı URL'den okunur: özet ekrandaki kart linki o an seçili dönemi
 * taşır, kullanıcı alt sayfada aralığı yeniden kurmak zorunda kalmaz.
 */

const TL = (value: number) =>
  `₺${value.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const fmtQty = (value: number) =>
  value.toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 4 })

const isoDay = (date: Date) => date.toISOString().split("T")[0]

/** Ekranda tek satırda gösterilen iki tanım: "Bayi · Marmara". */
const classText = (class1: string, class2: string) => [class1, class2].filter(Boolean).join(" · ")

/**
 * Tablo satırı çok uzayabilir (bir yılın tüm kalemleri). Tarayıcıyı kilitlemek
 * yerine görünen satır sayısı sınırlanır; ÖZET rakamlar tüm veriden hesaplanır ve
 * kullanıcı kırpmayı açıkça görür.
 */
const ROW_CAP: Record<string, number> = { faturalar: 500, kalemler: 1000 }

type Col<T> = {
  header: string
  align?: "right"
  cell: (row: T) => ReactNode
  /** Toplam satırındaki hücre. Verilmezse boş kalır. */
  total?: (rows: T[]) => ReactNode
}

type Props = {
  kind: SalesPurchaseKind
  companyId: string
  section: SalesPurchaseSection
}

export function SatisAlisSection({ kind, companyId, section }: Props) {
  const isSales = kind === "SALES"
  const searchParams = useSearchParams()
  const [report, setReport] = useState<SalesPurchaseResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [startDate, setStartDate] = useState(
    () => searchParams.get("startDate") ?? isoDay(new Date(new Date().getFullYear(), 0, 1))
  )
  const [endDate, setEndDate] = useState(() => searchParams.get("endDate") ?? isoDay(new Date()))

  const fetchReport = useCallback(async () => {
    if (!companyId) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({ companyId, type: kind })
      if (startDate) params.set("startDate", startDate)
      if (endDate) params.set("endDate", endDate)
      if (section.needsLines) params.set("includeLines", "1")
      const res = await fetch(`/api/raporlar/satis-alis?${params}`, { cache: "no-store" })
      if (!res.ok) throw new Error(await res.text())
      setReport(await res.json())
    } catch (error) {
      console.error("Satış/alış rapor bölümü alınamadı:", error)
      setReport(null)
    } finally {
      setIsLoading(false)
    }
  }, [companyId, kind, startDate, endDate, section.needsLines])

  useEffect(() => {
    void fetchReport()
  }, [fetchReport])

  const invoiceHref = useCallback(
    (invoiceId: string) =>
      withCompanyHref(
        `/faturalar/${invoiceId}/onizleme?from=${encodeURIComponent(
          `${reportBasePath(kind)}/${section.slug}`
        )}`,
        companyId
      ),
    [companyId, kind, section.slug]
  )

  const monthlyColumns: Col<SalesPurchaseResult["monthly"][number]>[] = useMemo(
    () => [
      { header: "Dönem", cell: (row) => row.label, total: () => "Toplam" },
      {
        header: "Fatura Adedi",
        align: "right",
        cell: (row) => row.count,
        total: (rows) => rows.reduce((sum, row) => sum + row.count, 0),
      },
      {
        header: "Tutar",
        align: "right",
        cell: (row) => TL(row.amount),
        total: (rows) => TL(rows.reduce((sum, row) => sum + row.amount, 0)),
      },
    ],
    []
  )

  const counterpartyColumns: Col<SalesPurchaseResult["topCounterparties"][number]>[] = useMemo(
    () => [
      {
        header: isSales ? "Müşteri" : "Tedarikçi",
        cell: (row) => row.name,
        total: () => "Toplam",
      },
      { header: "Sınıflandırma 1", cell: (row) => row.class1 || "—" },
      { header: "Sınıflandırma 2", cell: (row) => row.class2 || "—" },
      {
        header: "Fatura Adedi",
        align: "right",
        cell: (row) => row.count,
        total: (rows) => rows.reduce((sum, row) => sum + row.count, 0),
      },
      {
        header: "Tutar",
        align: "right",
        cell: (row) => TL(row.amount),
        total: (rows) => TL(rows.reduce((sum, row) => sum + row.amount, 0)),
      },
    ],
    [isSales]
  )

  const invoiceColumns: Col<SalesPurchaseInvoice>[] = useMemo(
    () => [
      {
        header: "Tarih",
        cell: (row) => new Date(row.date).toLocaleDateString("tr-TR"),
        total: () => "Toplam",
      },
      {
        header: "Fatura No",
        cell: (row) => (
          <Link
            href={invoiceHref(row.id)}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            {row.invoiceNo}
          </Link>
        ),
      },
      { header: isSales ? "Müşteri" : "Tedarikçi", cell: (row) => row.counterpartyName },
      { header: "Sınıflandırma 1", cell: (row) => row.class1 || "—" },
      { header: "Sınıflandırma 2", cell: (row) => row.class2 || "—" },
      // İade satırlarının tutarları EKSİ gelir; sütun olmasaydı okuyan kişi
      // negatif rakamı hata sanardı.
      { header: "Belge", cell: (row) => (row.isReturn ? "İade" : isSales ? "Satış" : "Alış") },
      // Excel'de de var; ekranla dosya aynı sütunları göstersin.
      { header: "Durum", cell: (row) => row.statusLabel || "—" },
      {
        header: "Matrah",
        align: "right",
        cell: (row) => TL(row.netAmount),
        total: (rows) => TL(rows.reduce((sum, row) => sum + row.netAmount, 0)),
      },
      {
        header: "KDV",
        align: "right",
        cell: (row) => TL(row.vatAmount),
        total: (rows) => TL(rows.reduce((sum, row) => sum + row.vatAmount, 0)),
      },
      {
        header: "Genel Toplam",
        align: "right",
        cell: (row) => TL(row.totalAmount),
        total: (rows) => TL(rows.reduce((sum, row) => sum + row.totalAmount, 0)),
      },
    ],
    [isSales, invoiceHref]
  )

  const lineColumns: Col<SalesPurchaseInvoiceLine>[] = useMemo(
    () => [
      {
        header: "Tarih",
        cell: (row) => new Date(row.date).toLocaleDateString("tr-TR"),
        total: () => "Toplam",
      },
      {
        header: "Fatura No",
        cell: (row) => (
          <Link
            href={invoiceHref(row.invoiceId)}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            {row.invoiceNo}
          </Link>
        ),
      },
      // GİB'e giden asıl numara; fatura no'dan farklı olabilir.
      { header: "e-Belge No", cell: (row) => row.eDocumentNo || "—" },
      { header: isSales ? "Müşteri" : "Tedarikçi", cell: (row) => row.counterpartyName },
      // Tanımlar (Ayarlar → Tanımlar) Excel'de vardı, ekranda YOKTU: aynı bölümün
      // ekranı ile dosyası ayrışıyordu. Belge ve İskonto da aynı sebeple eklendi.
      { header: "Sınıflandırma 1", cell: (row) => row.class1 || "—" },
      { header: "Sınıflandırma 2", cell: (row) => row.class2 || "—" },
      { header: "Belge", cell: (row) => (row.isReturn ? "İade" : isSales ? "Satış" : "Alış") },
      { header: "Stok Kodu", cell: (row) => row.productCode || "—" },
      { header: "Stok / Hizmet", cell: (row) => row.description },
      { header: "Tür", cell: (row) => row.kind },
      {
        header: "Miktar",
        align: "right",
        cell: (row) => `${fmtQty(row.quantity)} ${row.unit}`,
      },
      { header: "Birim Fiyat", align: "right", cell: (row) => TL(row.unitPrice) },
      {
        header: "İskonto",
        align: "right",
        cell: (row) => TL(row.discountAmount),
        total: (rows) => TL(rows.reduce((sum, row) => sum + row.discountAmount, 0)),
      },
      { header: "KDV %", align: "right", cell: (row) => row.vatRate },
      {
        header: "KDV",
        align: "right",
        cell: (row) => TL(row.vatAmount),
        total: (rows) => TL(rows.reduce((sum, row) => sum + row.vatAmount, 0)),
      },
      {
        header: "Satır Toplamı",
        align: "right",
        cell: (row) => TL(row.totalAmount),
        total: (rows) => TL(rows.reduce((sum, row) => sum + row.totalAmount, 0)),
      },
    ],
    [isSales, invoiceHref]
  )

  const table = (() => {
    switch (section.key) {
      case "aylik":
        return { columns: monthlyColumns, rows: report?.monthly ?? [] }
      case "cariler":
        return { columns: counterpartyColumns, rows: report?.topCounterparties ?? [] }
      case "faturalar":
        return { columns: invoiceColumns, rows: report?.invoices ?? [] }
      case "kalemler":
        return { columns: lineColumns, rows: report?.lines ?? [] }
    }
  })() as { columns: Col<unknown>[]; rows: unknown[] }

  // Kalem toplamı ile fatura toplamı arasındaki fark AÇIKLANIR: fatura geneline
  // uygulanan iskonto kalem satırlarında görünmez, söylenmezse "rakamlar tutmuyor"
  // denir. Yalnız kalemlerin ÇEKİLDİĞİ bölümde anlamlı; fark yoksa hiç basılmaz.
  const totalGap = useMemo(
    () => (report && section.needsLines ? describeLineTotalGap(report) : null),
    [report, section.needsLines]
  )

  const cap = ROW_CAP[section.key]
  const visibleRows = cap ? table.rows.slice(0, cap) : table.rows
  const isTruncated = visibleRows.length < table.rows.length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-kobipo-navy dark:text-foreground">{section.title}</h1>
          <p className="text-sm text-muted-foreground">
            {isSales ? "Satış raporu" : "Alış raporu"} · {section.description}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Dosya EKRANDAKİ bölümü taşır: `section` olmadan dört bölümlük tam rapor
              iniyordu ve "Detaylı Faturalar" düğmesi, kullanıcının baktığı listeyi
              değil raporun tamamını veriyordu. */}
          <ExportButton
            dataset={isSales ? "rapor-satis" : "rapor-alis"}
            companyId={companyId}
            size="default"
            params={{ startDate, endDate, section: section.key }}
          />
          <Link href={withCompanyHref(reportBasePath(kind), companyId)}>
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              {isSales ? "Satış raporu" : "Alış raporu"}
            </Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="bolum-baslangic">Başlangıç tarihi</Label>
            <Input
              id="bolum-baslangic"
              type="date"
              className="w-[170px]"
              value={startDate}
              max={endDate || undefined}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bolum-bitis">Bitiş tarihi</Label>
            <Input
              id="bolum-bitis"
              type="date"
              className="w-[170px]"
              value={endDate}
              min={startDate || undefined}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <Button variant="outline" onClick={fetchReport} disabled={isLoading}>
            {isLoading ? "Yükleniyor…" : "Raporu getir"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setStartDate("")
              setEndDate("")
            }}
            disabled={isLoading || (!startDate && !endDate)}
          >
            Tüm kayıtlar
          </Button>
        </CardContent>
      </Card>

      {totalGap ? (
        <div className="flex gap-2.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <span className="font-medium">Toplam farkı: </span>
            {totalGap.text}
          </p>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{section.title}</CardTitle>
          <CardDescription>
            {isTruncated
              ? `${table.rows.length} satırın ilk ${visibleRows.length} tanesi listeleniyor — dönemi daraltın ya da dosyaya aktarın. Alttaki toplam TÜM satırları kapsar.`
              : `${table.rows.length} satır`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {table.columns.map((col) => (
                    <TableHead key={col.header} className={col.align === "right" ? "text-right" : undefined}>
                      {col.header}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={table.columns.length} className="py-8 text-center text-muted-foreground">
                      Yükleniyor…
                    </TableCell>
                  </TableRow>
                ) : visibleRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={table.columns.length} className="py-8 text-center text-muted-foreground">
                      Bu dönemde kayıt yok
                    </TableCell>
                  </TableRow>
                ) : (
                  visibleRows.map((row, index) => (
                    <TableRow key={index}>
                      {table.columns.map((col) => (
                        <TableCell
                          key={col.header}
                          className={
                            col.align === "right"
                              ? "whitespace-nowrap text-right font-mono tabular-nums"
                              : undefined
                          }
                        >
                          {col.cell(row)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
              {visibleRows.length > 0 ? (
                <TableFooter>
                  <TableRow>
                    {table.columns.map((col) => (
                      <TableCell
                        key={col.header}
                        className={
                          col.align === "right"
                            ? "whitespace-nowrap text-right font-mono font-semibold tabular-nums"
                            : "font-semibold"
                        }
                      >
                        {col.total ? col.total(table.rows) : null}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableFooter>
              ) : null}
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
