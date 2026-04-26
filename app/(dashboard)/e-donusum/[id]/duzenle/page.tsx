"use client"

import Link from "next/link"
import { useParams, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { InvoiceEditor } from "@/components/e-donusum/invoice-editor"
import { ArrowLeft } from "lucide-react"

export default function EDonusumFaturaDuzenlePage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const fromParam = searchParams.get("from")
  const invoiceId = typeof params.id === "string" ? params.id : params.id?.[0]

  if (!companyId) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Lütfen bir firma seçin</p>
      </div>
    )
  }

  if (!invoiceId) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Geçersiz fatura</p>
      </div>
    )
  }

  const safeFrom = fromParam && fromParam.startsWith("/") ? fromParam : null
  const baseHref = safeFrom || "/e-donusum"
  const sep = baseHref.includes("?") ? "&" : "?"
  const backHref = `${baseHref}${sep}company=${encodeURIComponent(companyId)}`

  return (
    <div className="w-full min-w-0 space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="outline" size="sm" asChild>
          <Link href={backHref}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Listeye dön
          </Link>
        </Button>
        <h1 className="text-2xl font-bold">Fatura Düzenle</h1>
      </div>
      <InvoiceEditor companyId={companyId} mode="edit" invoiceId={invoiceId} backHref={backHref} />
    </div>
  )
}
