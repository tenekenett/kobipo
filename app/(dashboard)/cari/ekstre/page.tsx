"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import * as XLSX from "xlsx"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ArrowLeft, Download } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { cn } from "@/lib/utils"

interface EkstreEntry {
  type: string
  id: string
  date: string
  description: string
  debit: number
  credit: number
  balance: number
  reference?: string
}

interface AgingBuckets {
  current: number
  days_0_30: number
  days_31_60: number
  days_61_90: number
  days_90_plus: number
}

const TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  INVOICE: { label: "Fatura", cls: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-500/15 dark:text-sky-200 dark:border-sky-500/40" },
  TRANSACTION: { label: "Tahsilat/Ödeme", cls: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:border-emerald-500/40" },
  CHECK: { label: "Çek", cls: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-500/40" },
  PROMISSORY_NOTE: { label: "Senet", cls: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-500/15 dark:text-purple-200 dark:border-purple-500/40" },
}

export default function EkstrePage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const initialCustomerId = searchParams.get("customerId") || ""
  const initialSupplierId = searchParams.get("supplierId") || ""
  const fromParam = searchParams.get("from")
  const safeFrom = fromParam && fromParam.startsWith("/") ? fromParam : null
  const fallbackBack = `/raporlar/cari-yaslandirma?company=${encodeURIComponent(companyId || "")}`
  const backHref = safeFrom
    ? `${safeFrom}${safeFrom.includes("?") ? "&" : "?"}company=${encodeURIComponent(companyId || "")}`
    : fallbackBack
  const { toast } = useToast()
  const [entries, setEntries] = useState<EkstreEntry[]>([])
  const [totalDebit, setTotalDebit] = useState(0)
  const [totalCredit, setTotalCredit] = useState(0)
  const [finalBalance, setFinalBalance] = useState(0)
  const [aging, setAging] = useState<AgingBuckets>({
    current: 0,
    days_0_30: 0,
    days_31_60: 0,
    days_61_90: 0,
    days_90_plus: 0,
  })
  const [customerId, setCustomerId] = useState(initialCustomerId)
  const [supplierId, setSupplierId] = useState(initialSupplierId)
  const [customers, setCustomers] = useState<Array<{ id: string; name: string }>>([])
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string }>>([])
  const [startDate, setStartDate] = useState("")
  const [endDate, setEndDate] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (companyId) {
      fetchEkstre()
      fetchCariOptions()
    }
  }, [companyId, customerId, supplierId, startDate, endDate])

  const fetchEkstre = async () => {
    if (!companyId) return

    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        companyId,
        ...(customerId && { customerId }),
        ...(supplierId && { supplierId }),
        ...(startDate && { startDate }),
        ...(endDate && { endDate }),
      })

      const response = await fetch(`/api/cari/ekstre?${params}`)
      if (response.ok) {
        const data = await response.json()
        setEntries(data.entries)
        setTotalDebit(data.totalDebit)
        setTotalCredit(data.totalCredit)
        setFinalBalance(data.finalBalance)
        if (data.aging) setAging(data.aging)
      }
    } catch (error) {
      console.error("Error fetching ekstre:", error)
    } finally {
      setIsLoading(false)
    }
  }

  const fetchCariOptions = async () => {
    if (!companyId) return
    const [customerResponse, supplierResponse] = await Promise.all([
      fetch(`/api/cari/customers?companyId=${companyId}`),
      fetch(`/api/cari/suppliers?companyId=${companyId}`),
    ])
    if (customerResponse.ok) {
      setCustomers(await customerResponse.json())
    }
    if (supplierResponse.ok) {
      setSuppliers(await supplierResponse.json())
    }
  }

  const handleExportExcel = () => {
    if (entries.length === 0) {
      toast({
        title: "İndirilecek veri yok",
        description: "Önce filtreleri ayarlayıp kayıtları yükleyin.",
      })
      return
    }
    const rows = entries.map((entry) => ({
      Tarih: new Date(entry.date).toLocaleDateString("tr-TR"),
      Açıklama: entry.description,
      Referans: entry.reference || "",
      Borç: entry.debit,
      Alacak: entry.credit,
      Bakiye: entry.balance,
    }))
    rows.push({
      Tarih: "",
      Açıklama: "TOPLAM",
      Referans: "",
      Borç: totalDebit,
      Alacak: totalCredit,
      Bakiye: finalBalance,
    })
    const worksheet = XLSX.utils.json_to_sheet(rows)
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, "Ekstre")
    const cariName =
      (customerId && customers.find((c) => c.id === customerId)?.name) ||
      (supplierId && suppliers.find((s) => s.id === supplierId)?.name) ||
      "Tumu"
    const safeName = cariName.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 40)
    const today = new Date().toISOString().slice(0, 10)
    XLSX.writeFile(workbook, `Cari_Ekstre_${safeName}_${today}.xlsx`)
  }

  if (!companyId) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Lütfen bir firma seçin</p>
      </div>
    )
  }

  const selectedCariName =
    (customerId && customers.find((c) => c.id === customerId)?.name) ||
    (supplierId && suppliers.find((s) => s.id === supplierId)?.name) ||
    null
  const selectedCariRole = customerId ? "Müşteri" : supplierId ? "Tedarikçi" : null
  const fmtTRY = (n: number) =>
    new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(n || 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href={backHref}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold">Cari Ekstre</h1>
          <p className="text-muted-foreground">
            {selectedCariName
              ? `${selectedCariRole}: ${selectedCariName}`
              : "Cari hesap hareketleri"}
          </p>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
        <SummaryStat label="Toplam Borç" value={fmtTRY(totalDebit)} tone="text-emerald-600 dark:text-emerald-400" />
        <SummaryStat label="Toplam Alacak" value={fmtTRY(totalCredit)} tone="text-rose-600 dark:text-rose-400" />
        <SummaryStat
          label="Bakiye"
          value={fmtTRY(finalBalance)}
          tone={
            finalBalance > 0
              ? "text-emerald-600 dark:text-emerald-400"
              : finalBalance < 0
                ? "text-rose-600 dark:text-rose-400"
                : "text-foreground"
          }
        />
        <SummaryStat label="Vadesi Yaklaşan" value={fmtTRY(aging.current + aging.days_0_30)} tone="text-amber-600 dark:text-amber-400" />
        <SummaryStat label="Vadesi Geçmiş" value={fmtTRY(aging.days_31_60 + aging.days_61_90 + aging.days_90_plus)} tone="text-rose-600 dark:text-rose-400" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtreler</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="customerId">Müşteri</Label>
              <Select value={customerId} onValueChange={(value) => setCustomerId(value === "all" ? "" : value)}>
                <SelectTrigger id="customerId"><SelectValue placeholder="Müşteri seçin" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tümü</SelectItem>
                  {customers.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>{customer.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="supplierId">Tedarikçi</Label>
              <Select value={supplierId} onValueChange={(value) => setSupplierId(value === "all" ? "" : value)}>
                <SelectTrigger id="supplierId"><SelectValue placeholder="Tedarikçi seçin" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tümü</SelectItem>
                  {suppliers.map((supplier) => (
                    <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="startDate">Başlangıç Tarihi</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="endDate">Bitiş Tarihi</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Cari Ekstre</CardTitle>
              <CardDescription>
                Toplam Borç: {new Intl.NumberFormat("tr-TR", {
                  style: "currency",
                  currency: "TRY",
                }).format(totalDebit)}
                {" | "}
                Toplam Alacak: {new Intl.NumberFormat("tr-TR", {
                  style: "currency",
                  currency: "TRY",
                }).format(totalCredit)}
                {" | "}
                Bakiye: {new Intl.NumberFormat("tr-TR", {
                  style: "currency",
                  currency: "TRY",
                }).format(finalBalance)}
              </CardDescription>
            </div>
            <Button
              variant="outline"
              onClick={handleExportExcel}
              disabled={entries.length === 0 || isLoading}
            >
              <Download className="mr-2 h-4 w-4" />
              Excel İndir
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Yükleniyor...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tarih</TableHead>
                  <TableHead>Tip</TableHead>
                  <TableHead>Açıklama</TableHead>
                  <TableHead>Referans</TableHead>
                  <TableHead className="text-right">Borç</TableHead>
                  <TableHead className="text-right">Alacak</TableHead>
                  <TableHead className="text-right">Bakiye</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                      Kayıt bulunamadı
                    </TableCell>
                  </TableRow>
                ) : (
                  entries.map((entry) => {
                    const badge = TYPE_BADGE[entry.type] || {
                      label: entry.type,
                      cls: "bg-slate-50 text-slate-700 border-slate-200",
                    }
                    return (
                      <TableRow key={`${entry.type}-${entry.id}`}>
                        <TableCell className="whitespace-nowrap tabular-nums">
                          {new Date(entry.date).toLocaleDateString("tr-TR")}
                        </TableCell>
                        <TableCell>
                          <span className={cn("inline-flex items-center rounded border px-2 py-0.5 text-[10px] font-medium", badge.cls)}>
                            {badge.label}
                          </span>
                        </TableCell>
                        <TableCell>{entry.description}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {entry.reference || "-"}
                        </TableCell>
                        <TableCell className={cn("text-right tabular-nums", entry.debit > 0 && "text-emerald-600 dark:text-emerald-400 font-medium")}>
                          {entry.debit > 0 ? fmtTRY(entry.debit) : "—"}
                        </TableCell>
                        <TableCell className={cn("text-right tabular-nums", entry.credit > 0 && "text-rose-600 dark:text-rose-400 font-medium")}>
                          {entry.credit > 0 ? fmtTRY(entry.credit) : "—"}
                        </TableCell>
                        <TableCell className={cn(
                          "text-right tabular-nums font-semibold",
                          entry.balance > 0 && "text-emerald-600 dark:text-emerald-400",
                          entry.balance < 0 && "text-rose-600 dark:text-rose-400",
                        )}>
                          {fmtTRY(entry.balance)}
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function SummaryStat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={cn("mt-1 text-xl font-bold tabular-nums", tone)}>{value}</div>
      </CardContent>
    </Card>
  )
}

