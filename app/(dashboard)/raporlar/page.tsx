"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { BarChart3, Boxes, ShoppingCart } from "lucide-react"
import { useRouteAccess } from "@/components/dashboard/dashboard-company-provider"
import { REPORT_HUBS, type ReportHub } from "@/lib/nav/report-hubs"

const ICONS: Record<ReportHub["iconKey"], typeof ShoppingCart> = {
  sales: ShoppingCart,
  financial: BarChart3,
  stock: Boxes,
}

export default function RaporlarPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const canOpen = useRouteAccess()

  // Hub'ın KENDİSİ menüsüz olduğu için kapıya takılmaz; kararı içindeki linkler verir.
  // İçindekilerin hepsi kapalıysa bölüm çizilmez — aksi halde kullanıcı (ör. Gözlemci)
  // açtığı kartta boş bir liste bulur.
  const sections = REPORT_HUBS.filter(
    (hub) => canOpen(hub.href) && (hub.links.length === 0 || hub.links.some((l) => canOpen(l.href)))
  )

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

      {sections.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Görüntüleyebileceğiniz bir rapor bölümü yok.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {sections.map((section) => {
            const Icon = ICONS[section.iconKey]
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
      )}
    </div>
  )
}
