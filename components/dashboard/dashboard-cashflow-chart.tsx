"use client"

import dynamic from "next/dynamic"

export type CashflowPoint = { label: string; income: number; expense: number }

function CashflowChartFallback() {
  return <div className="h-[240px] animate-pulse rounded-2xl bg-kobipo-offwhite/60" />
}

export const DashboardCashflowChart = dynamic(
  () =>
    import("./dashboard-cashflow-chart-impl").then((mod) => mod.DashboardCashflowChart),
  {
    ssr: false,
    loading: () => <CashflowChartFallback />,
  }
)
