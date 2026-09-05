"use client"

import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, CalendarClock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { NakitProjeksiyonChart } from "@/components/raporlar/nakit-projeksiyon-chart"
import type { CashProjectionResult } from "@/lib/raporlar/nakit-projeksiyon"

const money = (value: number) =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(value)

const GRANULARITIES: Array<{ key: "week" | "month"; label: string }> = [
  { key: "week", label: "12 Hafta" },
  { key: "month", label: "12 Ay" },
]

/**
 * İleriye dönük nakit projeksiyonu paneli.
 *
 * Nakit akış tablosunun yanında bir SEKME olarak yaşıyor çünkü ikisi aynı
 * soruyu farklı yöne sorar: tablo "ne oldu", projeksiyon "ne olacak". Ayrı
 * sayfaya konsaydı kullanıcı, tabloyu açıp geçmişe bakarken geleceği
 * göremezdi.
 */
export function NakitProjeksiyonPanel({ companyId }: { companyId: string }) {
  const [granularity, setGranularity] = useState<"week" | "month">("week")
  const [data, setData] = useState<CashProjectionResult | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ companyId, granularity })
      const response = await fetch(`/api/raporlar/nakit-projeksiyon?${params}`)
      if (!response.ok) throw new Error("Projeksiyon alınamadı")
      setData(await response.json())
    } catch (err) {
      console.error("Nakit projeksiyonu alınamadı:", err)
      setError("Projeksiyon alınamadı. Lütfen tekrar deneyin.")
    } finally {
      setIsLoading(false)
    }
  }, [companyId, granularity])

  useEffect(() => {
    load()
  }, [load])

  // Darboğaz uyarısı: eğri eksiye düşüyorsa hangi kovada düştüğünü söyle.
  const shortfall = data?.lowestPoint && data.lowestPoint.balance < 0 ? data.lowestPoint : null

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5" />
            Nakit Projeksiyonu
          </CardTitle>
          <CardDescription>
            Bugünkü kasa/banka bakiyesinden başlayarak açık alacak ve borçların vadesine göre
            dağılımı. Vadesi geçmiş ve vadesi tanımsız tutarlar eğriye DAHİL DEĞİLDİR.
          </CardDescription>
        </div>
        <div className="flex gap-1">
          {GRANULARITIES.map((option) => (
            <Button
              key={option.key}
              size="sm"
              variant={granularity === option.key ? "default" : "outline"}
              onClick={() => setGranularity(option.key)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <div className="flex items-center justify-between rounded-lg border p-3">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <Button size="sm" variant="outline" onClick={load}>
              Tekrar dene
            </Button>
          </div>
        )}

        {isLoading && !data && <div className="h-[340px] animate-pulse rounded-md bg-muted/50" />}

        {data && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">Bugünkü Nakit</p>
                <p className="text-2xl font-bold">{money(data.openingBalance)}</p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">Dönem Sonu Beklenen</p>
                <p className="text-2xl font-bold">
                  {money(data.buckets.at(-1)?.balance ?? data.openingBalance)}
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">Vadesi Geçmiş Alacak</p>
                <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                  {money(data.overdue.inflow)}
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-sm text-muted-foreground">Vadesi Geçmiş Borç</p>
                <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                  {money(data.overdue.outflow)}
                </p>
              </div>
            </div>

            {shortfall && (
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950/30">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                <p className="text-red-900 dark:text-red-200">
                  <strong>{shortfall.label}</strong> döneminde nakit {money(shortfall.balance)}{" "}
                  seviyesine, yani eksiye düşüyor. Vadesi geçmiş alacakların tahsili ya da ödeme
                  planı bu açığı kapatabilir.
                </p>
              </div>
            )}

            <NakitProjeksiyonChart data={data.buckets} />

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dönem</TableHead>
                    <TableHead className="text-right">Tahsilat</TableHead>
                    <TableHead className="text-right">Ödeme</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead className="text-right">Bakiye</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.buckets.map((bucket) => (
                    <TableRow key={bucket.key}>
                      <TableCell className="font-medium">{bucket.label}</TableCell>
                      <TableCell className="text-right">{money(bucket.inflow)}</TableCell>
                      <TableCell className="text-right">{money(bucket.outflow)}</TableCell>
                      <TableCell className="text-right">{money(bucket.net)}</TableCell>
                      <TableCell
                        className={`text-right font-medium ${
                          bucket.balance < 0 ? "text-red-600 dark:text-red-400" : ""
                        }`}
                      >
                        {money(bucket.balance)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Eğri dışında kalan tutarlar AÇIKÇA yazılır: yazılmasaydı
                "alacaklarımın toplamı grafikte görünmüyor" denirdi. */}
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <div className="rounded-lg border p-3">
                <p className="text-muted-foreground">Vadesi geçmiş (eğri dışı)</p>
                <p>Alacak: {money(data.overdue.inflow)}</p>
                <p>Borç: {money(data.overdue.outflow)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-muted-foreground">Vade tanımsız (eğri dışı)</p>
                <p>Alacak: {money(data.undated.inflow)}</p>
                <p>Borç: {money(data.undated.outflow)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-muted-foreground">Ufkun ötesi (eğri dışı)</p>
                <p>Alacak: {money(data.beyond.inflow)}</p>
                <p>Borç: {money(data.beyond.outflow)}</p>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
