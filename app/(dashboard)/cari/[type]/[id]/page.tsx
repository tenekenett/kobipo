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
import { ArrowLeft, Mail, Phone, MapPin, Building2, FileText, TrendingUp, TrendingDown, Plus, Pencil, Archive, Trash2 } from "lucide-react"
import Link from "next/link"
import { TransactionDialog } from "@/components/cari/transaction-dialog"
import { CariArchiveDeleteDialog } from "@/components/cari/cari-archive-delete-dialog"

interface Transaction {
  id: string
  date: string
  type: string
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

  // API ekstreyi kronolojik (eski→yeni) ve kümülatif bakiyeli döndürür.
  // Ekranda en yeni en üstte gösterilsin diye listenin bir kopyasını ters
  // çeviriyoruz; her satır kendi (o tarihteki) bakiyesini korur.
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Link href={backHref}>
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold">{data.name}</h1>
            <p className="text-muted-foreground">
              {entityLabel} {data.code && `| Kod: ${data.code}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/cari/${type}/${id}/edit?company=${companyId}`}>
            <Button variant="outline" size="sm">
              <Pencil className="mr-2 h-4 w-4" />
              Düzenle
            </Button>
          </Link>
          <Button variant="default" size="sm" onClick={() => setIsTransactionDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            {isCustomer ? "Tahsilat Ekle" : "Ödeme Ekle"}
          </Button>
          {data.email && (
            <a href={`mailto:${data.email}`}>
              <Button variant="outline" size="sm">
                <Mail className="mr-2 h-4 w-4" />
                E-posta Gönder
              </Button>
            </a>
          )}
          <Button variant="outline" size="sm" onClick={() => setCariAction("archive")}>
            <Archive className="mr-2 h-4 w-4" />
            Arşivle
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCariAction("delete")}
            className="border-red-200 bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Sil
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Bakiye</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${balanceFavorable ? "text-green-600" : "text-red-600"}`}>
              {formatCurrency(data.balance)}
            </div>
            <p className="text-xs text-muted-foreground">
              {balanceLabel}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Toplam Borç</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(data.totalDebit)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Toplam Alacak</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(data.totalCredit)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Fatura Sayısı</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.invoiceCount}</div>
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tarih</TableHead>
                <TableHead>İşlem</TableHead>
                <TableHead>Açıklama</TableHead>
                <TableHead>Fatura No</TableHead>
                <TableHead className="text-right">Borç</TableHead>
                <TableHead className="text-right">Alacak</TableHead>
                <TableHead className="text-right">Bakiye</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.transactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    <FileText className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
                    <p className="text-muted-foreground">Henüz işlem yok</p>
                  </TableCell>
                </TableRow>
              ) : (
                orderedTransactions.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell>
                      {new Date(tx.date).toLocaleDateString("tr-TR")}
                    </TableCell>
                    <TableCell>
                      <span className={`px-2 py-1 rounded text-xs ${
                        tx.type === "INVOICE" ? "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300" :
                        tx.type === "PAYMENT" ? "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300" :
                        tx.type === "OPENING" ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" :
                        "bg-gray-100 text-gray-800 dark:bg-gray-500/15 dark:text-gray-300"
                      }`}>
                        {tx.type === "INVOICE" ? "Fatura" :
                         tx.type === "PAYMENT" ? "Ödeme" :
                         tx.type === "OPENING" ? "Açılış" :
                         tx.type === "EXPENSE" ? "Gider" :
                         tx.type === "INCOME" ? "Tahsilat" :
                         tx.type === "CHECK" ? "Çek" :
                         tx.type === "NOTE" ? "Senet" :
                         tx.type}
                      </span>
                    </TableCell>
                    <TableCell>{tx.description}</TableCell>
                    <TableCell>
                      {tx.invoiceNo ? (
                        <Link href={`/faturalar/${tx.id}/onizleme?company=${companyId}&from=${encodeURIComponent(`/cari/${type}/${id}`)}`} className="text-blue-600 hover:underline">
                          {tx.invoiceNo}
                        </Link>
                      ) : "-"}
                    </TableCell>
                    <TableCell className="text-right text-red-600">
                      {tx.debit > 0 ? formatCurrency(tx.debit) : "-"}
                    </TableCell>
                    <TableCell className="text-right text-green-600">
                      {tx.credit > 0 ? formatCurrency(tx.credit) : "-"}
                    </TableCell>
                    <TableCell className={`text-right font-medium ${tx.balance >= 0 ? "text-green-600" : "text-red-600"}`}>
                      {formatCurrency(tx.balance)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
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

