"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  PAYMENT_LINKS_DISABLED_MESSAGE,
  PAYMENT_LINKS_ENABLED,
} from "@/lib/faturalar/payment-links"

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
    try {
      const response = await fetch(`/api/pay/${token}`)
      const text = await response.text()
      const payload = text ? JSON.parse(text) : {}

      if (response.ok) {
        setData(payload)
        setError("")
      } else {
        setError(payload.error || "Link bulunamadı")
      }
    } catch (err) {
      setError("Bağlantı hatası oluştu.")
    } finally {
      setLoading(false)
    }
  }

  async function completePayment() {
    setPaying(true)
    setError("")

    try {
      const response = await fetch(`/api/pay/${token}`, { 
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}) // API'nin boş da olsa json okumasını sağlar
      })

      const text = await response.text()
      const payload = text ? JSON.parse(text) : {}

      if (!response.ok) {
        setError(payload.error || "Ödeme başarısız")
      } else {
        await fetchLink()
      }
    } catch (err) {
      setError("Bir ağ hatası oluştu.")
    } finally {
      setPaying(false)
    }
  }

  useEffect(() => {
    if (!PAYMENT_LINKS_ENABLED) {
      setLoading(false)
      return
    }
    fetchLink()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  // Özellik pasif: uç zaten 503 döner, sayfa da ham hata yerine düzgün bir bilgi basar.
  if (!PAYMENT_LINKS_ENABLED) {
    return (
      <div className="mx-auto max-w-xl p-4">
        <Card>
          <CardHeader>
            <CardTitle>Online Tahsilat</CardTitle>
            <CardDescription>{PAYMENT_LINKS_DISABLED_MESSAGE}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Ödemenizi yapmak için lütfen faturayı düzenleyen firma ile iletişime geçin.
          </CardContent>
        </Card>
      </div>
    )
  }

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