"use client"

import dynamic from "next/dynamic"

/** Recharts SSR'da çizilmez — bkz. finansal-trend-chart.tsx (aynı desen). */
export const NakitProjeksiyonChart = dynamic(
  () => import("./nakit-projeksiyon-chart-impl").then((mod) => mod.NakitProjeksiyonChart),
  {
    ssr: false,
    loading: () => <div className="h-[340px] animate-pulse rounded-md bg-muted/50" />,
  }
)
