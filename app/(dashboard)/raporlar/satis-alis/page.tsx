"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const detailReports = [
  {
    title: "Vergi Beyannameleri",
    description: "KDV, Muhtasar ve Ba-Bs hazırlık raporlarını açar.",
    href: "/raporlar/vergiler",
  },
  {
    title: "Satış Faturaları",
    description: "Satış faturaları akışına hızlı geçiş sağlar.",
    href: "/satis/fatura",
  },
  {
    title: "Alış Faturaları",
    description: "Alış faturaları akışına hızlı geçiş sağlar.",
    href: "/alis/fatura",
  },
]

export default function SatisAlisRaporlariPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")

  if (!companyId) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Lütfen bir firma seçin</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Satışlar - Alışlar</h1>
        <p className="text-muted-foreground">
          Satış ve alış süreçlerine ait detay rapor başlıkları.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Detay Raporlar</CardTitle>
          <CardDescription>İlgili başlığa tıklayıp rapor ekranına geçebilirsiniz.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {detailReports.map((report) => (
            <Link
              key={report.href}
              href={`${report.href}?company=${encodeURIComponent(companyId)}`}
              className="block rounded-lg border p-4 transition-colors hover:border-kobipo-blue/60"
            >
              <p className="font-semibold">{report.title}</p>
              <p className="text-sm text-muted-foreground">{report.description}</p>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
