"use client"

import Link from "next/link"
import { useParams, useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { SatisAlisSection } from "@/components/raporlar/satis-alis-section"
import { withCompanyHref } from "@/lib/company/href"
import { findSalesPurchaseSection } from "@/lib/raporlar/satis-alis-sections"

/**
 * Alış raporunun bölüm sayfası: `/raporlar/alis/aylik`, `/tedarikciler`,
 * `/faturalar`, `/kalemler`. Gövde satışla ortaktır (bkz. satis-alis-section).
 */
export default function AlisRaporBolumPage() {
  const params = useParams<{ bolum: string }>()
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const section = findSalesPurchaseSection("PURCHASE", params?.bolum)

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{section?.title ?? "Alış Raporu"}</CardTitle>
          <CardDescription>Lütfen bir firma seçin</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (!section) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Bölüm bulunamadı</CardTitle>
          <CardDescription>Bu adreste bir alış raporu bölümü yok.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href={withCompanyHref("/raporlar/alis", companyId)}>
            <Button variant="outline">Alış raporuna dön</Button>
          </Link>
        </CardContent>
      </Card>
    )
  }

  return <SatisAlisSection kind="PURCHASE" companyId={companyId} section={section} />
}
