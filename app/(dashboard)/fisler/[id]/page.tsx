"use client"

import { useCallback, useEffect, useState, type ComponentProps } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import {
  buildReceiptHtml,
  currency,
  type ReceiptCompanyInfo,
  type ReceiptData,
} from "@/lib/fis/receipt-html"
import { DEFAULT_RECEIPT_TEMPLATE, type ReceiptTemplate } from "@/lib/fis/receipt-template"
import { ArrowLeft, FileText, Loader2, Printer, Receipt, Wallet, XCircle } from "lucide-react"
import { ExportAction, WriteAction } from "@/components/dashboard/write-guard"

type FisDetail = {
  id: string
  slug: string
  receiptNo: string
  direction: "outgoing" | "incoming"
  status: string
  date: string
  createdAt: string
  companyName: string
  /** Ayarlar > Fiş Tasarımı şablonu (kaydedilmemişse varsayılan). */
  receiptTemplate: ReceiptTemplate
  companyInfo: ReceiptCompanyInfo
  counterpartyId: string | null
  counterpartyName: string | null
  currency: string
  netAmount: number
  vatAmount: number
  totalAmount: number
  paidAmount: number
  paymentStatus: "OPEN" | "PARTIAL" | "PAID"
  notes: string | null
  convertedInvoice: { id: string; slug: string; invoiceNo: string } | null
  items: {
    id: string
    description: string
    quantity: number
    unit: string
    unitPrice: number
    vatRate: number
    vatAmount: number
    totalAmount: number
  }[]
  payments: {
    id: string
    amount: number
    paymentDate: string
    paymentMethod: string
    paymentMethodLabel: string
    accountName: string | null
  }[]
}

type Variant = ComponentProps<typeof Badge>["variant"]

const PAYMENT_BADGE: Record<FisDetail["paymentStatus"], { label: string; variant: Variant }> = {
  PAID: { label: "Tahsil edildi", variant: "odendi" },
  PARTIAL: { label: "Kısmî", variant: "bekliyor" },
  OPEN: { label: "Açık hesap", variant: "secondary" },
}

const STATUS_BADGE: Record<string, { label: string; variant: Variant }> = {
  DRAFT: { label: "Açık fiş", variant: "aktif" },
  CONVERTED: { label: "Faturaya dönüştürüldü", variant: "secondary" },
  CANCELLED: { label: "İptal edildi", variant: "destructive" },
}

const qtyFmt = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 3 })

