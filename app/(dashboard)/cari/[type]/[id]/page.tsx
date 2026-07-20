"use client"

import { useEffect, useState } from "react"
import { useParams, useSearchParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useToast } from "@/components/ui/use-toast"
import { ArrowLeft, Mail, Phone, MapPin, Building2, FileText, TrendingUp, TrendingDown, Plus, Pencil, Archive, Trash2, Wallet, MoreVertical, User, ChevronRight } from "lucide-react"
import Link from "next/link"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { TransactionDialog } from "@/components/cari/transaction-dialog"
import { CariArchiveDeleteDialog } from "@/components/cari/cari-archive-delete-dialog"
import { CariFislerSection } from "@/components/cari/cari-fisler-section"
import { looksLikeCuid } from "@/lib/slug"

// İsimden baş harf(ler) üret: "Acme Ltd" → "AL", "Ahmet" → "AH"
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0].slice(0, 2).toLocaleUpperCase("tr-TR")
  return (parts[0][0] + parts[parts.length - 1][0]).toLocaleUpperCase("tr-TR")
}

interface Transaction {
  id: string
  date: string
  createdAt?: string
  type: string
  isReceipt?: boolean
  converted?: boolean
  convertedToId?: string | null
  convertedToNo?: string | null
  receiptAmount?: number
  description: string
  debit: number
  credit: number
  balance: number
  invoiceNo?: string
}

interface Deletability {
  canDelete: boolean
  canArchive: boolean
  deleteBlockReasons: string[]
  archiveBlockReasons: string[]
}

interface CustomerSupplierDetail {
  id: string
  code?: string
  slug?: string
  name: string
  taxNumber?: string
  taxOffice?: string
  address?: string
  city?: string
  district?: string
  phone?: string
  email?: string
  contactPerson?: string
  balance: number
  totalDebit: number
  totalCredit: number
  invoiceCount: number
  transactions: Transaction[]
  archivedAt?: string | null
  deletability?: Deletability
}

interface FinancialAccount {
  id: string
  name: string
  bankName?: string
}

