"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import {
  ArrowLeft,
  Banknote,
  Building2,
  FileSignature,
  FileText,
  Loader2,
  Printer,
  Trash2,
  User,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { ExportAction, WriteAction } from "@/components/dashboard/write-guard"
import { withCompanyHref } from "@/lib/company/href"
import {
  CEK_SENET_STATUSES,
  cekSenetStatusLabel,
  resolveCekSenetDirection,
} from "@/lib/cek-senet/labels"

type Mode = "CHECK" | "PROMISSORY_NOTE"

type CekSenetDetail = {
  id: string
  companyId: string
  checkNo?: string
  noteNo?: string
  bankName?: string | null
  branchName?: string | null
  accountNo?: string | null
  amount: string | number
  issueDate: string
  dueDate: string
  status: string
  direction?: string | null
  notes?: string | null
  createdAt: string
  customerId?: string | null
  supplierId?: string | null
  customer?: { id: string; name: string; taxNumber?: string | null } | null
  supplier?: { id: string; name: string; taxNumber?: string | null } | null
  invoice?: { id: string; invoiceNo: string; eDocumentNo?: string | null } | null
}

const COPY: Record<Mode, { instrument: string; listHref: string; notFound: string }> = {
  CHECK: { instrument: "Çek", listHref: "/cek-senet/cek", notFound: "Çek bulunamadı" },
  PROMISSORY_NOTE: { instrument: "Senet", listHref: "/cek-senet/senet", notFound: "Senet bulunamadı" },
}

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(amount)

const formatDate = (value: string) => new Date(value).toLocaleDateString("tr-TR")

const statusVariant = (status: string): "default" | "secondary" | "destructive" => {
  if (status === "TAHSİL_EDİLDİ") return "default"
  if (status === "PROTESTOLU" || status === "İADE_EDİLDİ") return "destructive"
  return "secondary"
}

