"use client"

import { Fragment, useCallback, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronRight, Info, Minus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ExportButton } from "@/components/export/export-button"
import { BelgeLink, CariLink } from "@/components/raporlar/rapor-link"
import type { BreakdownRow } from "@/lib/raporlar/gelir-gider-kirilim"
import type { ExpenseReportResult } from "@/lib/raporlar/harcamalar"
import { percentChange } from "@/lib/raporlar/donem"
import { toDateInput } from "@/lib/format"

const money = (value: number) =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(value)

const shortDate = (iso: string) =>
  new Intl.DateTimeFormat("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(
    new Date(iso)
  )

/**
 * KATEGORİ AĞACI. Ana kategoriler kapalı açılır; alt kategorisi olmayan satırın
 * ok işareti hiç çizilmez — tıklanabilir görünüp hiçbir şey açmayan bir düğme,
 * kullanıcıya "veri eksik" dedirtirdi.
 *
 * Ana satıra tıklamak listeyi o kategoriye SÜZER: ağaç "ne kadar" der, defter
 * "neye"; ikisi arasındaki köprü bu.
 */
function CategoryTree({
  tree,
  activeCategory,
  onSelect,
}: {
  tree: ExpenseReportResult["tree"]
  activeCategory: string | null
  onSelect: (category: string | null) => void
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  if (tree.groups.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Bu dönemde harcama yok.</p>
  }

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Kategori</TableHead>
            <TableHead className="text-right">Tutar</TableHead>
            <TableHead className="text-right">Pay</TableHead>
            <TableHead className="text-right">Kalem</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tree.groups.map((group) => {
            const isOpen = expanded.has(group.key)
            const hasChildren = group.children.length > 0
            const isActive = activeCategory === group.key
            return (
              // Anahtar FRAGMENT'te: dizinin elemanı o, `TableRow` değil. Satırda
              // kalsaydı React her açılıp kapanmada listeyi yeniden kurardı.
              <Fragment key={group.key}>
                <TableRow
                  className={`cursor-pointer ${isActive ? "bg-kobipo-pale/60 dark:bg-muted" : ""}`}
                  onClick={() => onSelect(isActive ? null : group.key)}
                >
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      {hasChildren ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            // Ok, satırın süzgeç tıklamasını TETİKLEMEZ: açmak ile
                            // süzmek iki ayrı niyet.
                            event.stopPropagation()
                            toggle(group.key)
                          }}
                          className="rounded p-0.5 hover:bg-muted"
                          aria-label={isOpen ? "Alt kategorileri gizle" : "Alt kategorileri göster"}
                        >
                          {isOpen ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                      ) : (
                        <span className="w-5" aria-hidden />
                      )}
                      <span className="font-medium">{group.label}</span>
                    </div>
                    <span
                      className="ml-6 mt-1 block h-1 rounded-full bg-kobipo-blue/30"
                      style={{ width: `${Math.max(group.sharePct, 2)}%` }}
                      aria-hidden
                    />
                  </TableCell>
                  <TableCell className="text-right font-medium">{money(group.amount)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    %{group.sharePct.toFixed(1)}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">{group.count}</TableCell>
                </TableRow>
                {isOpen &&
                  group.children.map((child) => (
                    <TableRow key={child.key} className="bg-muted/30">
                      <TableCell className="pl-12 text-sm">{child.label}</TableCell>
                      <TableCell className="text-right text-sm">{money(child.amount)}</TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        %{child.sharePct.toFixed(1)}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {child.count}
                      </TableCell>
                    </TableRow>
                  ))}
              </Fragment>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

/** Tedarikçi / etiket / ay kırılımlarının ortak tablosu — hepsi gider tarafı. */
function SimpleBreakdown({
  rows,
  companyId,
  emptyText,
  linkParties,
}: {
  rows: BreakdownRow[]
  companyId: string
  emptyText: string
  linkParties?: boolean
}) {
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{emptyText}</p>
  }
  const scale = Math.max(...rows.map((row) => Math.abs(row.expense)), 0)

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Kalem</TableHead>
            <TableHead className="text-right">Tutar</TableHead>
            <TableHead className="text-right">Belge</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={`${row.key}-${row.label}`}>
              <TableCell>
                {linkParties && row.ref && row.kind ? (
                  <CariLink
                    kind={row.kind}
                    cariRef={row.ref}
                    companyId={companyId}
                    from="/raporlar/harcamalar"
                    className="font-medium"
                  >
                    {row.label}
                  </CariLink>
                ) : (
                  <span className="font-medium">{row.label}</span>
                )}
                <span
                  className="mt-1 block h-1 rounded-full bg-kobipo-blue/30"
                  style={{
                    width: `${Math.max(scale > 0 ? (Math.abs(row.expense) / scale) * 100 : 0, 2)}%`,
                  }}
                  aria-hidden
                />
              </TableCell>
              <TableCell className="text-right">{money(row.expense)}</TableCell>
              <TableCell className="text-right text-muted-foreground">{row.count}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export default function HarcamalarPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const [report, setReport] = useState<ExpenseReportResult | null>(null)
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [category, setCategory] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!companyId) return
    // Harcamalar YILBAŞINDAN BUGÜNE açılır (mali tablolarla aynı varsayılan);
    // gün `toDateInput` ile yazılır, `toISOString()` UTC'ye kayıyor.
    const now = new Date()
    setStartDate(toDateInput(new Date(now.getFullYear(), 0, 1)))
    setEndDate(toDateInput(now))
  }, [companyId])

  const fetchReport = useCallback(async () => {
    if (!companyId || !startDate || !endDate) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({ companyId, startDate, endDate })
      if (category) params.set("category", category)
      const response = await fetch(`/api/raporlar/harcamalar?${params}`)
      if (response.ok) setReport(await response.json())
    } catch (error) {
      console.error("Harcamalar raporu alınamadı:", error)
    } finally {
      setIsLoading(false)
    }
  }, [companyId, startDate, endDate, category])

  useEffect(() => {
    fetchReport()
  }, [fetchReport])

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Harcamalar Raporu</CardTitle>
          <CardDescription>Firma seçiniz</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const delta = report ? percentChange(report.totals.total, report.previousTotal) : null
  const DeltaIcon = delta == null ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight
  // Giderde ARTIŞ kötüdür — renk mantığı ciro kartlarının TERSİ.
  const deltaClass =
    delta == null || delta === 0
      ? "text-muted-foreground"
      : delta > 0
        ? "text-red-600 dark:text-red-400"
        : "text-green-600 dark:text-green-400"

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Harcamalar Raporu</CardTitle>
          <CardDescription>
            Alış faturaları ve faturasız giderler tek yerde; kategori ağacı ve kalem kalem
            döküm. Tutarlar KDV hariçtir, alış iadeleri düşülmüştür.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-wrap gap-4">
            <div className="space-y-2">
              <Label>Başlangıç Tarihi</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Bitiş Tarihi</Label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={fetchReport} disabled={isLoading}>
                {isLoading ? "Yükleniyor..." : "Raporu Getir"}
              </Button>
              <ExportButton
                dataset="rapor-harcamalar"
                companyId={companyId}
                size="default"
                params={{ startDate, endDate, category }}
                disabled={!report}
              />
            </div>
          </div>

          {category && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Süzgeç:</span>
              <button
                type="button"
                onClick={() => setCategory(null)}
                className="inline-flex items-center gap-1 rounded-full border px-3 py-1 font-medium hover:bg-muted"
              >
                {category}
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {report && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">Toplam Gider</p>
                  <p className="text-2xl font-bold">{money(report.totals.total)}</p>
                  {delta !== null && (
                    <p className={`mt-1 flex items-center gap-1 text-xs ${deltaClass}`}>
                      <DeltaIcon className="h-3 w-3" />
                      {Math.abs(delta).toFixed(1)}%
                      <span className="text-muted-foreground">önceki döneme göre</span>
                    </p>
                  )}
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">Aylık Ortalama</p>
                  <p className="text-2xl font-bold">{money(report.totals.monthlyAverage)}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">Faturalı</p>
                  <p className="text-2xl font-bold">{money(report.totals.invoiced)}</p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">Faturasız</p>
                  <p className="text-2xl font-bold">{money(report.totals.uninvoiced)}</p>
                </div>
              </div>

              {report.uncategorizedCount > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <p className="text-amber-900 dark:text-amber-200">
                    <strong>{report.uncategorizedCount}</strong> harcamada kategori yok.
                    Kategoriyi <code className="rounded bg-amber-100 px-1 dark:bg-amber-900">
                      Personel &gt; Maaş
                    </code>{" "}
                    biçiminde yazarsanız ana ve alt kırılım kendiliğinden oluşur.
                  </p>
                </div>
              )}

              <Tabs defaultValue="kategori">
                <TabsList>
                  <TabsTrigger value="kategori">Kategori</TabsTrigger>
                  <TabsTrigger value="tedarikci">Tedarikçi</TabsTrigger>
                  <TabsTrigger value="etiket">Etiket</TabsTrigger>
                  <TabsTrigger value="ay">Aylık</TabsTrigger>
                  <TabsTrigger value="defter">Defter</TabsTrigger>
                </TabsList>

                <TabsContent value="kategori" className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Satıra tıklayarak listeyi o kategoriye süzebilirsiniz.
                  </p>
                  <CategoryTree
                    tree={report.tree}
                    activeCategory={category}
                    onSelect={setCategory}
                  />
                </TabsContent>

                <TabsContent value="tedarikci">
                  <SimpleBreakdown
                    rows={report.bySupplier}
                    companyId={companyId}
                    emptyText="Bu dönemde tedarikçiye bağlı harcama yok."
                    linkParties
                  />
                </TabsContent>

                <TabsContent value="etiket" className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Bir belge birden çok etikete girebilir — satır toplamı genel toplamı aşabilir.
                  </p>
                  <SimpleBreakdown
                    rows={report.byTag}
                    companyId={companyId}
                    emptyText="Bu dönemde etiketli harcama yok."
                  />
                </TabsContent>

                <TabsContent value="ay">
                  <SimpleBreakdown
                    rows={report.byMonth}
                    companyId={companyId}
                    emptyText="Bu dönemde harcama yok."
                  />
                </TabsContent>

                <TabsContent value="defter" className="space-y-2">
                  {report.truncated && (
                    <p className="text-xs text-muted-foreground">
                      {report.totals.count} harcamanın ilk {report.rows.length} tanesi
                      gösteriliyor; tamamı dışa aktarılan dosyada.
                    </p>
                  )}
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Tarih</TableHead>
                          <TableHead>Belge / Açıklama</TableHead>
                          <TableHead>Tedarikçi</TableHead>
                          <TableHead>Kategori</TableHead>
                          <TableHead className="text-right">Tutar</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {report.rows.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                              Bu dönemde harcama yok.
                            </TableCell>
                          </TableRow>
                        )}
                        {report.rows.map((row) => (
                          <TableRow key={`${row.kind}-${row.id}`}>
                            <TableCell className="whitespace-nowrap">{shortDate(row.date)}</TableCell>
                            <TableCell>
                              {/* Faturasız gider bir belgeye bağlı değildir; adı
                                  düz metin kalır (bkz. rapor-link.tsx). */}
                              {row.documentRef ? (
                                <BelgeLink
                                  belgeId={row.documentRef}
                                  isReceipt={row.isReceipt}
                                  companyId={companyId}
                                  from="/raporlar/harcamalar"
                                >
                                  {row.label}
                                </BelgeLink>
                              ) : (
                                row.label
                              )}
                              {row.isReturn && (
                                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">
                                  iade
                                </span>
                              )}
                            </TableCell>
                            <TableCell>
                              {row.supplierRef ? (
                                <CariLink
                                  kind="supplier"
                                  cariRef={row.supplierRef}
                                  companyId={companyId}
                                  from="/raporlar/harcamalar"
                                >
                                  {row.supplierName}
                                </CariLink>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {row.category ?? "—"}
                            </TableCell>
                            <TableCell
                              className={`text-right font-medium ${
                                row.amount < 0 ? "text-green-600 dark:text-green-400" : ""
                              }`}
                            >
                              {money(row.amount)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>
              </Tabs>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
