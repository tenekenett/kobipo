"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

type PaymentLinkPayload = {
  token: string
  status: string
  amount: number
  currency: string
  expiresAt?: string
  invoice: {
    invoiceNo: string
    customerName?: string | null
    totalAmount: number
    totalPaid: number
    remainingAmount: number
  }
}

export default function PublicPaymentPage() {
  const params = useParams()
  const token = params.token as string
  const [data, setData] = useState<PaymentLinkPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState("")

  async function fetchLink() {
    setLoading(true)
    const response = await fetch(`/api/pay/${token}`)
    if (response.ok) {
      setData(await response.json())
      setError("")
    } else {
      const payload = await response.json()
      setError(payload.error || "Link bulunamadı")
    }
    setLoading(false)
  }

  async function completePayment() {
    setPaying(true)
    const response = await fetch(`/api/pay/${token}`, { method: "POST" })
    if (!response.ok) {
      const payload = await response.json()
      setError(payload.error || "Ödeme başarısız")
    } else {
      await fetchLink()
    }
    setPaying(false)
  }

  useEffect(() => {
    fetchLink()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground">Yükleniyor...</div>
  }

  if (error || !data) {
    return <div className="p-8 text-center text-destructive">{error || "Hata"}</div>
  }

  return (
    <div className="mx-auto max-w-xl p-4">
      <Card>
        <CardHeader>
          <CardTitle>Online Tahsilat</CardTitle>
          <CardDescription>Fatura: {data.invoice.invoiceNo}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>Müşteri: {data.invoice.customerName || "-"}</div>
          <div>Link Durumu: {data.status}</div>
          <div>Tutar: {data.amount.toFixed(2)} {data.currency}</div>
          <div>Kalan: {data.invoice.remainingAmount.toFixed(2)} {data.currency}</div>
          {data.expiresAt && <div>Son Kullanım: {new Date(data.expiresAt).toLocaleString("tr-TR")}</div>}

          <Button
            className="w-full"
            onClick={completePayment}
            disabled={paying || data.status !== "ACTIVE" || data.invoice.remainingAmount <= 0}
          >
            {paying ? "İşleniyor..." : "Ödemeyi Tamamla"}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
