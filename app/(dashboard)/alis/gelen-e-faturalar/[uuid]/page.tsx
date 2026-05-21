"use client"

import { useEffect, useState, useCallback } from "react"
import { useSearchParams, useRouter, useParams } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useToast } from "@/components/ui/use-toast"
import {
  ArrowLeft,
  FileDown,
  Loader2,
  Repeat2,
  ExternalLink,
  Inbox,
} from "lucide-react"

interface IncomingLine {
  description: string | null
  productCode: string | null
  unit: string | null
  quantity: number | null
  unitPrice: number | null
  discountRate: number | null
  discountAmount: number | null
  vatRate: number | null
  vatAmount: number | null
  lineTotal: number | null
}

interface IncomingDetail {
  id: string
  uuid: string
  invoiceNo: string | null
  date: string | null
  sender: { name: string | null; taxNumber: string | null }
  profile: string | null
  invoiceType: string | null
  currency: string | null
  taxExclusiveAmount: number | string | null
  taxInclusiveAmount: number | string | null
  vatAmount: number | string | null
  totalAmount: number | string | null
  status: string | null
  envelopeStatusDesc: string | null
  isLinkedToPurchase: boolean
  linkedInvoiceId: string | null
  model: {
    lines: IncomingLine[]
    sender: { name: string | null; taxNumber: string | null; address: string | null }
  } | null
  modelError?: string | null
}