export default function FisDetayPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const { confirm } = useConfirm()

  const fisId = params.id as string
  const companyId = searchParams.get("company")

  const [fis, setFis] = useState<FisDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!companyId) {
      setLoadError("Firma seçili değil. Üstten şube seçin.")
      setLoading(false)
      return
    }
    setLoading(true)
    setLoadError(null)
    try {
      const res = await fetch(
        `/api/fisler/${encodeURIComponent(fisId)}?companyId=${encodeURIComponent(companyId)}`,
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Fiş yüklenemedi")
      setFis(data)
    } catch (e: any) {
      setLoadError(e?.message || "Fiş yüklenemedi")
    } finally {
      setLoading(false)
    }
  }, [companyId, fisId])

  useEffect(() => {
    load()
  }, [load])

  const listHref = fis
    ? `${fis.direction === "incoming" ? "/alis/fisler" : "/satis/fisler"}?company=${companyId ?? ""}`
    : "#"

  // Geri butonu: fişe başka bir ekrandan (ör. restoran kârlılık raporu) gelindiyse
  // `from` ile oraya dön; yoksa fişin kendi listesine. Fatura önizlemesiyle aynı
  // sözleşme — açık `/` ile başlama kontrolü dış siteye yönlendirmeyi engelliyor.
  const fromParam = searchParams.get("from")
  const safeFrom = fromParam && fromParam.startsWith("/") ? fromParam : null
  const backHref = safeFrom
    ? `${safeFrom}${safeFrom.includes("?") ? "&" : "?"}company=${companyId ?? ""}`
    : listHref
  const backLabel = safeFrom
    ? "Geri"
    : fis?.direction === "incoming"
      ? "Alış Fişleri"
      : "Satış Fişleri"

  /** Termal fiş (80mm) — hızlı satış/alıştaki fişin aynısı, ortak lib'den. */
  const printReceipt = () => {
    if (!fis) return
    const data: ReceiptData = {
      direction: fis.direction,
      invoiceNo: fis.receiptNo,
      date: fis.date,
      companyName: fis.companyName,
      company: fis.companyInfo,
      counterpartyName: fis.counterpartyName,
      items: fis.items.map((it) => ({
        description: it.description,
        quantity: it.quantity,
        unit: it.unit,
        unitPrice: it.unitPrice,
        vatRate: it.vatRate,
        total: it.totalAmount,
      })),
      net: fis.netAmount,
      vat: fis.vatAmount,
      total: fis.totalAmount,
      isCredit: fis.payments.length === 0,
      parts: fis.payments.map((p) => ({ label: p.paymentMethodLabel, amount: p.amount })),
      paymentLabel: fis.payments[0]?.paymentMethodLabel ?? "",
      tendered: fis.paidAmount,
      notes: fis.notes,
      // change verilmez: sonradan yazdırmada para üstü bilinmiyor → satır çıkmaz.
    }
    const w = window.open("", "_blank", "width=420,height=720")
    if (!w) {
      toast({
        title: "Açılır pencere engellendi",
        description: "Fiş için bu site için açılır pencerelere izin verin.",
        variant: "destructive",
      })
      return
    }
    w.document.write(buildReceiptHtml(data, false, fis.receiptTemplate ?? DEFAULT_RECEIPT_TEMPLATE))
    w.document.close()
    w.focus()
  }

  const convert = async () => {
    if (!fis || !companyId) return
    if (!fis.counterpartyId) {
      toast({
        title: "Cari gerekli",
        description:
          fis.direction === "incoming"
            ? "Faturaya dönüştürmek için fişte tedarikçi seçili olmalı."
            : "Faturaya dönüştürmek için fişte müşteri seçili olmalı.",
        variant: "destructive",
      })
      return
    }
    if (
      !(await confirm({
        title: "Faturaya dönüştür",
        description:
          "Bu fiş resmî faturaya dönüştürülecek. Stok ve tahsilat tekrar işlenmez; fişin etkisi faturaya taşınır.",
        confirmLabel: "Dönüştür",
      }))
    )
      return

    setBusy(true)
    try {
      const res = await fetch("/api/fisler/faturaya-donustur", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, receiptIds: [fis.id] }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Dönüştürme başarısız")
      toast({ title: "Fatura oluşturuldu", description: `${fis.receiptNo} → ${data.invoiceNo}` })
      await load()
    } catch (e: any) {
      toast({ title: "Hata", description: e?.message || "Dönüştürme başarısız", variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    if (!fis || !companyId) return
    if (
      !(await confirm({
        title: "Fişi iptal et",
        description:
          "Fiş iptal edilecek; stok ve kasa etkisi geri alınacak. Bu işlem geri alınamaz.",
        confirmLabel: "İptal et",
      }))
    )
      return

    setBusy(true)
    try {
      const res = await fetch(`/api/fisler/${encodeURIComponent(fis.id)}/iptal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "İptal başarısız")
      toast({ title: "Fiş iptal edildi", description: data.message })
      await load()
    } catch (e: any) {
      toast({ title: "Hata", description: e?.message || "İptal başarısız", variant: "destructive" })
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Fiş yükleniyor...
      </div>
    )
  }

  if (loadError || !fis) {
    return (
      <div className="space-y-4 p-4">
        <Button variant="outline" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Geri
        </Button>
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            {loadError || "Fiş bulunamadı."}
          </CardContent>
        </Card>
      </div>
    )
  }

  const statusBadge = STATUS_BADGE[fis.status] ?? { label: fis.status, variant: "secondary" as Variant }
  const payBadge = PAYMENT_BADGE[fis.paymentStatus]
  const cariLabel = fis.direction === "incoming" ? "Tedarikçi" : "Müşteri"
  const isActive = fis.status !== "CONVERTED" && fis.status !== "CANCELLED"

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" asChild>
            <Link href={backHref}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              {backLabel}
            </Link>
          </Button>
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold">
              <Receipt className="h-5 w-5 text-muted-foreground" />
              {fis.receiptNo}
            </h1>
            <p className="text-sm text-muted-foreground">
              {fis.direction === "incoming" ? "Alış fişi" : "Satış fişi"} — gayriresmî belge, GİB'e
              gönderilmez.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportAction>
            <Button variant="outline" size="sm" onClick={printReceipt}>
              <Receipt className="mr-2 h-4 w-4" />
              Fiş Yazdır
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/fisler/${fis.slug || fis.id}/yazdir?company=${companyId ?? ""}`} target="_blank">
                <Printer className="mr-2 h-4 w-4" />
                A4 Yazdır
              </Link>
            </Button>
          </ExportAction>
          <Button variant="outline" size="sm" asChild>
            {/* return: ödemeler ekranı fatura listesine değil, bu fişe geri dönsün. */}
            <Link
              href={`/faturalar/${fis.id}/odemeler?company=${companyId ?? ""}&return=${encodeURIComponent(
                `/fisler/${fis.slug || fis.id}?company=${companyId ?? ""}`,
              )}`}
            >
              <Wallet className="mr-2 h-4 w-4" />
              Tahsilat
            </Link>
          </Button>
          {isActive && (
            <WriteAction>
              <Button size="sm" onClick={convert} disabled={busy}>
                {busy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="mr-2 h-4 w-4" />
                )}
                Faturaya Dönüştür
              </Button>
              <Button variant="destructive" size="sm" onClick={cancel} disabled={busy}>
                <XCircle className="mr-2 h-4 w-4" />
                İptal Et
              </Button>
            </WriteAction>
          )}
        </div>
      </div>

      {fis.convertedInvoice && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm">
              Bu fiş <strong>{fis.convertedInvoice.invoiceNo}</strong> numaralı resmî faturaya
              dönüştürüldü. Stok, tahsilat ve cari etkisi artık o faturada.
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link
                href={`/faturalar/${fis.convertedInvoice.id}/onizleme?company=${companyId ?? ""}`}
              >
                Faturayı Aç
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Fiş Bilgileri</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-muted-foreground">Durum</p>
              <div className="mt-1 flex flex-wrap gap-2">
                <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
                <Badge variant={payBadge.variant}>{payBadge.label}</Badge>
              </div>
            </div>
            <div>
              <p className="text-muted-foreground">Tarih</p>
              <p className="mt-1 font-medium">
                {new Date(fis.date).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" })}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">{cariLabel}</p>
              <p className="mt-1 font-medium">
                {fis.counterpartyName ?? (fis.direction === "incoming" ? "Serbest" : "Perakende")}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Fiş No</p>
              <p className="mt-1 font-mono font-medium">{fis.receiptNo}</p>
            </div>
            {fis.notes && (
              <div className="sm:col-span-2">
                <p className="text-muted-foreground">Not</p>
                <p className="mt-1">{fis.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tutarlar</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Ara Toplam</span>
              <span className="tabular-nums">{currency(fis.netAmount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">KDV</span>
              <span className="tabular-nums">{currency(fis.vatAmount)}</span>
            </div>
            <div className="flex justify-between border-t pt-2 text-base font-bold">
              <span>Toplam</span>
              <span className="tabular-nums">{currency(fis.totalAmount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tahsil edilen</span>
              <span className="tabular-nums">{currency(fis.paidAmount)}</span>
            </div>
            {fis.totalAmount - fis.paidAmount > 0.005 && (
              <div className="flex justify-between font-semibold">
                <span>Kalan</span>
                <span className="tabular-nums">{currency(fis.totalAmount - fis.paidAmount)}</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Kalemler</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Açıklama</TableHead>
                  <TableHead className="text-right">Miktar</TableHead>
                  <TableHead className="text-right">Birim Fiyat</TableHead>
                  <TableHead className="text-center">KDV</TableHead>
                  <TableHead className="text-right">Tutar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fis.items.map((it) => (
                  <TableRow key={it.id}>
                    <TableCell className="font-medium">{it.description}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {qtyFmt(it.quantity)} {it.unit}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{currency(it.unitPrice)}</TableCell>
                    <TableCell className="text-center tabular-nums">%{it.vatRate}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {currency(it.totalAmount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {fis.payments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tahsilat / Ödemeler</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tarih</TableHead>
                    <TableHead>Yöntem</TableHead>
                    <TableHead>Hesap</TableHead>
                    <TableHead className="text-right">Tutar</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fis.payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(p.paymentDate).toLocaleDateString("tr-TR")}
                      </TableCell>
                      <TableCell>{p.paymentMethodLabel}</TableCell>
                      <TableCell className="text-muted-foreground">{p.accountName ?? "—"}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {currency(p.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
