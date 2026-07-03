"use client"

import { useEffect, useState } from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Download, ArrowLeft, Pencil, ShieldCheck, FileDown, Ban, Loader2, CheckCircle2, XCircle, Clock, AlertTriangle, Hash, Building2, Trash2, Printer, Copy, MoreVertical } from "lucide-react"
import Link from "next/link"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { useToast } from "@/components/ui/use-toast"
import { parseGibStatus } from "@/lib/integrations/e-invoice/status-display"
import { filenameFromContentDisposition } from "@/lib/utils"
import { looksLikeCuid } from "@/lib/slug"

const PROFILE_LABELS: Record<string, string> = {
  TICARIFATURA: "Ticari",
  TEMELFATURA: "Temel",
  EARSIVFATURA: "E-Arşiv",
  EFATURA: "E-Fatura",
}

function formatProfileLabel(profile: string | null | undefined): string | null {
  if (!profile) return null
  return PROFILE_LABELS[profile] ?? profile
}

interface Invoice {
  id: string
  slug?: string
  invoiceNo: string
  eDocumentNo?: string | null
  date: string
  dueDate?: string
  type: string
  invoiceType: string
  status: string
  netAmount: number
  vatAmount: number
  totalAmount: number
  notes?: string
  uuid?: string | null
  integrationStatus?: string | null
  integrationId?: string | null
  profile?: string | null
  incomingSource?: {
    uuid: string
    invoiceNo: string | null
    sender: { name: string | null; taxNumber: string | null }
  } | null
  customer?: {
    id: string
    name: string
    taxNumber?: string
    taxOffice?: string
    address?: string
    city?: string
    district?: string
  }
  supplier?: {
    id: string
    name: string
    taxNumber?: string
    taxOffice?: string
    address?: string
    city?: string
    district?: string
  }
  company: {
    name: string
    taxNumber?: string
    taxOffice?: string
    address?: string
    city?: string
  }
  items: Array<{
    id: string
    description: string
    quantity: number
    unitPrice: number
    discountRate?: number
    discountAmount?: number
    vatRate: number
    vatAmount: number
    totalAmount: number
    product?: { name: string; code?: string | null } | null
  }>
}