export default function GelenEFaturaDetailPage() {
  const params = useParams<{ uuid: string }>()
  const uuid = decodeURIComponent(params?.uuid || "")
  const searchParams = useSearchParams()
  const router = useRouter()
  const companyId = searchParams.get("company")
  const { toast } = useToast()

  const [record, setRecord] = useState<IncomingDetail | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false)

  const fetchDetail = useCallback(async () => {
    if (!companyId || !uuid) return
    setIsLoading(true)
    try {
      const res = await fetch(
        `/api/e-donusum/inbox/${encodeURIComponent(uuid)}?companyId=${encodeURIComponent(
          companyId,
        )}&withModel=1`,
      )
      const data = await res.json()
      if (!res.ok) {
        toast({
          title: "Detay alınamadı",
          description: data.error || "Bilinmeyen hata",
          variant: "destructive",
        })
        return
      }
      setRecord(data)
    } catch (e: any) {
      toast({
        title: "Hata",
        description: e?.message || "Detay yüklenirken hata",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }, [companyId, uuid, toast])

  useEffect(() => {
    fetchDetail()
  }, [fetchDetail])

  const handleDownloadPdf = async () => {
    if (!companyId || !uuid) return
    setIsDownloadingPdf(true)
    try {
      const res = await fetch(
        `/api/e-donusum/inbox/${encodeURIComponent(uuid)}/pdf?companyId=${encodeURIComponent(
          companyId,
        )}`,
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast({
          title: "PDF indirilemedi",
          description: data.error || "Bilinmeyen hata",
          variant: "destructive",
        })
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      window.open(url, "_blank", "noopener")
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e: any) {
      toast({ title: "Hata", description: e?.message || "PDF açılırken hata", variant: "destructive" })
    } finally {
      setIsDownloadingPdf(false)
    }
  }

  const handleConvertToPurchase = () => {
    if (!companyId || !uuid) return
    const qs = new URLSearchParams({
      company: companyId,
      fromIncoming: uuid,
      manual: "1",
      from: `/alis/gelen-e-faturalar/${encodeURIComponent(uuid)}`,
    })
    router.push(`/e-donusum/yeni?${qs.toString()}`)
  }

  const fmt = (v: number | string | null | undefined, ccy = "TRY") =>
    v === null || v === undefined
      ? "-"
      : new Intl.NumberFormat("tr-TR", { style: "currency", currency: ccy }).format(Number(v))

  if (!companyId) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Lütfen bir firma seçin</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!record) {
    return (
      <div className="space-y-4">
        <Button variant="outline" size="sm" asChild>
          <Link href={`/alis/gelen-e-faturalar?company=${encodeURIComponent(companyId)}`}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Listeye dön
          </Link>
        </Button>
        <Card>
          <CardHeader>
            <CardTitle>Kayıt bulunamadı</CardTitle>
            <CardDescription>
              ETTN: <span className="font-mono">{uuid}</span>
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  const currency = record.currency || "TRY"
  const lines = record.model?.lines || []
  const lineSum = lines.reduce((acc, l) => acc + Number(l.lineTotal || 0), 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/alis/gelen-e-faturalar?company=${encodeURIComponent(companyId)}`}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Listeye dön
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Inbox className="h-5 w-5" />
              Gelen E-Fatura · {record.invoiceNo || "(no yok)"}
            </h1>
            <p className="text-xs text-muted-foreground font-mono">{record.uuid}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleDownloadPdf} disabled={isDownloadingPdf}>
            {isDownloadingPdf ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FileDown className="mr-2 h-4 w-4" />
            )}
            PDF aç
          </Button>
          {record.isLinkedToPurchase && record.linkedInvoiceId ? (
            <Button asChild>
              <Link
                href={`/faturalar/${record.linkedInvoiceId}/onizleme?company=${encodeURIComponent(
                  companyId,
                )}`}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                İlişkili alış faturasını aç
              </Link>
            </Button>
          ) : (
            <Button onClick={handleConvertToPurchase}>
              <Repeat2 className="mr-2 h-4 w-4" />
              Alış Faturasına Dönüştür
            </Button>
          )}
        </div>
      </div>

      {record.isLinkedToPurchase && (
        <Card className="border-emerald-300 bg-emerald-50">
          <CardContent className="pt-6 text-sm text-emerald-900">
            Bu fatura zaten bir alış faturasına dönüştürülmüş. Stok ve cari hareketleri ilişkili
            faturadan görüntüleyebilirsiniz.
          </CardContent>
        </Card>
      )}

      {record.modelError && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="pt-6 text-sm text-amber-900">
            Kalem detayı Mysoft'tan alınamadı: {record.modelError}. Dönüştürme sırasında satırları
            elle gireceksiniz.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Fatura Bilgileri</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <Row label="Fatura No" value={record.invoiceNo} />
            <Row
              label="Tarih"
              value={record.date ? new Date(record.date).toLocaleDateString("tr-TR") : null}
            />
            <Row label="Profil" value={record.profile} />
            <Row label="Tip" value={record.invoiceType} />
            <Row label="Para Birimi" value={currency} />
            <Row label="Durum" value={record.status} />
            <Row label="Zarf" value={record.envelopeStatusDesc} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Gönderici</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <Row label="Unvan" value={record.sender.name} />
            <Row label="VKN/TCKN" value={record.sender.taxNumber} mono />
            <Row label="Adres" value={record.model?.sender.address || null} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tutarlar</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-4">
          <Amount label="Mal/Hizmet" value={fmt(record.taxExclusiveAmount, currency)} />
          <Amount label="KDV" value={fmt(record.vatAmount, currency)} />
          <Amount label="KDV Dahil" value={fmt(record.taxInclusiveAmount, currency)} />
          <Amount label="Ödenecek" value={fmt(record.totalAmount, currency)} highlight />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Kalemler</CardTitle>
          {lines.length === 0 && (
            <CardDescription>
              {record.modelError
                ? "Kalemler getirilemedi (yukarıdaki uyarıya bakın)"
                : "Bu faturada kalem bilgisi yok"}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {lines.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Açıklama</TableHead>
                  <TableHead>Kod</TableHead>
                  <TableHead>Birim</TableHead>
                  <TableHead className="text-right">Miktar</TableHead>
                  <TableHead className="text-right">Birim Fiyat</TableHead>
                  <TableHead className="text-right">İskonto</TableHead>
                  <TableHead className="text-right">KDV %</TableHead>
                  <TableHead className="text-right">Tutar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((ln, i) => (
                  <TableRow key={i}>
                    <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="text-xs">{ln.description || "-"}</TableCell>
                    <TableCell className="font-mono text-xs">{ln.productCode || "-"}</TableCell>
                    <TableCell className="text-xs">{ln.unit || "-"}</TableCell>
                    <TableCell className="text-right text-xs">
                      {ln.quantity !== null ? ln.quantity : "-"}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {fmt(ln.unitPrice, currency)}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {ln.discountAmount !== null ? fmt(ln.discountAmount, currency) : "-"}
                    </TableCell>
                    <TableCell className="text-right text-xs">
                      {ln.vatRate !== null ? `%${ln.vatRate}` : "-"}
                    </TableCell>
                    <TableCell className="text-right text-xs font-semibold">
                      {fmt(ln.lineTotal, currency)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell colSpan={8} className="text-right font-semibold">
                    Satır toplamı
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {fmt(lineSum, currency)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Row({
  label,
  value,
  mono,
}: {
  label: string
  value: string | null | undefined
  mono?: boolean
}) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-right" : "text-right"}>{value || "-"}</span>
    </div>
  )
}

function Amount({
  label,
  value,
  highlight,
}: {
  label: string
  value: string
  highlight?: boolean
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-xl ${highlight ? "font-bold" : "font-semibold"}`}>{value}</p>
    </div>
  )
}
