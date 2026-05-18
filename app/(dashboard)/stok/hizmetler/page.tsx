"use client"

import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ArrowUpRight, Wrench } from "lucide-react"

export default function HizmetListesiPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-kobipo-navy dark:text-foreground">Hizmet Listesi</h1>
          <p className="text-sm text-muted-foreground">
            Sattığınız veya satın aldığınız hizmetleri kataloglayın
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-kobipo-blue/10 text-kobipo-blue dark:bg-primary/15 dark:text-primary">
              <Wrench className="h-5 w-5" />
            </span>
            <div>
              <CardTitle>Hizmetler şu an Ürün Listesi içinde</CardTitle>
              <CardDescription>
                Hizmetlerinizi şu an "Stok / Ürün Listesi" ekranından, birim ve stok takibi kapalı
                bir ürün olarak yönetebilirsiniz. Bağımsız hizmet kataloğu yakında geliyor.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-kobipo-blue/60 dark:bg-primary/60" />
              Yeni bir ürün oluşturup birimini "saat", "adet" veya "hizmet" olarak girebilirsiniz.
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-kobipo-blue/60 dark:bg-primary/60" />
              Stok takibi yapmak istemediğiniz hizmetler için stok miktarını 0 olarak bırakın.
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-kobipo-blue/60 dark:bg-primary/60" />
              Bağımsız bir hizmet kataloğu (KDV oranı, hizmet tipi, abonelik) yakında.
            </li>
          </ul>
          <div className="flex flex-wrap gap-2 pt-2">
            <Link href={companyId ? `/stok?company=${encodeURIComponent(companyId)}` : "/stok"}>
              <Button>
                Ürün Listesi'ne git
                <ArrowUpRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
