"use client"

// Fatura → Etiket Yazdır (sabit sayfa). Fatura önizlemesindeki "Etiket Yazdır"
// butonu buraya yönlendirir. Faturayı çeker, kataloğa bağlı ürünleri etikete
// çevirir ve InvoiceLabelPrintPanel ile yazdırma arayüzünü gösterir.

import { useEffect, useMemo, useState } from "react"
import { useParams, useSearchParams } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Tag } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { InvoiceLabelPrintPanel } from "@/components/faturalar/invoice-label-print-panel"
import { ExportOnlyScreen } from "@/components/dashboard/write-guard"
import {
  buildInvoiceLabelItems,
  type RawInvoiceLabelItem,
} from "@/lib/labels/invoice-label-items"

interface Invoice {
  id: string
  slug?: string
  invoiceNo: string
  eDocumentNo?: string | null
  type: string
  company: { name: string }
  items: RawInvoiceLabelItem[]
}

export default function FaturaEtiketPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const invoiceId = params.id as string
  const companyId = searchParams.get("company")

  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!invoiceId) return
    let cancelled = false
    setIsLoading(true)
    setLoadError(null)
    setInvoice(null)
    ;(async () => {
      try {
        const qs = companyId ? `?companyId=${encodeURIComponent(companyId)}` : ""
        const res = await fetch(`/api/e-donusum/invoices/${invoiceId}${qs}`)
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          setLoadError(data.error || "Fatura yüklenemedi.")
          return
        }
        if (!Array.isArray(data.items)) data.items = []
        setInvoice(data)
      } catch (err: any) {
        if (!cancelled) setLoadError(err?.message || "Fatura yüklenirken bir hata oluştu.")
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [invoiceId, companyId])

  const items = useMemo(
    () => (invoice ? buildInvoiceLabelItems(invoice.items) : []),
    [invoice]
  )

  const backHref = `/faturalar/${invoiceId}/onizleme?company=${companyId || ""}`

  return (
    <ExportOnlyScreen>
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <Link href={backHref}>
          <Button variant="outline" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Geri
          </Button>
        </Link>
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold">
            <Tag className="h-6 w-6 text-muted-foreground" />
            Etiket Yazdır
          </h1>
          {invoice && (
            <p className="text-muted-foreground">
              Fatura No: {invoice.eDocumentNo || invoice.invoiceNo}
            </p>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ürün Etiketleri</CardTitle>
          <CardDescription>
            Faturadaki ürünlerin barkod/fiyat etiketini seçtiğiniz şablonla basın. Adetler
            fatura miktarlarından önerilir; düzenleyebilirsiniz.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="py-8 text-center text-muted-foreground">Yükleniyor...</p>
          ) : loadError ? (
            <div className="space-y-3 py-8 text-center">
              <p className="text-muted-foreground">{loadError}</p>
              <Button variant="outline" asChild>
                <Link href={backHref}>Faturaya dön</Link>
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="space-y-3 py-8 text-center">
              <p className="text-muted-foreground">
                Bu faturada etiketlenebilir ürün yok. Yalnızca stok kartına bağlı (hizmet
                olmayan) ürünlerin etiketi basılabilir.
              </p>
              <Button variant="outline" asChild>
                <Link href={backHref}>Faturaya dön</Link>
              </Button>
            </div>
          ) : (
            <InvoiceLabelPrintPanel
              companyId={companyId}
              companyName={invoice?.company.name ?? ""}
              items={items}
            />
          )}
        </CardContent>
      </Card>
    </div>
    </ExportOnlyScreen>
  )
}
