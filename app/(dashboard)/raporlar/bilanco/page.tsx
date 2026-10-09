"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ExportButton } from "@/components/export/export-button"
import { CompanyLink } from "@/components/dashboard/company-link"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import type { BalanceSheetResult } from "@/lib/raporlar/bilanco"
import { toDateInput } from "@/lib/format"

// Sunucu tipinin KOPYASI değil kendisi (kâr/zarar ekranıyla aynı gerekçe).
// `import type` derlemede silinir — prisma istemciye sızmaz.
type BalanceSheet = BalanceSheetResult

export default function BilancoPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const { selectedCompany } = useDashboardCompany()
  // Muhasebe defteri tutan firmada iki bilanço yan yana durur; hangisinin ne olduğu söylenir.
  const defterVar = Boolean(selectedCompany && !(selectedCompany.disabledModules ?? []).includes("accounting"))
  const [report, setReport] = useState<BalanceSheet | null>(null)
  const [asOfDate, setAsOfDate] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (companyId) {
      // Yerel gün: `toISOString()` UTC'ye kayıyor ve gece 00:00-03:00 arasında
      // bilanço DÜNKÜ tarihe göre çıkıyordu.
      setAsOfDate(toDateInput(new Date()))
    }
  }, [companyId])

  useEffect(() => {
    if (companyId && asOfDate) {
      fetchReport()
    }
  }, [companyId, asOfDate])

  const fetchReport = async () => {
    if (!companyId) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        companyId,
        asOfDate,
      })
      const response = await fetch(`/api/raporlar/bilanco?${params}`)
      if (response.ok) {
        const data = await response.json()
        setReport(data)
      }
    } catch (error) {
      console.error("Error fetching report:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
    }).format(amount)
  }

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Bilanço</CardTitle>
          <CardDescription>Firma seçiniz</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Bilanço</CardTitle>
          <CardDescription>
            Varlık ve yükümlülük durumu — kayıtlarınızdan (kasa, banka, cari, çek/senet, stok) anlık kurulur, muhasebe onayı beklemez.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {defterVar && (
            <p className="mb-4 rounded-xl border border-sky-200 bg-sky-50/70 px-3 py-2 text-sm text-sky-950 dark:border-sky-900/60 dark:bg-sky-950/20 dark:text-sky-100">
              Bu bir yönetim bilançosudur. Resmî Tekdüzen bilançonuz{" "}
              <CompanyLink href="/muhasebe/mali-tablolar" className="font-semibold underline">
                Muhasebe → Bilanço ve Gelir Tablosu
              </CompanyLink>
              &apos;ndadır; o yalnız onaylanmış muhasebe fişlerinden kurulur. Onay bekleyen fiş varken iki rakam farklı görünür.
            </p>
          )}
          <div className="mb-6 flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label>Tarih</Label>
              <Input
                type="date"
                value={asOfDate}
                onChange={(e) => setAsOfDate(e.target.value)}
              />
            </div>
            <div className="flex items-end gap-2">
              <Button onClick={fetchReport} disabled={isLoading}>
                {isLoading ? "Yükleniyor..." : "Raporu Getir"}
              </Button>
              <ExportButton
                dataset="rapor-bilanco"
                companyId={companyId}
                size="default"
                params={{ asOfDate }}
                disabled={!report}
              />
            </div>
          </div>

          {report && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="font-bold text-lg mb-4">Aktifler (Varlıklar)</h3>
                <Table>
                  <TableBody>
                    <TableRow>
                      <TableCell>Nakit ve Bankalar</TableCell>
                      <TableCell className="text-right">{formatCurrency(report.assets.cashAndBanks)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell>Ticari Alacaklar</TableCell>
                      <TableCell className="text-right">{formatCurrency(report.assets.receivables)}</TableCell>
                    </TableRow>
                    {/* Portföydeki çek/senet: cariden düşmüş, kasaya henüz girmemiş. */}
                    {report.assets.checksReceived > 0 && (
                      <TableRow>
                        <TableCell>
                          Alınan Çek ve Senetler
                          <span className="block text-xs text-muted-foreground">Portföyde, tahsil edilmemiş</span>
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(report.assets.checksReceived)}</TableCell>
                      </TableRow>
                    )}
                    {/* Avans satırları yalnız VARSA çizilir: fazla ödeme olmayan
                        firmada her bilançoya sıfırlı satır eklemek gürültüdür. */}
                    {report.assets.supplierAdvances > 0 && (
                      <TableRow>
                        <TableCell>Tedarikçilere Verilen Avanslar</TableCell>
                        <TableCell className="text-right">{formatCurrency(report.assets.supplierAdvances)}</TableCell>
                      </TableRow>
                    )}
                    {report.assets.employeeReceivables > 0 && (
                      <TableRow>
                        <TableCell>
                          Personelden Alacaklar
                          <span className="block text-xs text-muted-foreground">Masraf defterinde fazla ödenen</span>
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(report.assets.employeeReceivables)}</TableCell>
                      </TableRow>
                    )}
                    {report.assets.employeeAdvances > 0 && (
                      <TableRow>
                        <TableCell>
                          Personel Avansları
                          <span className="block text-xs text-muted-foreground">Verilmiş, bordrodan henüz düşülmemiş</span>
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(report.assets.employeeAdvances)}</TableCell>
                      </TableRow>
                    )}
                    {report.assets.partnerReceivables > 0 && (
                      <TableRow>
                        <TableCell>Ortaklardan Alacaklar</TableCell>
                        <TableCell className="text-right">{formatCurrency(report.assets.partnerReceivables)}</TableCell>
                      </TableRow>
                    )}
                    <TableRow>
                      <TableCell>Stoklar</TableCell>
                      <TableCell className="text-right">{formatCurrency(report.assets.inventory)}</TableCell>
                    </TableRow>
                    <TableRow className="bg-muted/50">
                      <TableCell className="font-bold">Toplam Aktifler</TableCell>
                      <TableCell className="text-right font-bold">{formatCurrency(report.assets.total)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
              <div>
                <h3 className="font-bold text-lg mb-4">Pasifler (Yükümlülükler + Öz Sermaye)</h3>
                <Table>
                  <TableBody>
                    <TableRow>
                      <TableCell>Ticari Borçlar</TableCell>
                      <TableCell className="text-right">{formatCurrency(report.liabilities.payables)}</TableCell>
                    </TableRow>
                    {report.liabilities.checksGiven > 0 && (
                      <TableRow>
                        <TableCell>
                          Verilen Çek ve Senetler
                          <span className="block text-xs text-muted-foreground">Henüz ödenmemiş</span>
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(report.liabilities.checksGiven)}</TableCell>
                      </TableRow>
                    )}
                    {report.liabilities.customerAdvances > 0 && (
                      <TableRow>
                        <TableCell>Müşterilerden Alınan Avanslar</TableCell>
                        <TableCell className="text-right">{formatCurrency(report.liabilities.customerAdvances)}</TableCell>
                      </TableRow>
                    )}
                    {report.liabilities.employeePayables > 0 && (
                      <TableRow>
                        <TableCell>
                          Personele Borçlar
                          <span className="block text-xs text-muted-foreground">Çalışanların cebinden ödediği masraflar</span>
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(report.liabilities.employeePayables)}</TableCell>
                      </TableRow>
                    )}
                    {report.liabilities.loans !== 0 && (
                      <TableRow>
                        <TableCell>
                          Banka Kredileri
                          <span className="block text-xs text-muted-foreground">Kullanılan − ödenen anapara</span>
                        </TableCell>
                        <TableCell className="text-right">{formatCurrency(report.liabilities.loans)}</TableCell>
                      </TableRow>
                    )}
                    {report.liabilities.partnerPayables > 0 && (
                      <TableRow>
                        <TableCell>Ortaklara Borçlar</TableCell>
                        <TableCell className="text-right">{formatCurrency(report.liabilities.partnerPayables)}</TableCell>
                      </TableRow>
                    )}
                    <TableRow className="bg-muted/50">
                      <TableCell className="font-bold">Toplam Yükümlülükler</TableCell>
                      <TableCell className="text-right font-bold">{formatCurrency(report.liabilities.total)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="pl-4">Geçmiş dönem + dönem kârı</TableCell>
                      <TableCell className="text-right">{formatCurrency(report.equity.retainedEarnings)}</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="pl-4">
                        Sermaye ve diğer düzeltmeler
                        <span className="block text-xs text-muted-foreground">
                          Kârla açıklanamayan kısım: kuruluş sermayesi, ortak cari, devir
                        </span>
                      </TableCell>
                      <TableCell className="text-right">{formatCurrency(report.equity.adjustments)}</TableCell>
                    </TableRow>
                    <TableRow className="bg-muted/50">
                      <TableCell className="font-bold">Öz Sermaye (net varlık)</TableCell>
                      <TableCell className="text-right font-bold">{formatCurrency(report.equity.total)}</TableCell>
                    </TableRow>
                    <TableRow className="bg-primary/10">
                      <TableCell className="font-bold">Toplam Pasifler</TableCell>
                      <TableCell className="text-right font-bold">{formatCurrency(report.totalLiabilitiesAndEquity)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
              {/* Kaynak ve bilinen yaklaşıklık — kullanıcı rakamın nereden geldiğini
                  ve neyin bugünkü durumdan okunduğunu görmeli (bkz. bilanco-kiymet.ts). */}
              <p className="text-xs text-muted-foreground md:col-span-2">
                Alacak ve borçlar cari bakiyelerinden, cari başına kurulur: fazla ödeme karşı tarafta avans
                olarak görünür. Çek/senet portföyünde tahsil tarihi kasa hareketinden, ciro tarihi evrakın
                durum tarihinden okunur; iade edilen ve protestolu evrak cari bakiyede olduğu gibi hiç sayılmaz.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

