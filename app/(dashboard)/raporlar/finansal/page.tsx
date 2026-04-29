"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const detailReports = [
  {
    title: "Kar/Zarar Tablosu",
    description: "Dönemsel gelir, gider ve net kar/zarar analizi.",
    href: "/raporlar/kar-zarar",
  },
  {
    title: "Bilanço",
    description: "Varlık, yükümlülük ve özsermaye görünümü.",
    href: "/raporlar/bilanco",
  },
  {
    title: "Nakit Akış Tablosu",
    description: "Nakit giriş-çıkış hareketlerinin dönemsel özeti.",
    href: "/raporlar/nakit-akisi",
  },
  {
    title: "Muhasebe / Yevmiye",
    description: "Muhasebe kayıt ekranına ve yevmiye görünümüne yönlendirir.",
    href: "/muhasebe/yevmiye",
  },
  {
    title: "Cari Yaşlandırma",
    description: "Müşteri ve tedarikçi bakiyelerini vade bazında analiz eder.",
    href: "/raporlar/cari-yaslandirma",
  },
  {
    title: "Cari Ekstre",
    description: "Cari hareket dökümü ve güncel bakiye detayını gösterir.",
    href: "/cari/ekstre",
  },
  {
    title: "Cari Hesaplar",
    description: "Müşteri ve tedarikçi listelerine hızlı erişim sağlar.",
    href: "/cari",
  },
]

export default function FinansalRaporlarPage() {
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
