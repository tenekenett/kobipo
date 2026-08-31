"use client"

import Link from "next/link"
import { useParams, useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { SatisAlisSection } from "@/components/raporlar/satis-alis-section"
import { withCompanyHref } from "@/lib/company/href"
import { findSalesPurchaseSection } from "@/lib/raporlar/satis-alis-sections"

/**
 * Satış raporunun bölüm sayfası: `/raporlar/satis/aylik`, `/musteriler`,
 * `/faturalar`, `/kalemler`.
 *
 * Yol `/raporlar/satis` altında: `navHrefsForPath` en uzun ön eki eşleştirdiği
 * için sayfa kapısını üst sayfadan DEVRALIR — ayrı nav kaydı, rol matrisi ve
 * şablon güncellemesi gerekmez.
 */
export default function SatisRaporBolumPage() {
  const params = useParams<{ bolum: string }>()
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const section = findSalesPurchaseSection("SALES", params?.bolum)

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{section?.title ?? "Satış Raporu"}</CardTitle>
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
          <CardDescription>Bu adreste bir satış raporu bölümü yok.</CardDescription>
        </CardHeader>
        <CardContent>
          <Link href={withCompanyHref("/raporlar/satis", companyId)}>
            <Button variant="outline">Satış raporuna dön</Button>
          </Link>
        </CardContent>
      </Card>
    )
  }

  return <SatisAlisSection kind="SALES" companyId={companyId} section={section} />
}
