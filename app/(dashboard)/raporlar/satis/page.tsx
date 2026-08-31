"use client"

import { useSearchParams } from "next/navigation"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { SatisAlisReport } from "@/components/raporlar/satis-alis-report"

export default function SatisRaporlariPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Satış Raporları</CardTitle>
          <CardDescription>Lütfen bir firma seçin</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return <SatisAlisReport kind="SALES" companyId={companyId} />
}
