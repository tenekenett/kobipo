"use client"

import dynamic from "next/dynamic"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

function ExpensePieChartFallback({ title, description }: { title?: string; description?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title ?? "Dağılım"}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <div className="h-[300px] animate-pulse rounded-md bg-muted/50" />
      </CardContent>
    </Card>
  )
}

export const ExpensePieChart = dynamic(
  () => import("./pie-chart-impl").then((mod) => mod.ExpensePieChart),
  {
    ssr: false,
    loading: () => <ExpensePieChartFallback />,
  }
)
