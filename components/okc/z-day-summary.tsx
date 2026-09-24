"use client"

// Gün sonu raporundaki yazarkasa Z özeti. Plan: docs/okc/ASAMA1-KOBIPO.md A3.
//
// Şubede yazarkasa tanımlı değilse HİÇBİR ŞEY çizmez: yazarkasası olmayan
// işletmeye her gün "Z girilmedi" demek gürültüdür. Tanımlıysa ve o gün fiş
// kesildiği halde Z girilmemişse uyarır — mutabakat ancak Z girilince yapılır.

import { CompanyLink } from "@/components/dashboard/company-link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import type { ZDaySummary } from "@/lib/okc/z-mutabakat-query"

const money = (value: number) =>
  `${value.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`

export function ZDaySummaryCard({ summary, receiptCount }: { summary: ZDaySummary | undefined; receiptCount: number }) {
  if (!summary || summary.deviceCount === 0) return null

  if (summary.reports.length === 0) {
    if (receiptCount === 0) return null
    return (
      <Card className="border-amber-300 dark:border-amber-800/60">
        <CardHeader>
          <CardTitle className="text-amber-700 dark:text-amber-400">Z raporu girilmedi</CardTitle>
          <CardDescription>
            Bu gün {receiptCount} fiş kesildi ama yazarkasa Z raporu girilmedi; Kobipo fişleri cihazla
            karşılaştırılamıyor.{" "}
            <CompanyLink href="/satis/z-raporlari" className="font-medium text-primary underline-offset-4 hover:underline">
              Z raporu gir
            </CompanyLink>
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Yazarkasa Z raporu</CardTitle>
        <CardDescription>
          Saat {String(summary.cutoffHours).padStart(2, "0")}:00'dan önce alınan Z önceki güne sayılır.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {summary.reports.map((z) => (
          <CompanyLink
            key={z.id}
            href="/satis/z-raporlari"
            className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm transition-colors hover:bg-muted/50"
          >
            <div className="min-w-0">
              <p className="truncate font-semibold">
                {z.deviceName} · Z {z.zNo}
              </p>
              <p className="text-xs text-muted-foreground">
                Z {money(z.grossTotal)} · Kobipo {money(z.kobipoTotal)}
                {z.totalDiff ? ` · fark ${z.totalDiff > 0 ? "+" : ""}${money(z.totalDiff)}` : ""}
              </p>
            </div>
            {!z.comparable ? (
              <Badge variant="bekliyor">Cihaz ayrılamadı</Badge>
            ) : z.ok ? (
              <Badge variant="odendi">Tutuyor</Badge>
            ) : (
              <Badge variant="gecikti">Fark var</Badge>
            )}
          </CompanyLink>
        ))}
      </CardContent>
    </Card>
  )
}
