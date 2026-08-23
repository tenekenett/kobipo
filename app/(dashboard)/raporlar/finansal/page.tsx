"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useRouteAccess } from "@/components/dashboard/dashboard-company-provider"
import { reportHubLinks } from "@/lib/nav/report-hubs"

/** Başlıklar `lib/nav/report-hubs.ts`te: üst hub da aynı listeyi süzerek çiziyor. */
const DETAIL_REPORTS = reportHubLinks("/raporlar/finansal")

export default function FinansalRaporlarPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  // Menüsüz kavşak sayfası: kapıya kendisi takılmaz, o yüzden linkleri burada süzülür.
  // Süzmezsek kapalı bir rapora tıklayan kullanıcı sayfa kapısına çarpıp panoya döner.
  const canOpen = useRouteAccess()
  const reports = DETAIL_REPORTS.filter((report) => canOpen(report.href))

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
        <h1 className="text-3xl font-bold">Finansal Raporlar</h1>
        <p className="text-muted-foreground">
          Finansal ve cari odaklı detay rapor başlıkları.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Detay Raporlar</CardTitle>
          <CardDescription>Her başlık kendi rapor sayfasına yönlendirir.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {reports.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Bu bölümde görüntüleyebileceğiniz bir rapor yok.
            </p>
          ) : null}
          {reports.map((report) => (
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
