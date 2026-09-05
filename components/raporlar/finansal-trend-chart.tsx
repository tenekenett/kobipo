"use client"

import dynamic from "next/dynamic"

/**
 * Recharts SSR'da çizilmez (ResponsiveContainer pencere ölçüsü ister), bu yüzden
 * grafik `-impl` dosyasında durup buradan `ssr: false` ile yükleniyor —
 * `components/dashboard/revenue-chart.tsx` ile aynı desen.
 */
export const FinansalTrendChart = dynamic(
  () => import("./finansal-trend-chart-impl").then((mod) => mod.FinansalTrendChart),
  {
    ssr: false,
    loading: () => <div className="h-[320px] animate-pulse rounded-md bg-muted/50" />,
  }
)