export function CekSenetDetail({ mode }: { mode: Mode }) {
  const copy = COPY[mode]
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { toast } = useToast()
  const { confirm } = useConfirm()

  const id = params.id as string
  const companyId = searchParams.get("company")
  // Cari ekstresinden gelindiyse geri o cariye döner; yoksa portföy listesine.
  const fromParam = searchParams.get("from")
  const safeFrom = fromParam && fromParam.startsWith("/") ? fromParam : null
  const backHref = withCompanyHref(safeFrom || copy.listHref, companyId)

  const [item, setItem] = useState<CekSenetDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isSavingStatus, setIsSavingStatus] = useState(false)

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/cek-senet/${id}?type=${mode}`)
      const data = await res.json().catch(() => ({}))
      if (res.ok) setItem(data)
      else toast({ title: "Hata", description: data.error || copy.notFound, variant: "destructive" })
    } catch {
      toast({ title: "Hata", description: "Kayıt yüklenemedi", variant: "destructive" })
    } finally {
      setIsLoading(false)
    }
  }, [id, mode, copy.notFound, toast])

  useEffect(() => {
    load()
  }, [load])

  const evrakNo = item ? (mode === "CHECK" ? item.checkNo : item.noteNo) || "" : ""
  const isReceived = item
    ? resolveCekSenetDirection({ direction: item.direction, supplierId: item.supplierId }) === "RECEIVED"
    : true
  const kind = isReceived ? "Tahsilat" : "Ödeme"

  const handleStatusChange = async (status: string) => {
    if (!item || status === item.status) return
    setIsSavingStatus(true)
    try {
      const res = await fetch(`/api/cek-senet/${id}?type=${mode}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: mode, status }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: "Güncellenemedi", description: body.error || "İşlem başarısız", variant: "destructive" })
        return
      }
      setItem((prev) => (prev ? { ...prev, status } : prev))
      toast({ title: "Güncellendi", description: `Durum: ${cekSenetStatusLabel(status)}` })
    } catch (error) {
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      })
    } finally {
      setIsSavingStatus(false)
    }
  }

  const handleMakbuz = async () => {
    try {
      const res = await fetch(`/api/cek-senet/${id}/makbuz?type=${mode}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || "Makbuz üretilemedi")
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${mode === "CHECK" ? "Cek" : "Senet"}-${isReceived ? "Tahsilat" : "Odeme"}-Makbuzu-${evrakNo}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast({
        title: "Makbuz oluşturulamadı",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      })
    }
  }

  const handleDelete = async () => {
    if (!item) return
    const ok = await confirm({
      title: `${copy.instrument} sil`,
      description: `${evrakNo} · ${formatCurrency(Number(item.amount))} — Bu kaydı silmek istediğinize emin misiniz? Cari bakiyesindeki etkisi de kalkar.`,
      confirmLabel: "Sil",
      variant: "destructive",
    })
    if (!ok) return
    setIsDeleting(true)
    try {
      const res = await fetch(`/api/cek-senet/${id}?type=${mode}`, { method: "DELETE" })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: "Silinemedi", description: body.error || "İşlem başarısız", variant: "destructive" })
        return
      }
      toast({ title: "Silindi", description: `${copy.instrument} kaydı silindi.` })
      router.push(backHref)
    } catch (error) {
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      })
    } finally {
      setIsDeleting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    )
  }

  if (!item) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href={backHref}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Geri
          </Link>
        </Button>
        <div className="flex items-center justify-center p-8">
          <p className="text-muted-foreground">{copy.notFound}</p>
        </div>
      </div>
    )
  }

  // Cari linki kaydın KENDİ firmasını taşır: detay, aktif seçimden farklı bir
  // firmanın kaydı olabilir (şube/ek firma bağlamı).
  const cari = item.customer
    ? { kind: "customers" as const, ...item.customer }
    : item.supplier
      ? { kind: "suppliers" as const, ...item.supplier }
      : null
  const hrefCompany = companyId || item.companyId

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href={backHref} aria-label="Geri">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">
              {copy.instrument} Detayı
              <span className="ml-2 font-mono text-lg text-muted-foreground">{evrakNo}</span>
            </h1>
            <p className="text-sm text-muted-foreground">
              {isReceived ? "Alınan" : "Verilen"} · {kind} · Vade {formatDate(item.dueDate)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Makbuz belgeyi dışarı çıkarır: salt-okunur üyelikte basılmaz. */}
          <ExportAction>
            <Button variant="outline" onClick={handleMakbuz}>
              <Printer className="mr-2 h-4 w-4" />
              Makbuz (PDF)
            </Button>
          </ExportAction>
          <WriteAction>
            <Button
              variant="outline"
              className="text-rose-600 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              Sil
            </Button>
          </WriteAction>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {mode === "CHECK" ? (
              <Banknote className="h-5 w-5 text-muted-foreground" />
            ) : (
              <FileSignature className="h-5 w-5 text-muted-foreground" />
            )}
            {copy.instrument}
            <Badge variant={statusVariant(item.status)}>{cekSenetStatusLabel(item.status)}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            <Field label="Tutar">
              <span className={`text-lg font-semibold ${isReceived ? "text-green-600" : "text-red-600"}`}>
                {formatCurrency(Number(item.amount))}
              </span>
            </Field>
            <Field label={`${copy.instrument} No`}>
              <span className="font-mono">{evrakNo}</span>
            </Field>
            {mode === "CHECK" ? (
              <>
                <Field label="Banka">{item.bankName || <span className="text-muted-foreground">-</span>}</Field>
                <Field label="Şube">{item.branchName || <span className="text-muted-foreground">-</span>}</Field>
                <Field label="Hesap No">
                  {item.accountNo ? (
                    <span className="font-mono">{item.accountNo}</span>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </Field>
              </>
            ) : null}
            <Field label="Düzenleme Tarihi">{formatDate(item.issueDate)}</Field>
            <Field label="Vade Tarihi">{formatDate(item.dueDate)}</Field>
            <Field label="Yön">{isReceived ? "Alınan (tahsilat)" : "Verilen (ödeme)"}</Field>
            <Field label="Cari">
              {cari ? (
                <Link
                  href={withCompanyHref(`/cari/${cari.kind}/${cari.id}`, hrefCompany)}
                  className="inline-flex items-center gap-1.5 text-blue-600 hover:underline"
                >
                  {cari.kind === "customers" ? <User className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
                  {cari.name}
                  {cari.taxNumber ? <span className="text-muted-foreground">· {cari.taxNumber}</span> : null}
                </Link>
              ) : (
                <span className="text-muted-foreground">-</span>
              )}
            </Field>
            <Field label="Bağlı Fatura">
              {item.invoice ? (
                <Link
                  href={withCompanyHref(`/faturalar/${item.invoice.id}/onizleme`, hrefCompany)}
                  className="inline-flex items-center gap-1.5 text-blue-600 hover:underline"
                >
                  <FileText className="h-4 w-4" />
                  {item.invoice.eDocumentNo || item.invoice.invoiceNo}
                </Link>
              ) : (
                <span className="text-muted-foreground">-</span>
              )}
            </Field>
            <Field label="Durum">
              <WriteAction
                fallback={<Badge variant={statusVariant(item.status)}>{cekSenetStatusLabel(item.status)}</Badge>}
              >
                <Select value={item.status} onValueChange={handleStatusChange} disabled={isSavingStatus}>
                  <SelectTrigger className="max-w-[220px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CEK_SENET_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {cekSenetStatusLabel(status)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </WriteAction>
            </Field>
            <Field label="Notlar" full>
              {item.notes?.trim() ? item.notes : <span className="text-muted-foreground">-</span>}
            </Field>
            <Field label="Kayıt Tarihi">{new Date(item.createdAt).toLocaleString("tr-TR")}</Field>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? "sm:col-span-2" : undefined}>
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-0.5">{children}</div>
    </div>
  )
}
