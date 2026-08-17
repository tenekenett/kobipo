"use client"

import { useEffect, useState } from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Trash2, Loader2, Wallet, FileText, User, Building2, Printer } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { accountPaymentMethodLabel } from "@/lib/finans/account-types"

interface TransactionDetail {
  id: string
  date: string
  type: string
  amount: string | number
  currency: string
  description?: string | null
  reference?: string | null
  createdAt: string
  createdByUser?: { name: string | null; email: string } | null
  account: { id: string; name: string; type: string; bankName?: string | null }
  company?: {
    name?: string | null
    taxNumber?: string | null
    taxOffice?: string | null
    address?: string | null
    city?: string | null
    phone?: string | null
  } | null
  customer?: { id: string; name: string; taxNumber?: string | null } | null
  supplier?: { id: string; name: string; taxNumber?: string | null } | null
  invoicePayments: Array<{
    id: string
    amount: string | number
    invoice: { id: string; invoiceNo: string; type: string; totalAmount: string | number } | null
  }>
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(amount)
}

export default function FinansHareketDetayPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { toast } = useToast()
  const { confirm } = useConfirm()

  const id = params.id as string
  const companyId = searchParams.get("company")
  const fromParam = searchParams.get("from")
  const safeFrom = fromParam && fromParam.startsWith("/") ? fromParam : null
  const backHref = safeFrom
    ? `${safeFrom}${safeFrom.includes("?") ? "&" : "?"}company=${encodeURIComponent(companyId || "")}`
    : `/finans/hareketler?company=${encodeURIComponent(companyId || "")}`

  const [tx, setTx] = useState<TransactionDetail | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isDeleting, setIsDeleting] = useState(false)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    fetch(`/api/finans/transactions/${id}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (res.ok) setTx(data)
        else toast({ title: "Hata", description: data.error || "İşlem bulunamadı", variant: "destructive" })
      })
      .catch(() => {
        if (!cancelled) toast({ title: "Hata", description: "İşlem yüklenemedi", variant: "destructive" })
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id, toast])

  // Tür etiketi: müşteriye bağlıysa Tahsilat, tedarikçiye bağlıysa Ödeme, yoksa Gelir/Gider.
  const kind = tx
    ? tx.customer
      ? "Tahsilat"
      : tx.supplier
        ? "Ödeme"
        : tx.type === "INCOME"
          ? "Gelir"
          : tx.type === "EXPENSE"
            ? "Gider"
            : tx.type
    : ""
  const isIncome = tx?.type === "INCOME"

  const handleDelete = async () => {
    if (!tx) return
    const amount = Number(tx.amount)
    const ok = await confirm({
      title: `${kind} sil`,
      description: `${new Date(tx.date).toLocaleDateString("tr-TR")} · ${tx.account.name} · ${formatCurrency(amount)} — Bu ${kind.toLocaleLowerCase("tr-TR")} kaydını silmek istediğinize emin misiniz? Eşleştiği fatura varsa açık tutarı yeniden açılır ve hesap bakiyesi düzeltilir.`,
      confirmLabel: "Sil",
      variant: "destructive",
    })
    if (!ok) return
    setIsDeleting(true)
    try {
      const res = await fetch(`/api/finans/transactions/${id}`, { method: "DELETE" })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({ title: "Silinemedi", description: body.error || "İşlem başarısız", variant: "destructive" })
        return
      }
      toast({ title: "Silindi", description: `${kind} kaydı silindi.` })
      router.push(backHref)
    } catch (e: any) {
      toast({ title: "Hata", description: e?.message || "Silme sırasında hata", variant: "destructive" })
    } finally {
      setIsDeleting(false)
    }
  }

  const handleMakbuz = async () => {
    if (!tx) return
    // Makbuz SUNUCUDA üretilir (`/api/finans/transactions/[id]/makbuz`); istemcide
    // ikinci bir PDF düzeni tutmuyoruz.
    try {
      const res = await fetch(`/api/finans/transactions/${tx.id}/makbuz`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || "Makbuz üretilemedi")
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `${kind}-Makbuzu-${(tx.reference?.trim() || tx.id.slice(-8)).toUpperCase()}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (e: any) {
      toast({ title: "Makbuz oluşturulamadı", description: e?.message || undefined, variant: "destructive" })
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    )
  }

  if (!tx) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link href={backHref}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Geri
          </Link>
        </Button>
        <div className="flex items-center justify-center p-8">
          <p className="text-muted-foreground">İşlem bulunamadı</p>
        </div>
      </div>
    )
  }

  const cari = tx.customer
    ? { kind: "customers" as const, ...tx.customer }
    : tx.supplier
      ? { kind: "suppliers" as const, ...tx.supplier }
      : null

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
            <h1 className="text-2xl font-bold">{kind} Detayı</h1>
            <p className="text-sm text-muted-foreground">
              {new Date(tx.date).toLocaleDateString("tr-TR")} · {tx.account.name}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleMakbuz}>
            <Printer className="mr-2 h-4 w-4" />
            Makbuz (PDF)
          </Button>
          <Button
            variant="outline"
            className="text-rose-600 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300"
            onClick={handleDelete}
            disabled={isDeleting}
          >
            {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
            Sil
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-muted-foreground" />
            {kind}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            <Field label="Tutar">
              <span className={`text-lg font-semibold ${isIncome ? "text-green-600" : "text-red-600"}`}>
                {isIncome ? "+" : "-"}
                {formatCurrency(Number(tx.amount))}
              </span>
            </Field>
            <Field label="Tarih">{new Date(tx.date).toLocaleDateString("tr-TR")}</Field>
            <Field label="Ödeme Yöntemi">{accountPaymentMethodLabel(tx.account.type)}</Field>
            <Field label="Hesap">
              {tx.account.name}
              {tx.account.bankName ? <span className="text-muted-foreground"> · {tx.account.bankName}</span> : null}
            </Field>
            <Field label="Cari">
              {cari ? (
                <Link
                  href={`/cari/${cari.kind}/${cari.id}?company=${encodeURIComponent(companyId || "")}`}
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
            <Field label="Para Birimi">{tx.currency || "TRY"}</Field>
            {tx.reference ? <Field label="Referans">{tx.reference}</Field> : null}
            <Field label="Açıklama" full>
              {tx.description?.trim() ? tx.description : <span className="text-muted-foreground">-</span>}
            </Field>
            <Field label="Kayıt Tarihi">
              {new Date(tx.createdAt).toLocaleString("tr-TR")}
            </Field>
            {tx.createdByUser ? (
              <Field label="Oluşturan">{tx.createdByUser.name || tx.createdByUser.email}</Field>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {tx.invoicePayments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-muted-foreground" />
              Eşleştiği faturalar
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {tx.invoicePayments.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
                <span>
                  {p.invoice ? (
                    <Link
                      href={`/faturalar/${p.invoice.id}/onizleme?company=${encodeURIComponent(companyId || "")}`}
                      className="text-blue-600 hover:underline"
                    >
                      {p.invoice.invoiceNo}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">Fatura</span>
                  )}
                </span>
                <span className="font-medium tabular-nums">{formatCurrency(Number(p.amount))}</span>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Bu işlem silinirse yukarıdaki faturalara yapılan eşleşme kalkar ve açık tutar yeniden açılır.
            </p>
          </CardContent>
        </Card>
      )}
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