export default function CustomerSupplierDetailPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const { toast } = useToast()

  const type = params.type as "customers" | "suppliers"
  const id = params.id as string
  const companyId = searchParams.get("company")
  const fromParam = searchParams.get("from")
  const safeFrom = fromParam && fromParam.startsWith("/") ? fromParam : null
  const backHref = safeFrom
    ? `${safeFrom}${safeFrom.includes("?") ? "&" : "?"}company=${encodeURIComponent(companyId || "")}`
    : `/cari?company=${encodeURIComponent(companyId || "")}`
  
  const [data, setData] = useState<CustomerSupplierDetail | null>(null)
  const [accounts, setAccounts] = useState<FinancialAccount[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isTransactionDialogOpen, setIsTransactionDialogOpen] = useState(false)
  const [cariAction, setCariAction] = useState<"archive" | "delete" | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

  const isCustomer = type === "customers"
  const entityLabel = isCustomer ? "Müşteri" : "Tedarikçi"
  const endpoint = isCustomer ? "customers" : "suppliers"
  // Arşivleme/silme sonrası dönülecek liste (ilgili sekme açık).
  const listHref = `/cari?tab=${endpoint}&company=${companyId || ""}`

  const performArchive = async () => {
    if (!data) return
    setIsProcessing(true)
    try {
      const res = await fetch(`/api/cari/${endpoint}/${id}?companyId=${companyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "archive" }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({
          title: "Arşivlenemedi",
          description: (body.reasons && body.reasons.join(" ")) || body.error || "İşlem başarısız",
          variant: "destructive",
        })
        return
      }
      toast({ title: "Arşivlendi", description: `${entityLabel} kaydı arşivlendi.` })
      setCariAction(null)
      router.push(listHref)
    } catch (e: any) {
      toast({ title: "Hata", description: e?.message || "Arşivleme sırasında hata", variant: "destructive" })
    } finally {
      setIsProcessing(false)
    }
  }

  const performDelete = async () => {
    if (!data) return
    setIsProcessing(true)
    try {
      const res = await fetch(`/api/cari/${endpoint}/${id}?companyId=${companyId}`, {
        method: "DELETE",
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast({
          title: "Silinemedi",
          description: (body.reasons && body.reasons.join(" ")) || body.error || "İşlem başarısız",
          variant: "destructive",
        })
        return
      }
      toast({ title: "Silindi", description: `${entityLabel} kaydı silindi.` })
      setCariAction(null)
      router.push(listHref)
    } catch (e: any) {
      toast({ title: "Hata", description: e?.message || "Silme sırasında hata", variant: "destructive" })
    } finally {
      setIsProcessing(false)
    }
  }

  useEffect(() => {
    if (id && companyId) {
      fetchData()
      fetchAccounts()
    }
  }, [id, companyId])

  const fetchData = async () => {
    try {
      const endpoint = isCustomer ? "customers" : "suppliers"
      const response = await fetch(`/api/cari/${endpoint}/${id}?companyId=${companyId}`)
      if (response.ok) {
        const result = await response.json()
        setData(result)
        // SEF: eski cuid URL ile gelindiyse okunabilir slug URL'ine sessizce yükselt.
        if (result?.slug && looksLikeCuid(String(id))) {
          router.replace(`/cari/${endpoint}/${result.slug}?company=${companyId}`)
        }
      } else {
        toast({
          title: "Hata",
          description: `${entityLabel} bulunamadı`,
          variant: "destructive",
        })
        router.push(`/cari?company=${companyId}`)
      }
    } catch (error) {
      console.error("Error fetching data:", error)
      toast({
        title: "Hata",
        description: "Veriler yüklenemedi",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const fetchAccounts = async () => {
    if (!companyId) return
    try {
      const response = await fetch(`/api/finans/accounts?companyId=${companyId}`)
      if (response.ok) {
        const result = await response.json()
        setAccounts(result)
      }
    } catch (error) {
      console.error("Error fetching accounts:", error)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">{entityLabel} bulunamadı</p>
      </div>
    )
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "TRY",
    }).format(amount)
  }

  // API ekstreyi kronolojik (eski→yeni) ve kümülatif bakiyeli döndürür. Ekranda
  // en yeni hareket en üstte olsun diye ters çeviriyoruz; her satırın yürüyen
  // bakiyesi o hareket anındaki bakiyeyi gösterir (banka ekstresi mantığı).
  const orderedTransactions = [...data.transactions].reverse()

  // Renk şirket gözünden ("lehimize mi?"). Müşteride pozitif bakiye = müşteri bize
  // borçlu = bizim alacağımız (lehimize, yeşil). Tedarikçide ise pozitif bakiye =
  // biz ona borçluyuz (aleyhimize); o yüzden işaret tersine çevrilir.
  const balanceFavorable = isCustomer ? data.balance >= 0 : data.balance <= 0

  // Etiket cari hesabın kendi durumunu anlatır (ekstre ve Toplam Borç/Alacak ile
  // aynı perspektif). Müşteride pozitif bakiye = müşteri "Borçlu"; tedarikçide
  // pozitif bakiye = biz ona borçluyuz, yani tedarikçi "Alacaklı".
  const cariOwesUs = isCustomer ? data.balance > 0 : data.balance < 0
  const balanceLabel =
    data.balance === 0 ? "Kapalı" : cariOwesUs ? "Borçlu" : "Alacaklı"

  // Durum rozeti rengi: kapalı=nötr, lehimize=yeşil, aleyhimize=kırmızı.
  const balanceBadgeClass =
    data.balance === 0
      ? "bg-gray-100 text-gray-700 dark:bg-gray-500/15 dark:text-gray-300"
      : balanceFavorable
        ? "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300"
        : "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <Link href={backHref}>
            <Button variant="ghost" size="icon" className="mt-1">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div
            className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-semibold ${
              isCustomer
                ? "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
                : "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300"
            }`}
          >
            {getInitials(data.name)}
          </div>
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold sm:text-3xl">{data.name}</h1>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${balanceBadgeClass}`}>
                {balanceLabel}
              </span>
              {data.archivedAt && (
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                  Arşivlenmiş
                </span>
              )}
            </div>
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <User className="h-3.5 w-3.5" />
              {entityLabel}
              {data.code && ` · Kod: ${data.code}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/e-donusum/yeni?company=${companyId}&type=${isCustomer ? "SALES" : "PURCHASE"}&${isCustomer ? "customerId" : "supplierId"}=${data.id}&from=${encodeURIComponent(`/cari/${type}/${id}`)}`}
          >
            <Button variant="default" size="sm">
              <FileText className="mr-2 h-4 w-4" />
              Fatura Kes
            </Button>
          </Link>
          <Button variant="outline" size="sm" onClick={() => setIsTransactionDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            {isCustomer ? "Tahsilat Ekle" : "Ödeme Ekle"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Daha fazla işlem">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem asChild>
                <Link href={`/cari/${type}/${id}/edit?company=${companyId}`} className="cursor-pointer">
                  <Pencil className="mr-2 h-4 w-4" />
                  Düzenle
                </Link>
              </DropdownMenuItem>
              {data.email && (
                <DropdownMenuItem asChild>
                  <a href={`mailto:${data.email}`} className="cursor-pointer">
                    <Mail className="mr-2 h-4 w-4" />
                    E-posta Gönder
                  </a>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem className="cursor-pointer" onClick={() => setCariAction("archive")}>
                <Archive className="mr-2 h-4 w-4" />
                Arşivle
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="cursor-pointer text-red-600 focus:text-red-600 dark:text-red-400 dark:focus:text-red-400"
                onClick={() => setCariAction("delete")}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Sil
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className={`border-l-4 ${balanceFavorable ? "border-l-green-500" : "border-l-red-500"}`}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Bakiye</CardTitle>
            <div className={`rounded-full p-2 ${balanceFavorable ? "bg-green-100 dark:bg-green-500/15" : "bg-red-100 dark:bg-red-500/15"}`}>
              <Wallet className={`h-4 w-4 ${balanceFavorable ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`} />
            </div>
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold tabular-nums ${balanceFavorable ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
              {formatCurrency(data.balance)}
            </div>
            <p className="text-xs text-muted-foreground">{balanceLabel}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Toplam Borç</CardTitle>
            <div className="rounded-full bg-red-100 p-2 dark:bg-red-500/15">
              <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">{formatCurrency(data.totalDebit)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Toplam Alacak</CardTitle>
            <div className="rounded-full bg-green-100 p-2 dark:bg-green-500/15">
              <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">{formatCurrency(data.totalCredit)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Fatura Sayısı</CardTitle>
            <div className="rounded-full bg-blue-100 p-2 dark:bg-blue-500/15">
              <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">{data.invoiceCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Contact Info */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>İletişim Bilgileri</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.phone && (
              <div className="flex items-center gap-3">
                <Phone className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Telefon</p>
                  <a href={`tel:${data.phone}`} className="text-blue-600 hover:underline">
                    {data.phone}
                  </a>
                </div>
              </div>
            )}
            {data.email && (
              <div className="flex items-center gap-3">
                <Mail className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">E-posta</p>
                  <a href={`mailto:${data.email}`} className="text-blue-600 hover:underline">
                    {data.email}
                  </a>
                </div>
              </div>
            )}
            {(data.address || data.city) && (
              <div className="flex items-center gap-3">
                <MapPin className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Adres</p>
                  <p className="text-muted-foreground">
                    {data.address}
                    {data.district && `, ${data.district}`}
                    {data.city && `, ${data.city}`}
                  </p>
                </div>
              </div>
            )}
            {data.contactPerson && (
              <div className="flex items-center gap-3">
                <Building2 className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">İletişim Kişisi</p>
                  <p className="text-muted-foreground">{data.contactPerson}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Vergi Bilgileri</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {data.taxNumber && (
              <div>
                <p className="text-sm font-medium">Vergi No / TC Kimlik No</p>
                <p className="text-muted-foreground">{data.taxNumber}</p>
              </div>
            )}
            {data.taxOffice && (
              <div>
                <p className="text-sm font-medium">Vergi Dairesi</p>
                <p className="text-muted-foreground">{data.taxOffice}</p>
              </div>
            )}
            {!data.taxNumber && !data.taxOffice && (
              <p className="text-muted-foreground">Vergi bilgisi girilmemiş</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Ekstre */}
      <Card>
        <CardHeader>
          <CardTitle>Hesap Ekstresi</CardTitle>
          <CardDescription>
            Tüm borç ve alacak hareketleri
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Uzun ekstre sayfayı aşırı uzatmasın: sabit yükseklik + iç kaydırma.
              Yükseklik sınırı Table'ın kendi overflow sarmalayıcısına uygulanır
              (aksi halde sticky başlık çalışmaz). */}
          <div className="[&>div]:max-h-[560px] [&>div]:rounded-md [&>div]:border">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-muted">
              <TableRow>
                <TableHead>Tarih</TableHead>
                <TableHead>İşlem</TableHead>
                <TableHead>Açıklama</TableHead>
                <TableHead>Fatura No</TableHead>
                <TableHead className="text-right">Borç</TableHead>
                <TableHead className="text-right">Alacak</TableHead>
                <TableHead className="text-right">Bakiye</TableHead>
                <TableHead className="w-12 text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.transactions.length === 0 ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={8} className="py-12 text-center">
                    <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                      <FileText className="h-6 w-6 text-muted-foreground/60" />
                    </div>
                    <p className="font-medium">Henüz işlem yok</p>
                    <p className="text-sm text-muted-foreground">Fatura veya tahsilat eklendiğinde burada listelenir.</p>
                  </TableCell>
                </TableRow>
              ) : (
                orderedTransactions.map((tx) => {
                  const isMovement = tx.type === "PAYMENT" || tx.type === "EXPENSE"
                  return (
                  <TableRow
                    key={tx.id}
                    className={isMovement ? "cursor-pointer" : undefined}
                    onClick={
                      isMovement
                        ? () =>
                            router.push(
                              `/finans/hareketler/${tx.id}?company=${encodeURIComponent(companyId || "")}&from=${encodeURIComponent(`/cari/${type}/${id}`)}`,
                            )
                        : undefined
                    }
                  >
                    <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                      <div>{new Date(tx.date).toLocaleDateString("tr-TR")}</div>
                      {tx.createdAt && (
                        <div className="text-xs text-muted-foreground/70">
                          {new Date(tx.createdAt).toLocaleTimeString("tr-TR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                        tx.type === "INVOICE" && tx.isReceipt ? "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300" :
                        tx.type === "INVOICE" ? "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300" :
                        tx.type === "PAYMENT" ? "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300" :
                        tx.type === "OPENING" ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" :
                        "bg-gray-100 text-gray-800 dark:bg-gray-500/15 dark:text-gray-300"
                      }`}>
                        {tx.type === "INVOICE" ? (tx.isReceipt ? "Fiş" : "Fatura") :
                         tx.type === "PAYMENT" ? "Ödeme" :
                         tx.type === "OPENING" ? "Açılış" :
                         tx.type === "EXPENSE" ? "Gider" :
                         tx.type === "INCOME" ? "Tahsilat" :
                         tx.type === "CHECK" ? "Çek" :
                         tx.type === "NOTE" ? "Senet" :
                         tx.type}
                      </span>
                    </TableCell>
                    <TableCell>
                      {tx.description}
                      {tx.converted && tx.convertedToNo && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          →{" "}
                          {tx.convertedToId ? (
                            <Link
                              href={`/faturalar/${tx.convertedToId}/onizleme?company=${companyId}&from=${encodeURIComponent(`/cari/${type}/${id}`)}`}
                              className="text-blue-600 hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {tx.convertedToNo}
                            </Link>
                          ) : (
                            <span className="font-medium">{tx.convertedToNo}</span>
                          )}{" "}
                          faturasına dönüştürüldü
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {tx.invoiceNo ? (
                        <Link href={`/faturalar/${tx.id}/onizleme?company=${companyId}&from=${encodeURIComponent(`/cari/${type}/${id}`)}`} className="text-blue-600 hover:underline">
                          {tx.invoiceNo}
                        </Link>
                      ) : <span className="text-muted-foreground">-</span>}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-red-600">
                      {tx.debit > 0 ? (
                        formatCurrency(tx.debit)
                      ) : tx.converted && isCustomer && tx.receiptAmount ? (
                        <span className="text-muted-foreground/60 line-through">{formatCurrency(tx.receiptAmount)}</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-green-600">
                      {tx.credit > 0 ? (
                        formatCurrency(tx.credit)
                      ) : tx.converted && !isCustomer && tx.receiptAmount ? (
                        <span className="text-muted-foreground/60 line-through">{formatCurrency(tx.receiptAmount)}</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className={`text-right font-medium tabular-nums ${tx.converted ? "text-muted-foreground" : tx.balance >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {tx.converted ? <span className="text-muted-foreground">-</span> : formatCurrency(tx.balance)}
                    </TableCell>
                    <TableCell className="text-right">
                      {isMovement ? (
                        <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" />
                      ) : null}
                    </TableCell>
                  </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
          </div>
        </CardContent>
      </Card>

      {/* Fişler: ekstrenin ALTında; kendi içinde sınırlı yükseklik + kaydırma ile
          ekstreyi bastırmaması sağlanır. */}
      {companyId && (
        <CariFislerSection
          companyId={companyId}
          cariId={data.id}
          direction={isCustomer ? "outgoing" : "incoming"}
          onConverted={fetchData}
        />
      )}

      {companyId && (
        <TransactionDialog
          open={isTransactionDialogOpen}
          onOpenChange={setIsTransactionDialogOpen}
          companyId={companyId}
          title={isCustomer ? "Yeni Tahsilat" : "Yeni Ödeme"}
          description={
            isCustomer
              ? "Müşteri hesabına tahsilat işlemi ekleyin"
              : "Tedarikçi hesabına ödeme işlemi ekleyin"
          }
          lockedType={isCustomer ? "INCOME" : "EXPENSE"}
          customerId={isCustomer ? id : null}
          supplierId={isCustomer ? null : id}
          accounts={accounts}
          onSuccess={fetchData}
        />
      )}
      <CariArchiveDeleteDialog
        open={cariAction !== null}
        onOpenChange={(open) => {
          if (!open) setCariAction(null)
        }}
        mode={cariAction ?? "archive"}
        entityLabel={entityLabel}
        deletability={data.deletability ?? null}
        isProcessing={isProcessing}
        onConfirmArchive={performArchive}
        onConfirmDelete={performDelete}
      />
    </div>
  )
}

