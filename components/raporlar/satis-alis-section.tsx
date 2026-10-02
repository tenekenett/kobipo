"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { trMatcher } from "@/lib/text/tr-fold"
import { useClassificationLabels, useCustomers, useSuppliers } from "@/lib/swr/use-company-data"
import {
  CariFilterSelect,
  CariFocusBanner,
  PeriodFilter,
  ReportFilterPanel,
} from "@/components/raporlar/cari-filtre"
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
import { BelgeLink, CariLink, ProductLink } from "@/components/raporlar/rapor-link"
import { AlertTriangle, ArrowLeft, Search } from "lucide-react"
import { withCompanyHref } from "@/lib/company/href"
import { describeLineTotalGap } from "@/lib/raporlar/satis-alis-shared"
import { defaultReportRange } from "@/lib/raporlar/date-range"
import type {
  SalesPurchaseInvoice,
  SalesPurchaseInvoiceLine,
  SalesPurchaseKind,
  SalesPurchaseProduct,
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

/** Ekranda tek satırda gösterilen iki tanım: "Bayi · Marmara". */
const classText = (class1: string, class2: string) => [class1, class2].filter(Boolean).join(" · ")

/**
 * Tablo satırı çok uzayabilir (bir yılın tüm kalemleri). Tarayıcıyı kilitlemek
 * yerine görünen satır sayısı sınırlanır; ÖZET rakamlar tüm veriden hesaplanır ve
 * kullanıcı kırpmayı açıkça görür.
 */
const ROW_CAP: Record<string, number> = { faturalar: 500, kalemler: 1000, urunler: 1000 }

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
  const { labels: classLabels } = useClassificationLabels(companyId)
  const [report, setReport] = useState<SalesPurchaseResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  // Üst rapordan gelinmişse dönem URL'de taşınır; doğrudan açıldıysa varsayılan
  // ORADAKİYLE aynı olmalı (son 30 gün), yoksa aynı bağlantı iki farklı aralık gösterir.
  const [startDate, setStartDate] = useState(
    () => searchParams.get("startDate") ?? defaultReportRange().startDate
  )
  const [endDate, setEndDate] = useState(
    () => searchParams.get("endDate") ?? defaultReportRange().endDate
  )
  // Sınıflandırma süzgeci de karttan taşınır; alt sayfa aynı kesiti gösterir.
  const class1Id = searchParams.get("class1Id") ?? ""
  const class2Id = searchParams.get("class2Id") ?? ""
  // Tek cari (satışta müşteri, alışta tedarikçi) — üst rapordaki seçiciden
  // gelir, burada da değiştirilebilir (dönem gibi: URL yalnız açılış değeridir).
  const [partyId, setPartyId] = useState(() => searchParams.get("partyId") ?? "")
  const { customers } = useCustomers(isSales ? companyId : null)
  const { suppliers } = useSuppliers(isSales ? null : companyId)
  const partyOptions = isSales ? customers : suppliers
  const partyKind = isSales ? "customer" : "supplier"
  const partyName = useMemo(
    () => partyOptions.find((c) => c.id === partyId)?.name ?? null,
    [partyOptions, partyId]
  )

  const fetchReport = useCallback(async () => {
    if (!companyId) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({ companyId, type: kind })
      if (startDate) params.set("startDate", startDate)
      if (endDate) params.set("endDate", endDate)
      if (section.needsLines) params.set("includeLines", "1")
      if (section.needsProducts) params.set("includeProducts", "1")
      if (class1Id) params.set("class1Id", class1Id)
      if (class2Id) params.set("class2Id", class2Id)
      if (partyId) params.set("partyId", partyId)
      const res = await fetch(`/api/raporlar/satis-alis?${params}`, { cache: "no-store" })
      if (!res.ok) throw new Error(await res.text())
      setReport(await res.json())
    } catch (error) {
      console.error("Satış/alış rapor bölümü alınamadı:", error)
      setReport(null)
    } finally {
      setIsLoading(false)
    }
  }, [companyId, kind, startDate, endDate, section.needsLines, section.needsProducts, class1Id, class2Id, partyId])

  useEffect(() => {
    void fetchReport()
  }, [fetchReport])

  // Link'ler detay sayfasına "geri" yolunu taşır: kullanıcı listesine değil,
  // geldiği rapor bölümüne dönsün.
  const backTo = `${reportBasePath(kind)}/${section.slug}`
  const cariKind = isSales ? ("customer" as const) : ("supplier" as const)

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
        cell: (row) => (
          <CariLink companyId={companyId} kind={cariKind} cariRef={row.ref} from={backTo}>
            {row.name}
          </CariLink>
        ),
        total: () => "Toplam",
      },
      { header: classLabels.class1, cell: (row) => row.class1 || "—" },
      { header: classLabels.class2, cell: (row) => row.class2 || "—" },
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
    [isSales, classLabels, companyId, cariKind, backTo]
  )

  const classGroupColumns: Col<SalesPurchaseResult["classGroups"][number]>[] = useMemo(
    () => [
      // Tanımsız cari "—" satırında toplanır: kaç TL'nin sınıflandırılmadığı görünür.
      { header: classLabels.class1, cell: (row) => row.class1 || "—", total: () => "Toplam" },
      { header: classLabels.class2, cell: (row) => row.class2 || "—" },
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
    [classLabels]
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
          <BelgeLink
            companyId={companyId}
            belgeId={row.id}
            isReceipt={row.isReceipt}
            from={backTo}
          >
            {row.invoiceNo}
          </BelgeLink>
        ),
      },
      {
        header: isSales ? "Müşteri" : "Tedarikçi",
        cell: (row) => (
          <CariLink
            companyId={companyId}
            kind={cariKind}
            cariRef={row.counterpartyRef}
            from={backTo}
          >
            {row.counterpartyName}
          </CariLink>
        ),
      },
      { header: classLabels.class1, cell: (row) => row.class1 || "—" },
      { header: classLabels.class2, cell: (row) => row.class2 || "—" },
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
    [isSales, classLabels, companyId, cariKind, backTo]
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
          <BelgeLink
            companyId={companyId}
            belgeId={row.invoiceId}
            isReceipt={row.isReceipt}
            from={backTo}
          >
            {row.invoiceNo}
          </BelgeLink>
        ),
      },
      // GİB'e giden asıl numara; fatura no'dan farklı olabilir.
      { header: "e-Belge No", cell: (row) => row.eDocumentNo || "—" },
      {
        header: isSales ? "Müşteri" : "Tedarikçi",
        cell: (row) => (
          <CariLink
            companyId={companyId}
            kind={cariKind}
            cariRef={row.counterpartyRef}
            from={backTo}
          >
            {row.counterpartyName}
          </CariLink>
        ),
      },
      // Tanımlar (Ayarlar → Tanımlar) Excel'de vardı, ekranda YOKTU: aynı bölümün
      // ekranı ile dosyası ayrışıyordu. Belge ve İskonto da aynı sebeple eklendi.
      { header: classLabels.class1, cell: (row) => row.class1 || "—" },
      { header: classLabels.class2, cell: (row) => row.class2 || "—" },
      { header: "Belge", cell: (row) => (row.isReturn ? "İade" : isSales ? "Satış" : "Alış") },
      {
        header: "Stok Kodu",
        cell: (row) =>
          row.productCode ? (
            <ProductLink companyId={companyId} productRef={row.productRef}>
              {row.productCode}
            </ProductLink>
          ) : (
            "—"
          ),
      },
      {
        // Serbest kalem bir ürün kartına bağlı değildir: adı düz metin kalır.
        header: "Stok / Hizmet",
        cell: (row) => (
          <ProductLink companyId={companyId} productRef={row.productRef}>
            {row.description}
          </ProductLink>
        ),
      },
      { header: "Tür", cell: (row) => row.kind },
      {
        header: "Miktar",
        align: "right",
        cell: (row) => `${fmtQty(row.quantity)} ${row.unit}`,
      },
      { header: "Birim Fiyat", align: "right", cell: (row) => TL(row.unitPrice) },
      {
        header: "Satır İskontosu",
        align: "right",
        cell: (row) => TL(row.discountAmount),
        total: (rows) => TL(rows.reduce((sum, row) => sum + row.discountAmount, 0)),
      },
      {
        // Fatura altı iskontonun bu satıra düşen payı (ilavede eksi). KDV ve satır
        // toplamı bu pay düşülmüş belgedeki tutarlardır (lib/raporlar/fatura-alti.ts).
        header: "Fatura Altı İsk.",
        align: "right",
        cell: (row) => TL(row.globalDiscountShare),
        total: (rows) => TL(rows.reduce((sum, row) => sum + row.globalDiscountShare, 0)),
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
    [isSales, classLabels, companyId, cariKind, backTo]
  )

  const productColumns: Col<SalesPurchaseProduct>[] = useMemo(
    () => [
      {
        header: "Stok Kodu",
        cell: (row) =>
          row.productCode ? (
            <ProductLink companyId={companyId} productRef={row.productRef}>
              {row.productCode}
            </ProductLink>
          ) : (
            "—"
          ),
        total: () => "Toplam",
      },
      {
        // Serbest kalem bir ürün kartına bağlı değildir: adı düz metin kalır.
        header: "Ürün / Hizmet",
        cell: (row) => (
          <ProductLink companyId={companyId} productRef={row.productRef}>
            {row.name}
          </ProductLink>
        ),
      },
      { header: "Tür", cell: (row) => row.kind },
      // Miktarın toplamı YOK: farklı birimler (kg, adet) toplanamaz.
      { header: "Miktar", align: "right", cell: (row) => `${fmtQty(row.quantity)} ${row.unit}` },
      {
        header: "Ort. Birim Fiyat",
        align: "right",
        cell: (row) => (row.avgUnitPrice == null ? "—" : TL(row.avgUnitPrice)),
      },
      {
        header: "Son Alış Fiyatı",
        align: "right",
        cell: (row) => (row.lastUnitPrice == null ? "—" : TL(row.lastUnitPrice)),
      },
      {
        header: "Son Alış",
        cell: (row) => (row.lastDate ? new Date(row.lastDate).toLocaleDateString("tr-TR") : "—"),
      },
      // Tek tedarikçiye süzülmüşken iki sütun da hep aynı cevabı verir.
      ...(partyId
        ? []
        : ([
            { header: "Son Tedarikçi", cell: (row) => row.lastCounterpartyName || "—" },
            { header: "Tedarikçi Sayısı", align: "right", cell: (row) => row.counterpartyCount },
          ] satisfies Col<SalesPurchaseProduct>[])),
      { header: "Belge", align: "right", cell: (row) => row.invoiceCount },
      {
        header: "Tutar (KDV Hariç)",
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
        header: "Toplam (KDV Dahil)",
        align: "right",
        cell: (row) => TL(row.totalAmount),
        total: (rows) => TL(rows.reduce((sum, row) => sum + row.totalAmount, 0)),
      },
    ],
    [companyId, partyId]
  )

  // Ürün listesi uzun olabilir: ad/kod araması (Türkçe duyarsız). Toplam satırı
  // ARANAN satırların toplamıdır — "bu ürünlere ne ödedim" sorusu.
  const [productSearch, setProductSearch] = useState("")
  const productRows = useMemo(() => {
    const rows = report?.products ?? []
    if (!productSearch.trim()) return rows
    const matches = trMatcher(productSearch)
    return rows.filter((row) => matches(row.name, row.productCode))
  }, [report, productSearch])

  const table = (() => {
    switch (section.key) {
      case "urunler":
        return { columns: productColumns, rows: productRows }
      case "aylik":
        return { columns: monthlyColumns, rows: report?.monthly ?? [] }
      case "cariler":
        return { columns: counterpartyColumns, rows: report?.topCounterparties ?? [] }
      case "siniflandirma":
        return { columns: classGroupColumns, rows: report?.classGroups ?? [] }
      case "faturalar":
        return { columns: invoiceColumns, rows: report?.invoices ?? [] }
      case "kalemler":
        return { columns: lineColumns, rows: report?.lines ?? [] }
    }
  })() as { columns: Col<unknown>[]; rows: unknown[] }

  // Kalem toplamı ile fatura toplamı arasındaki fark AÇIKLANIR (belge yuvarlaması,
  // kalemleriyle uyuşmayan belge, kuruş); söylenmezse "rakamlar tutmuyor" denir.
  // Yalnız kalemlerin ÇEKİLDİĞİ bölümde anlamlı; fark yoksa hiç basılmaz.
  const totalGap = useMemo(
    () =>
      report && (section.needsLines || (section.needsProducts && !productSearch.trim()))
        ? describeLineTotalGap(report)
        : null,
    [report, section.needsLines, section.needsProducts, productSearch]
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
            params={{ startDate, endDate, section: section.key, class1Id, class2Id, partyId }}
          />
          <Link href={withCompanyHref(reportBasePath(kind), companyId)}>
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              {isSales ? "Satış raporu" : "Alış raporu"}
            </Button>
          </Link>
        </div>
      </div>

      <ReportFilterPanel
        activeCount={partyId ? 1 : 0}
        onClear={() => setPartyId("")}
        onRefresh={fetchReport}
        refreshing={isLoading}
      >
        <div className="grid gap-4 md:grid-cols-2 xl:max-w-4xl xl:items-start">
          <CariFilterSelect
            id="bolum-cari"
            kind={partyKind}
            options={partyOptions}
            value={partyId}
            onChange={setPartyId}
          />
          <PeriodFilter
            idPrefix="bolum"
            startDate={startDate}
            endDate={endDate}
            onChange={(range) => {
              setStartDate(range.startDate)
              setEndDate(range.endDate)
            }}
            allowAll
          />
        </div>
      </ReportFilterPanel>

      {/* Sayfa tek cariye süzülmüşse söylenir: "neden bu kadar az fatura var"
          sorusu doğmasın. */}
      {partyId && (
        <CariFocusBanner
          companyId={companyId}
          kind={partyKind}
          cariId={partyId}
          name={partyName}
          from={isSales ? "/raporlar/satis" : "/raporlar/alis"}
          description="Bu bölüm ve dosyası yalnız bu carinin belgelerinden kurulur."
          onClear={() => setPartyId("")}
        />
      )}

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
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
          <div>
            <CardTitle>{section.title}</CardTitle>
            <CardDescription>
              {isTruncated
                ? `${table.rows.length} satırın ilk ${visibleRows.length} tanesi listeleniyor — dönemi daraltın ya da dosyaya aktarın. Alttaki toplam TÜM satırları kapsar.`
                : `${table.rows.length} satır`}
            </CardDescription>
          </div>
          {section.key === "urunler" && (
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Ürün adı veya kodu ara…"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                className="pl-8"
              />
            </div>
          )}
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