export default function FaturaOnizlemePage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const invoiceId = params.id as string
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [isDeleting, setIsDeleting] = useState(false)
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  // Yerel PDF şablonu sabit "standart" (Standart/Kurumsal seçimi kaldırıldı).
  const [template] = useState("standart")
  const [email, setEmail] = useState("")
  const [attachments, setAttachments] = useState<any[]>([])
  const [attachmentName, setAttachmentName] = useState("")
  const [isCheckingStatus, setIsCheckingStatus] = useState(false)
  const [isDownloadingGibPdf, setIsDownloadingGibPdf] = useState(false)
  const [isCancelling, setIsCancelling] = useState(false)
  const [isSendingToProvider, setIsSendingToProvider] = useState(false)
  const [isApproving, setIsApproving] = useState(false)
  const [profileDialogOpen, setProfileDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [cancelNote, setCancelNote] = useState("Kullanıcı tarafından iptal edildi")

  useEffect(() => {
    if (!invoiceId) return
    setIsLoading(true)
    setLoadError(null)
    setInvoice(null)
    void fetchInvoice()
  }, [invoiceId, companyId])

  const fetchInvoice = async () => {
    try {
      const qs = companyId ? `?companyId=${encodeURIComponent(companyId)}` : ""
      const response = await fetch(`/api/e-donusum/invoices/${invoiceId}${qs}`)
      if (response.ok) {
        const data = await response.json()
        if (!data.items) {
          data.items = []
        }
        setInvoice(data)
        fetchAttachments()
        setLoadError(null)
        // SEF: eski cuid URL ile gelindiyse okunabilir slug URL'ine sessizce yükselt.
        if (data?.slug && looksLikeCuid(String(invoiceId))) {
          router.replace(`/faturalar/${data.slug}/onizleme?company=${companyId}`)
        }
        return
      }
      const body = await response.json().catch(() => ({}))
      const msg =
        response.status === 401
          ? "Oturum süresi dolmuş olabilir. Lütfen tekrar giriş yapın."
          : response.status === 403
            ? "Bu faturaya erişim yetkiniz yok."
            : response.status === 400 && body.code === "COMPANY_MISMATCH"
              ? body.error ||
                "Bu fatura seçili firmaya ait değil. Üstten doğru şubeyi seçin veya Faturalar listesinden açın."
              : response.status === 404
                ? "Fatura bulunamadı veya silinmiş."
                : body.error || `Fatura yüklenemedi (${response.status}).`
      setLoadError(msg)
    } catch (error) {
      console.error("Error fetching invoice:", error)
      setLoadError("Fatura yüklenirken bir hata oluştu.")
    } finally {
      setIsLoading(false)
    }
  }

  const fetchAttachments = async () => {
    if (!companyId) return
    const response = await fetch(`/api/attachments?companyId=${companyId}&entityType=invoice&entityId=${invoiceId}`)
    if (response.ok) setAttachments(await response.json())
  }

  const handleDownloadPDF = () => {
    window.open(`/api/faturalar/${invoiceId}/pdf?template=${template}`, "_blank")
  }

  const handleCheckStatus = async () => {
    if (!invoice) return
    setIsCheckingStatus(true)
    try {
      const response = await fetch(`/api/e-donusum/invoices/${invoice.id}/check-status`, { method: "POST" })
      const data = await response.json()
      if (response.ok) {
        toast({
          title: `GİB Durumu: ${data.message}`,
          description: data.rawText ? `Mysoft kodu: ${data.rawText}` : undefined,
        })
        fetchInvoice()
      } else {
        toast({ title: "Sorgulanamadı", description: data.error || "Bilinmeyen hata", variant: "destructive" })
      }
    } catch (error: any) {
      toast({ title: "Hata", description: error?.message || "Hata oluştu", variant: "destructive" })
    } finally {
      setIsCheckingStatus(false)
    }
  }

  const handleDownloadGibPdf = async () => {
    if (!invoice) return
    setIsDownloadingGibPdf(true)
    try {
      const response = await fetch(`/api/e-donusum/invoices/${invoice.id}/pdf`)
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        toast({ title: "PDF indirilemedi", description: data.error || "Bilinmeyen hata", variant: "destructive" })
        return
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filenameFromContentDisposition(response.headers.get("Content-Disposition")) || `${invoice.invoiceNo}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast({ title: "Resmî PDF indirildi" })
    } catch (error: any) {
      toast({ title: "Hata", description: error?.message || "PDF indirilirken hata oluştu", variant: "destructive" })
    } finally {
      setIsDownloadingGibPdf(false)
    }
  }

  const handleApproveManual = async () => {
    if (!invoice) return
    if (!(await confirm({ title: "Faturayı kesinleştir", description: "Bu faturayı kesinleştirmek istediğinize emin misiniz?", confirmLabel: "Kesinleştir" }))) return
    setIsApproving(true)
    try {
      const res = await fetch(`/api/e-donusum/invoices/${invoice.id}/approve`, {
        method: "POST",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({
          title: "Onaylanamadı",
          description: data.error || "Bilinmeyen hata",
          variant: "destructive",
        })
        return
      }
      toast({ title: "Fatura onaylandı", description: "Durum: Kesinleşmiş" })
      fetchInvoice()
    } catch (e: any) {
      toast({
        title: "Hata",
        description: e?.message || "Onaylama sırasında hata",
        variant: "destructive",
      })
    } finally {
      setIsApproving(false)
    }
  }

  const performCancelInvoice = async () => {
    if (!invoice) return
    const note = cancelNote.trim()
    if (note.length < 3) {
      toast({ title: "İptal sebebi en az 3 karakter olmalı", variant: "destructive" })
      return
    }
    setIsCancelling(true)
    try {
      const response = await fetch(`/api/e-donusum/invoices/${invoice.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancelNote: note }),
      })
      const data = await response.json()
      if (response.ok) {
        toast({ title: "Fatura iptal edildi", description: data.message })
        setCancelDialogOpen(false)
        fetchInvoice()
      } else {
        toast({ title: "İptal edilemedi", description: data.error || "Bilinmeyen hata", variant: "destructive" })
      }
    } catch (error: any) {
      toast({ title: "Hata", description: error?.message || "İptal sırasında hata oluştu", variant: "destructive" })
    } finally {
      setIsCancelling(false)
    }
  }

  // Resmileştirme akışı: E-Fatura'da önce profil (Ticari/Temel) seçilir, sonra
  // ayrı bir onayla GİB'e gönderilir; iki adım taslakla GİB arasında "ön kontrol"
  // marjı bırakır. E-Arşiv'de profil seçimi yok, tek onayla gönderilir.
  const onClickSend = async () => {
    if (!invoice) return
    if (invoice.invoiceType === "E_INVOICE") {
      setProfileDialogOpen(true)
      return
    }
    await confirmAndSend()
  }

  // Profil seçildikten sonra (E-Fatura'da) veya doğrudan (E-Arşiv'de) çağrılır.
  // Resmileştirme öncesi son onay — kullanıcıya taslak PDF'ini kontrol etme fırsatı.
  const confirmAndSend = async (eInvoiceProfile?: "TICARIFATURA" | "TEMELFATURA") => {
    setProfileDialogOpen(false)
    const profileLabel = eInvoiceProfile
      ? eInvoiceProfile === "TICARIFATURA" ? " (Ticari Fatura)" : " (Temel Fatura)"
      : ""
    const docTypeLabel = invoice?.invoiceType === "E_INVOICE" ? "e-Fatura" : "e-Arşiv"
    const ok = await confirm({
      title: "Faturayı resmileştir",
      description: `Fatura${profileLabel} olarak Mysoft üzerinden GİB sistemine resmen iletilecek. Bu işlem geri alınamaz; ${docTypeLabel === "e-Fatura" ? "yalnız alıcıya iade faturası kesilebilir" : "yalnız iptal yoluyla geri alınabilir"}. Taslak PDF'ini kontrol ettiyseniz devam edebilirsiniz.`,
      confirmLabel: "Resmileştir ve Gönder",
      variant: "destructive",
    })
    if (!ok) return
    await handleSendToProvider(eInvoiceProfile)
  }

  const handleSendToProvider = async (eInvoiceProfile?: "TICARIFATURA" | "TEMELFATURA") => {
    if (!invoice) return
    setProfileDialogOpen(false)
    setIsSendingToProvider(true)
    try {
      const response = await fetch(`/api/e-donusum/invoices/${invoice.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(eInvoiceProfile ? { eInvoiceProfile } : {}),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error || "Gönderilemedi")
      }
      toast({
        title: "Fatura gönderildi",
        description: data.uuid ? `ETTN: ${data.uuid}` : "Fatura başarıyla iletildi.",
      })
      fetchInvoice()
    } catch (error: any) {
      toast({
        title: "Gönderim başarısız",
        description: error?.message || "Bilinmeyen hata",
        variant: "destructive",
      })
    } finally {
      setIsSendingToProvider(false)
    }
  }

  const performDelete = async () => {
    if (!invoice) return
    setIsDeleting(true)
    try {
      const qs = companyId ? `?companyId=${encodeURIComponent(companyId)}` : ""
      const res = await fetch(`/api/e-donusum/invoices/${invoiceId}${qs}`, { method: "DELETE" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({
          title: "Silinemedi",
          description: data.error || "Fatura silinemedi",
          variant: "destructive",
        })
        setDeleteDialogOpen(false)
        return
      }
      toast({ title: "Başarılı", description: "Fatura silindi." })
      // Silindikten sonra fatura sayfasında kalma; geldiğin yere (cari ya da
      // ilgili fatura listesine) dön.
      const fromParam = searchParams.get("from")
      const safeFrom = fromParam && fromParam.startsWith("/") ? fromParam : null
      const target = safeFrom
        ? `${safeFrom}${safeFrom.includes("?") ? "&" : "?"}company=${companyId || ""}`
        : invoice.type === "PURCHASE"
          ? `/alis/fatura?company=${companyId || ""}`
          : `/satis/fatura?company=${companyId || ""}`
      router.push(target)
    } catch (e: any) {
      toast({
        title: "Hata",
        description: e?.message || "Silme işlemi sırasında bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setIsDeleting(false)
    }
  }

  const handleSendEmail = async () => {
    const response = await fetch(`/api/faturalar/${invoiceId}/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    })
    if (!response.ok) {
      toast({ title: "E-posta gönderilemedi", variant: "destructive" })
      return
    }
    toast({ title: "E-posta gönderimi kuyruğa alındı" })
  }

  const createAttachment = async () => {
    if (!attachmentName || !companyId) return
    const response = await fetch("/api/attachments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId,
        entityType: "invoice",
        entityId: invoiceId,
        fileName: attachmentName,
        mimeType: "application/octet-stream",
      }),
    })
    if (response.ok) {
      setAttachmentName("")
      fetchAttachments()
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
    }).format(amount)
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Yükleniyor...</p>
      </div>
    )
  }

  if (!invoice) {
    return (
      <div className="mx-auto max-w-lg space-y-4 p-8 text-center">
        <p className="text-muted-foreground">{loadError || "Fatura bulunamadı"}</p>
        {companyId ? (
          <Button variant="outline" asChild>
            <Link href={`/satis/fatura?company=${encodeURIComponent(companyId)}`}>Faturalara dön</Link>
          </Button>
        ) : (
          <Button variant="outline" asChild>
            <Link href="/satis/fatura">Faturalara dön</Link>
          </Button>
        )}
      </div>
    )
  }

  const isFromIncoming = Boolean(invoice.incomingSource)
  // GİB tarafında ETTN'lenmiş bir e-Belge varsa resmî PDF tek geçerli belgedir;
  // bizim oluşturduğumuz şablon PDF'i göstermiyoruz. Bu koşul "Resmî PDF (GİB)"
  // butonunun göründüğü koşulla aynı.
  const hasOfficialGibPdf =
    Boolean(invoice.uuid) &&
    (invoice.invoiceType === "E_INVOICE" || invoice.invoiceType === "E_ARCHIVE")
  // Geri butonu: Faturaya bir cari kartından gelindiyse (`from` parametresi),
  // o carinin detayına dön. Aksi halde fatura tipine göre ilgili listeye dön —
  // gelen e-faturadan dönüştürülmüş olsa bile artık bir Alış Faturası.
  const fromParam = searchParams.get("from")
  const safeFrom = fromParam && fromParam.startsWith("/") ? fromParam : null
  const backHref = safeFrom
    ? `${safeFrom}${safeFrom.includes("?") ? "&" : "?"}company=${companyId || ""}`
    : invoice.type === "PURCHASE"
      ? `/alis/fatura?company=${companyId || ""}`
      : `/satis/fatura?company=${companyId || ""}`

  // Cariye git: alış faturasında tedarikçinin, diğerlerinde müşterinin kartına
  // git. Faturaya doğrudan (cari dışından) gelinse bile cariye ulaşılabilsin.
  // Ancak zaten bir cari kartından gelindiyse (Geri butonu cariye dönüyor)
  // "Cariye Git" butonunu göstermeye gerek yok.
  const cameFromCari = Boolean(safeFrom && safeFrom.startsWith("/cari/"))
  const cari =
    cameFromCari
      ? null
      : invoice.type === "PURCHASE"
      ? invoice.supplier
        ? { id: invoice.supplier.id, name: invoice.supplier.name, segment: "suppliers" as const }
        : null
      : invoice.customer
        ? { id: invoice.customer.id, name: invoice.customer.name, segment: "customers" as const }
        : null
  // Cariye giderken `from` ile bu faturayı işaret et ki carideki "Geri" butonu
  // (cari listesine değil) tekrar bu faturaya dönsün.
  const cariHref = cari
    ? `/cari/${cari.segment}/${cari.id}?company=${companyId || ""}&from=${encodeURIComponent(`/faturalar/${invoiceId}/onizleme`)}`
    : null

  // Kopya oluştur: bu faturanın değerleriyle dolu, güncel tarihli yeni bir TASLAK
  // editör ekranı açar. Kaydedilene kadar hiçbir şey oluşmaz / gönderilmez.
  const duplicateHref = `/e-donusum/yeni?company=${encodeURIComponent(companyId || "")}&duplicate=${invoiceId}&from=${encodeURIComponent(`/faturalar/${invoiceId}/onizleme`)}`

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Link href={backHref}>
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Geri
            </Button>
          </Link>
          {cariHref && cari && (
            <Link href={cariHref}>
              <Button variant="outline" size="sm" title={`${cari.name} cari kartına git`}>
                <Building2 className="h-4 w-4 mr-2" />
                Cariye Git
              </Button>
            </Link>
          )}
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-3">
              {invoice.status === "DRAFT" ? "Fatura Önizleme" : "Fatura Detayı"}
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  invoice.status === "SENT"
                    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
                    : invoice.status === "DRAFT"
                      ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
                      : invoice.status === "CANCELLED"
                        ? "bg-gray-200 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300"
                        : "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300"
                }`}
              >
                {invoice.status === "SENT"
                  ? "Onaylandı"
                  : invoice.status === "DRAFT"
                    ? "Taslak"
                    : invoice.status === "CANCELLED"
                      ? "İptal Edildi"
                      : invoice.status}
              </span>
            </h1>
            <p className="text-muted-foreground">Fatura No: {invoice.eDocumentNo || invoice.invoiceNo}</p>
            {isFromIncoming && invoice.incomingSource && (
              <p className="text-xs text-sky-700">
                Gelen e-faturadan dönüştürüldü · Gönderen:{" "}
                {invoice.incomingSource.sender.name || "-"}
                {invoice.incomingSource.sender.taxNumber
                  ? ` (${invoice.incomingSource.sender.taxNumber})`
                  : ""}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {invoice.status === "DRAFT" && (
            <Link
              href={`/e-donusum/${invoiceId}/duzenle?company=${encodeURIComponent(companyId || "")}&from=${encodeURIComponent(`/faturalar/${invoiceId}/onizleme`)}`}
            >
              <Button variant="outline">
                <Pencil className="h-4 w-4 mr-2" />
                Düzenle
              </Button>
            </Link>
          )}
          {invoice.status === "DRAFT" &&
            !invoice.uuid &&
            (invoice.invoiceType === "E_INVOICE" || invoice.invoiceType === "E_ARCHIVE") && (
              <Button
                onClick={onClickSend}
                disabled={isSendingToProvider}
                className="bg-kobipo-blue hover:bg-kobipo-blue/90 dark:bg-primary dark:hover:bg-primary/90"
              >
                {isSendingToProvider ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ShieldCheck className="mr-2 h-4 w-4" />
                )}
                Resmileştir
              </Button>
            )}
          {invoice.status === "DRAFT" && invoice.invoiceType === "MANUAL" && (
            <Button
              onClick={handleApproveManual}
              disabled={isApproving}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {isApproving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              )}
              Onayla
            </Button>
          )}

          {/* Çıktı aksiyonları: resmî GİB PDF veya yerel PDF */}
          {invoice.uuid && (invoice.invoiceType === "E_INVOICE" || invoice.invoiceType === "E_ARCHIVE") && (
            <Button
              variant="outline"
              onClick={handleDownloadGibPdf}
              disabled={isDownloadingGibPdf}
              title="Mysoft / GİB tarafından üretilen yasal PDF"
            >
              {isDownloadingGibPdf ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
              Resmî PDF (GİB)
            </Button>
          )}
          {!hasOfficialGibPdf && (
            <Button onClick={handleDownloadPDF}>
              <Download className="h-4 w-4 mr-2" />
              PDF İndir
            </Button>
          )}

          <Link href={duplicateHref}>
            <Button variant="outline" title="Bu faturanın değerleriyle güncel tarihli yeni bir taslak oluştur">
              <Copy className="h-4 w-4 mr-2" />
              Kopya Oluştur
            </Button>
          </Link>

          {/* Diğer işlemler: e-posta, yazdır, GİB, iptal, sil */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Diğer işlemler">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <div className="flex items-center gap-2 px-2 py-1.5">
                <Input
                  className="h-8"
                  placeholder="E-posta (opsiyonel)"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                />
                <Button size="sm" variant="outline" onClick={handleSendEmail}>
                  Gönder
                </Button>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="cursor-pointer" onClick={() => window.print()}>
                <Printer className="mr-2 h-4 w-4" />
                Yazdır
              </DropdownMenuItem>
              {invoice.uuid && (invoice.invoiceType === "E_INVOICE" || invoice.invoiceType === "E_ARCHIVE") && (
                <>
                  <DropdownMenuItem className="cursor-pointer" onClick={handleCheckStatus} disabled={isCheckingStatus}>
                    {isCheckingStatus ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                    GİB Durumu
                  </DropdownMenuItem>
                  {invoice.invoiceType === "E_ARCHIVE" && invoice.status !== "CANCELLED" && (
                    <DropdownMenuItem
                      className="cursor-pointer text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
                      onSelect={(e) => {
                        e.preventDefault()
                        setCancelNote("Kullanıcı tarafından iptal edildi")
                        setCancelDialogOpen(true)
                      }}
                      disabled={isCancelling}
                    >
                      {isCancelling ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Ban className="mr-2 h-4 w-4" />}
                      İptal Et
                    </DropdownMenuItem>
                  )}
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
                onSelect={(e) => {
                  e.preventDefault()
                  setDeleteDialogOpen(true)
                }}
                disabled={isDeleting}
              >
                {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                Sil
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Durum şeridi: iç status + GİB durumu + ETTN */}
      {(invoice.uuid || invoice.integrationStatus) && (
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`px-3 py-1 rounded-full text-sm font-medium ${
              invoice.status === "SENT"
                ? "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300"
                : invoice.status === "DRAFT"
                ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300"
                : invoice.status === "CANCELLED"
                ? "bg-gray-200 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300"
                : "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300"
            }`}
          >
            {invoice.status === "SENT"
              ? "Gönderildi"
              : invoice.status === "DRAFT"
              ? "Taslak"
              : invoice.status === "CANCELLED"
              ? "İptal Edildi"
              : invoice.status}
          </span>
          {(() => {
            const gib = parseGibStatus(invoice.integrationStatus)
            if (!gib) return null
            const style = gib.bucket === "approved"
              ? { wrap: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300", Icon: CheckCircle2 }
              : gib.bucket === "rejected"
              ? { wrap: "border-red-300 bg-red-50 text-red-800 dark:bg-red-500/15 dark:text-red-300", Icon: XCircle }
              : gib.bucket === "cancelled"
              ? { wrap: "border-gray-300 bg-gray-100 text-gray-700 dark:bg-gray-500/15 dark:text-gray-300", Icon: Ban }
              : gib.bucket === "processing"
              ? { wrap: "border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300", Icon: Clock }
              : { wrap: "border-slate-300 bg-slate-50 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300", Icon: ShieldCheck }
            const Icon = style.Icon
            return (
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium border ${style.wrap}`}
                title={gib.detail || undefined}
              >
                <Icon className="h-4 w-4" />
                GİB: {gib.label}
              </span>
            )
          })()}
          {invoice.uuid && (
            <span className="text-xs text-muted-foreground font-mono">
              ETTN: {invoice.uuid}
            </span>
          )}
        </div>
      )}

      {/* Hatalı entegrasyon durumunda kullanıcıya somut bir CTA göster */}
      {typeof invoice.integrationStatus === "string" &&
        invoice.integrationStatus.startsWith("ERROR:") && (() => {
          const errMsg = invoice.integrationStatus!.replace(/^ERROR:/, "")
          const isNumeratorError = /numarat[öo]r/i.test(errMsg)
          return (
            <div className="flex flex-wrap items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold">Mysoft gönderimi başarısız</p>
                <p className="mt-1 break-words">{errMsg}</p>
                {isNumeratorError && companyId && (
                  <div className="mt-2">
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/e-donusum/seri-no?company=${encodeURIComponent(companyId)}`}>
                        <Hash className="mr-2 h-4 w-4" />
                        Seri No Tanımları'na git
                      </Link>
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )
        })()}

      <Card>
        <CardHeader>
          <CardTitle>
            {invoice.invoiceType === "E_INVOICE"
              ? "E-FATURA"
              : invoice.invoiceType === "E_ARCHIVE"
                ? "E-ARŞİV FATURA"
                : "FATURA"}
          </CardTitle>
          <CardDescription>
            {invoice.type === "SALES"
              ? "Satış Faturası"
              : invoice.type === "PURCHASE"
                ? "Alış Faturası"
                : invoice.type === "RETURN"
                  ? "İade Faturası"
                  : invoice.type}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <div className="rounded-lg border bg-muted/30 p-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Firma Bilgileri</h3>
              <p className="font-medium">{invoice.company.name}</p>
              {invoice.company.taxNumber && (
                <p className="text-sm text-muted-foreground">VKN: {invoice.company.taxNumber}</p>
              )}
              {invoice.company.address && (
                <p className="text-sm text-muted-foreground">{invoice.company.address}</p>
              )}
              {invoice.company.city && (
                <p className="text-sm text-muted-foreground">{invoice.company.city}</p>
              )}
            </div>
            <div className="rounded-lg border bg-muted/30 p-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {invoice.type === "SALES" ? "Müşteri Bilgileri" : "Tedarikçi Bilgileri"}
              </h3>
              {invoice.type === "SALES" && invoice.customer ? (
                <>
                  <Link
                    href={`/cari/customers/${invoice.customer.id}?company=${companyId || ""}&from=${encodeURIComponent(`/faturalar/${invoiceId}/onizleme`)}`}
                    className="font-medium text-blue-600 hover:underline"
                  >
                    {invoice.customer.name}
                  </Link>
                  {invoice.customer.taxNumber && (
                    <p className="text-sm text-muted-foreground">VKN: {invoice.customer.taxNumber}</p>
                  )}
                  {invoice.customer.address && (
                    <p className="text-sm text-muted-foreground">{invoice.customer.address}</p>
                  )}
                  {(invoice.customer.district || invoice.customer.city) && (
                    <p className="text-sm text-muted-foreground">
                      {[invoice.customer.district, invoice.customer.city].filter(Boolean).join(" / ")}
                    </p>
                  )}
                </>
              ) : invoice.supplier ? (
                <>
                  <Link
                    href={`/cari/suppliers/${invoice.supplier.id}?company=${companyId || ""}&from=${encodeURIComponent(`/faturalar/${invoiceId}/onizleme`)}`}
                    className="font-medium text-blue-600 hover:underline"
                  >
                    {invoice.supplier.name}
                  </Link>
                  {invoice.supplier.taxNumber && (
                    <p className="text-sm text-muted-foreground">VKN: {invoice.supplier.taxNumber}</p>
                  )}
                  {invoice.supplier.address && (
                    <p className="text-sm text-muted-foreground">{invoice.supplier.address}</p>
                  )}
                  {(invoice.supplier.district || invoice.supplier.city) && (
                    <p className="text-sm text-muted-foreground">
                      {[invoice.supplier.district, invoice.supplier.city].filter(Boolean).join(" / ")}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground">Bilgi yok</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <div className="rounded-lg border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Fatura No</p>
              <p className="font-medium tabular-nums">{invoice.eDocumentNo || invoice.invoiceNo}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Tarih</p>
              <p className="font-medium tabular-nums">{new Date(invoice.date).toLocaleDateString("tr-TR")}</p>
            </div>
            {invoice.dueDate && (
              <div className="rounded-lg border p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Vade Tarihi</p>
                <p className="font-medium tabular-nums">{new Date(invoice.dueDate).toLocaleDateString("tr-TR")}</p>
              </div>
            )}
            <div className="rounded-lg border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Durum</p>
              <p className="font-medium">
                {invoice.status === "SENT" ? "Gönderildi" : invoice.status === "DRAFT" ? "Taslak" : invoice.status}
                {(() => {
                  const profileLabel = formatProfileLabel(invoice.profile)
                  return profileLabel ? (
                    <span className="ml-1 text-muted-foreground">({profileLabel})</span>
                  ) : null
                })()}
              </p>
            </div>
          </div>

          <Table className="tabular-nums">
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Ürün</TableHead>
                <TableHead className="text-right">Miktar</TableHead>
                <TableHead className="text-right">Birim Fiyat</TableHead>
                <TableHead className="text-right">Iskonto</TableHead>
                <TableHead className="text-right">KDV %</TableHead>
                <TableHead className="text-right">KDV Tutarı</TableHead>
                <TableHead className="text-right">Tutar</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.items && invoice.items.length > 0 ? (
                invoice.items.map((item: any, index: number) => {
                  const productName = item.product?.name?.trim()
                  const description = item.description?.trim()
                  // Ürün adı bağlıysa onu üstte göster, description'ı ek "Açıklama:"
                  // etiketiyle altında. Ürün bağlı değilse description'ı ürün adı
                  // gibi bold göstermek yerine etiketli sade metin olarak ver — aksi
                  // halde "Gelen e-fatura DEZ... (ETTN ...)" gibi içe aktarma
                  // metaverisi yanlışlıkla ürün adı sanılıyor.
                  const showDescription =
                    description && description !== productName
                  return (
                  <TableRow key={item.id || index}>
                    <TableCell>{index + 1}</TableCell>
                    <TableCell>
                      {productName ? (
                        <>
                          {item.product?.id ? (
                            <Link
                              href={`/stok/${item.product.id}?company=${companyId || ""}`}
                              className="font-medium text-blue-600 hover:underline"
                              title={`${productName} ürün/hizmet kartına git`}
                            >
                              {productName}
                            </Link>
                          ) : (
                            <div className="font-medium text-foreground">{productName}</div>
                          )}
                          {showDescription && (
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              <span className="font-medium">Açıklama:</span> {description}
                            </div>
                          )}
                        </>
                      ) : description ? (
                        // Katalog ürünü bağlı değil (manuel/içe aktarılan kalem):
                        // description satırın mal/hizmet adıdır → ürün adı gibi göster.
                        // (İçe aktarma metaverisi/ETTN açıklamaya değil, fatura notlarına yazılır.)
                        <div className="font-medium text-foreground">{description}</div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                      {(item.withholdingCode || Number(item.withholdingRate) > 0) && (
                        <div className="mt-1 inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                          Tevkifat{item.withholdingCode ? ` ${item.withholdingCode}` : ""}
                          {item.withholdingName ? ` · ${item.withholdingName}` : ""} · KDV %{Number(item.withholdingRate) || 0}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {Number(item.quantity || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right">{formatCurrency(Number(item.unitPrice || 0))}</TableCell>
                    <TableCell className="text-right">
                      -{formatCurrency(Number(item.discountAmount || 0))}
                      {Number(item.discountRate || 0) > 0 && (
                        <div className="text-xs text-muted-foreground">%{Number(item.discountRate || 0)}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">%{Number(item.vatRate || 0)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(Number(item.vatAmount || 0))}</TableCell>
                    <TableCell className="text-right font-medium">{formatCurrency(Number(item.totalAmount || 0))}</TableCell>
                  </TableRow>
                  )
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    Fatura kalemi bulunamadı
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          {(() => {
            const grossTotal = invoice.items.reduce(
              (sum, it) => sum + Number(it.quantity || 0) * Number(it.unitPrice || 0),
              0,
            )
            const lineDiscountTotal = invoice.items.reduce(
              (sum, it) => sum + Number(it.discountAmount || 0),
              0,
            )
            const globalDiscount = Number((invoice as any).globalDiscountAmount || 0)
            const withholdingTotal = invoice.items.reduce(
              (sum, it) => sum + Number((it as any).withholdingAmount || 0),
              0,
            )
            return (
              <div className="flex justify-end mt-6">
                <div className="w-80 space-y-2 rounded-lg border bg-muted/30 p-4 tabular-nums">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Ara Toplam</span>
                    <span>{formatCurrency(grossTotal)}</span>
                  </div>
                  {lineDiscountTotal > 0 && (
                    <div className="flex justify-between text-sm text-red-600 dark:text-red-400">
                      <span>Satır İskontoları</span>
                      <span>- {formatCurrency(lineDiscountTotal)}</span>
                    </div>
                  )}
                  {globalDiscount > 0 && (
                    <div className="flex justify-between text-sm text-red-600 dark:text-red-400">
                      <span>Fatura İskontosu</span>
                      <span>- {formatCurrency(globalDiscount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t pt-2 text-sm">
                    <span className="text-muted-foreground">Matrah</span>
                    <span>{formatCurrency(invoice.netAmount)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">KDV Toplam</span>
                    <span>{formatCurrency(invoice.vatAmount)}</span>
                  </div>
                  {withholdingTotal > 0 && (
                    <div className="flex justify-between text-sm text-red-600 dark:text-red-400">
                      <span>Tevkifat (KDV)</span>
                      <span>- {formatCurrency(withholdingTotal)}</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t pt-2 text-lg font-bold">
                    <span>Genel Toplam</span>
                    <span className="text-green-600 dark:text-green-400">{formatCurrency(invoice.totalAmount)}</span>
                  </div>
                </div>
              </div>
            )
          })()}

          {invoice.notes && (
            <div className="mt-6 p-4 bg-muted rounded-lg">
              <p className="text-sm font-medium mb-2">Notlar:</p>
              <p className="text-sm text-muted-foreground">{invoice.notes}</p>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Ek Belgeler</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="Dosya adı (simülasyon)" value={attachmentName} onChange={(e) => setAttachmentName(e.target.value)} />
            <Button onClick={createAttachment}>Ekle</Button>
          </div>
          {attachments.map((attachment) => (
            <div key={attachment.id} className="rounded border p-2 text-sm">
              {attachment.fileName} - <span className="text-muted-foreground">{attachment.filePath}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* E-Fatura profil seçimi: resmileştirmeden (göndermeden) önce Ticari mi
          Temel mi sorulur. Temel = alıcı yanıtı beklemez; Ticari = alıcı kabul/
          ret yanıtı verebilir. */}
      <Dialog open={profileDialogOpen} onOpenChange={setProfileDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>E-Fatura Profili Seçin</DialogTitle>
            <DialogDescription>
              Profil tipini seçin. Bir sonraki adımda son onayla GİB'e resmileştirilir;
              isterseniz öncesinde PDF'i indirip kontrol edebilirsiniz.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <button
              type="button"
              onClick={() => confirmAndSend("TICARIFATURA")}
              disabled={isSendingToProvider}
              className="rounded-lg border p-4 text-left transition-colors hover:border-primary hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
            >
              <p className="font-semibold">Ticari Fatura</p>
              <p className="text-sm text-muted-foreground">
                Alıcı faturaya kabul/ret yanıtı verebilir.
              </p>
            </button>
            <button
              type="button"
              onClick={() => confirmAndSend("TEMELFATURA")}
              disabled={isSendingToProvider}
              className="rounded-lg border p-4 text-left transition-colors hover:border-primary hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
            >
              <p className="font-semibold">Temel Fatura</p>
              <p className="text-sm text-muted-foreground">
                Alıcı yanıt veremez; fatura doğrudan kesilmiş sayılır.
              </p>
            </button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProfileDialogOpen(false)} disabled={isSendingToProvider}>
              Vazgeç
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Silme onayı */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="Faturayı sil"
        description="Bu faturayı silmek istediğinize emin misiniz? Bu işlem stokları ve cari bakiyeleri geri alır ve geri alınamaz. (GİB'e gönderilmiş faturalar silinemez; önce iptal edin.)"
        confirmLabel="Sil"
        variant="destructive"
        isProcessing={isDeleting}
        onConfirm={performDelete}
        icon={<Trash2 className="h-5 w-5 text-destructive" />}
      />

      {/* e-Arşiv iptal onayı (sebep girişiyle) */}
      <ConfirmDialog
        open={cancelDialogOpen}
        onOpenChange={setCancelDialogOpen}
        title="e-Arşiv faturayı iptal et"
        description="Fatura GİB nezdinde iptal edilecek ve stok/bakiye geri alınacaktır. Bu işlem geri alınamaz. İptal sebebini girin (en az 3 karakter)."
        confirmLabel="İptal Et"
        variant="destructive"
        isProcessing={isCancelling}
        confirmDisabled={cancelNote.trim().length < 3}
        onConfirm={performCancelInvoice}
        icon={<Ban className="h-5 w-5 text-destructive" />}
      >
        <div className="space-y-1.5">
          <label htmlFor="cancel-note" className="text-sm font-medium">
            İptal sebebi
          </label>
          <Input
            id="cancel-note"
            value={cancelNote}
            onChange={(e) => setCancelNote(e.target.value)}
            placeholder="Örn. Hatalı düzenlendi"
            autoFocus
          />
        </div>
      </ConfirmDialog>
    </div>
  )
}

