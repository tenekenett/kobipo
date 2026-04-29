"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const detailReports = [
  {
    title: "Stok Yönetimi Genel Görünüm",
    description: "Ürün, hizmet ve stok kartlarını yönetim ekranında inceleyin.",
    href: "/stok",
  },
  {
    title: "Depolar",
    description: "Depo bazlı stok takip ekranına geçiş yapın.",
    href: "/depolar",
  },
]

export default function StokRaporlariPage() {
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
        <h1 className="text-3xl font-bold">Stok Raporları</h1>
        <p className="text-muted-foreground">
          Stok ve depo tarafına ait rapor/izleme ekranları.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Detay Raporlar</CardTitle>
          <CardDescription>Stokla ilişkili ekranlara buradan geçebilirsiniz.</CardDescription>
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
