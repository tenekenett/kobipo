"use client"

import dynamic from "next/dynamic"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

function RevenueChartFallback() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Gelir/Gider Trendi</CardTitle>
        <CardDescription>Son 6 aylık gelir ve gider grafiği</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] animate-pulse rounded-md bg-muted/50" />
      </CardContent>
    </Card>
  )
}

export const RevenueChart = dynamic(
  () => import("./revenue-chart-impl").then((mod) => mod.RevenueChart),
  {
    ssr: false,
    loading: () => <RevenueChartFallback />,
  }
)
