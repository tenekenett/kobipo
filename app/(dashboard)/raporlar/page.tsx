"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { BarChart3, Boxes, ShoppingCart } from "lucide-react"

const reportSections = [
  {
    title: "Satışlar - Alışlar",
    description: "Vergi ve satış/alış odaklı raporlara tek noktadan erişin.",
    href: "/raporlar/satis-alis",
    icon: ShoppingCart,
  },
  {
    title: "Finansal Raporlar",
    description: "Kar/zarar, bilanço ve nakit akış tablolarını görüntüleyin.",
    href: "/raporlar/finansal",
    icon: BarChart3,
  },
  {
    title: "Stok Raporları",
    description: "Stok görünümü ve stokla ilişkili detay rapor sayfalarına gidin.",
    href: "/raporlar/stok",
    icon: Boxes,
  },
]

export default function RaporlarPage() {
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
        <h1 className="text-3xl font-bold">Raporlar</h1>
        <p className="text-muted-foreground">
          Bölüm seçin ve finansal/cari detay rapor sayfalarına yönlenin.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {reportSections.map((section) => {
          const Icon = section.icon
          return (
            <Link key={section.href} href={`${section.href}?company=${encodeURIComponent(companyId)}`}>
              <Card className="h-full transition-colors hover:border-kobipo-blue/60">
                <CardHeader className="flex flex-row items-start gap-3 space-y-0">
                  <div className="rounded-md bg-kobipo-pale p-2 text-kobipo-blue">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="space-y-1">
                    <CardTitle>{section.title}</CardTitle>
                    <CardDescription>{section.description}</CardDescription>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 text-sm font-medium text-kobipo-blue">
                  Detay raporlara git
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

