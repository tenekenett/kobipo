"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/components/ui/use-toast"
import { Plus, Search, Eye, Pencil, Trash2, Loader2 } from "lucide-react"
import Link from "next/link"

function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="h-10 w-24 animate-pulse rounded bg-muted" />
          <TableHead className="h-10 w-32 animate-pulse rounded bg-muted" />
          <TableHead className="h-10 w-32 animate-pulse rounded bg-muted" />
          <TableHead className="h-10 w-24 animate-pulse rounded bg-muted" />
          <TableHead className="h-10 w-32 animate-pulse rounded bg-muted" />
          <TableHead className="h-10 w-24 animate-pulse rounded bg-muted" />
          <TableHead className="h-10 w-24 animate-pulse rounded bg-muted" />
          <TableHead className="h-10 w-20 animate-pulse rounded bg-muted" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: rows }).map((_, i) => (
          <TableRow key={i}>
            <TableCell><div className="h-4 w-16 animate-pulse rounded bg-muted/60" /></TableCell>
            <TableCell><div className="h-4 w-24 animate-pulse rounded bg-muted/60" /></TableCell>
            <TableCell><div className="h-4 w-20 animate-pulse rounded bg-muted/60" /></TableCell>
            <TableCell><div className="h-4 w-16 animate-pulse rounded bg-muted/60" /></TableCell>
            <TableCell><div className="h-4 w-24 animate-pulse rounded bg-muted/60" /></TableCell>
            <TableCell><div className="h-4 w-20 animate-pulse rounded bg-muted/60" /></TableCell>
            <TableCell><div className="h-4 w-20 animate-pulse rounded bg-muted/60" /></TableCell>
            <TableCell><div className="h-4 w-12 animate-pulse rounded bg-muted/60" /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

interface Customer {
  id: string
  code?: string
  name: string
  taxNumber?: string
  taxOffice?: string
  address?: string
  city?: string
  email?: string
  phone?: string
  contactPerson?: string
  balance?: number
  paymentDueDays?: number
  openingBalanceAmount?: number
  openingBalanceType?: "DEBIT" | "CREDIT"
  isAlsoSupplier?: boolean
  isAlsoCustomer?: boolean
}

export default function CariPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const tabQuery = searchParams.get("tab")
  const { toast } = useToast()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [suppliers, setSuppliers] = useState<Customer[]>([])
  const [activeTab, setActiveTab] = useState<"customers" | "suppliers">(
    tabQuery === "suppliers" ? "suppliers" : "customers"
  )
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [page, setPage] = useState(1)
  const [pageSize] = useState(50)
  const [totalCount, setTotalCount] = useState<number | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const [isPending, startTransition] = useTransition()
  const fetchAbortRef = useRef<AbortController | null>(null)
  const currencyFormatter = useMemo(
    () =>
      new Intl.NumberFormat("tr-TR", {
        style: "currency",
        currency: "TRY",
      }),
    []
  )

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(handle)
  }, [search])

  const fetchData = useCallback(
    async (signal?: AbortSignal) => {
      if (!companyId) return
      setIsLoading(true)
      try {
        const endpoint = activeTab === "customers" ? "customers" : "suppliers"
        const response = await fetch(
          `/api/cari/${endpoint}?companyId=${companyId}&search=${encodeURIComponent(debouncedSearch)}&page=${page}&pageSize=${pageSize}`,
          { signal, cache: "no-store" }
        )
        if (response.ok) {
          const data = await response.json()
          const items = Array.isArray(data) ? data : data.items
          if (activeTab === "customers") {
            setCustomers(items)
          } else {
            setSuppliers(items)
          }
          if (!Array.isArray(data)) {
            setTotalCount(data.totalCount)
          } else {
            setTotalCount(null)
          }
          setHasLoadedOnce(true)
        } else {
          throw new Error("Veriler yenilenemedi")
        }
      } catch (error) {
        if ((error as { name?: string })?.name === "AbortError") return
        console.error("Error fetching data:", error)
        throw error
      } finally {
        if (!signal?.aborted) {
          setIsLoading(false)
        }
      }
    },
    [companyId, activeTab, debouncedSearch, page, pageSize]
  )

  useEffect(() => {
    if (!companyId) return
    setPage(1)
  }, [companyId, activeTab, debouncedSearch])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden && companyId) {
        setRefreshNonce((prev) => prev + 1)
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange)
  }, [companyId])

  useEffect(() => {
    if (!companyId) return
    fetchAbortRef.current?.abort()
    const controller = new AbortController()
    fetchAbortRef.current = controller
    startTransition(() => {
      void fetchData(controller.signal).catch(() => {})
    })
    return () => controller.abort()
  }, [companyId, activeTab, debouncedSearch, page, refreshNonce, fetchData])

  const deleteItem = async (id: string) => {
    if (!confirm("Bu kaydı silmek istediğinize emin misiniz?")) return
    const endpoint = activeTab === "customers" ? "customers" : "suppliers"
    const response = await fetch(`/api/cari/${endpoint}/${id}`, { method: "DELETE" })
    if (response.ok) {
      toast({ title: "Başarılı", description: "Kayıt silindi" })
      void fetchData().catch(() => {
        toast({
          title: "Uyarı",
          description: "Kayıt silindi ancak liste yenilenemedi. Sayfayı yenileyin.",
          variant: "destructive",
        })
      })
    } else {
      let message = "Kayıt silinemedi"
      try {
        const data = await response.json()
        if (typeof data?.error === "string") message = data.error
      } catch {
        /* ignore */
      }
      toast({ title: "Hata", description: message, variant: "destructive" })
    }
  }

  const currentData = activeTab === "customers" ? customers : suppliers
  const agingRows = currentData
    .filter((item) => Number(item.balance || 0) !== 0)
    .map((item) => {
      const dueDays = Number(item.paymentDueDays || 0)
      const bucket = dueDays <= 30 ? "0-30" : dueDays <= 60 ? "31-60" : dueDays <= 90 ? "61-90" : "90+"
      return { ...item, dueDays, bucket }
    })

  if (!companyId) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Lütfen bir firma seçin</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Cari Hesaplar</h1>
          <p className="text-muted-foreground">
            Müşteri ve tedarikçi yönetimi
          </p>
        </div>
        <Link href={`/cari/${activeTab}/new?company=${companyId}`}>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Yeni {activeTab === "customers" ? "Müşteri" : "Tedarikçi"}
          </Button>
        </Link>
      </div>

      <div className="flex space-x-2 border-b">
        <Button
          variant={activeTab === "customers" ? "default" : "ghost"}
          onClick={() => startTransition(() => setActiveTab("customers"))}
        >
          Müşteriler
        </Button>
        <Button
          variant={activeTab === "suppliers" ? "default" : "ghost"}
          onClick={() => startTransition(() => setActiveTab("suppliers"))}
        >
          Tedarikçiler
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setPage(1)
            setSearch("")
            setDebouncedSearch("")
            setRefreshNonce((prev) => prev + 1)
          }}
          disabled={isPending}
        >
          Yenile
        </Button>
        {(isPending || isLoading) && (
          <span className="ml-2 inline-flex items-center gap-1.5 self-center text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Yükleniyor...
          </span>
        )}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>
                {activeTab === "customers" ? "Müşteriler" : "Tedarikçiler"}
              </CardTitle>
              <CardDescription>
                Toplam {currentData.length} kayıt
              </CardDescription>
            </div>
            <div className="flex items-center space-x-2">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Ara..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 pr-8 w-64"
                />
                {(isPending || search !== debouncedSearch) && (
                  <Loader2 className="absolute right-2 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
                )}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {!hasLoadedOnce && isLoading ? (
            <TableSkeleton rows={8} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kod</TableHead>
                  <TableHead>Ad</TableHead>
                  <TableHead>Vergi No</TableHead>
                  <TableHead>Telefon</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Açılış Bakiyesi</TableHead>
                  <TableHead className="text-right">Bakiye</TableHead>
                  <TableHead>İşlem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {currentData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center">
                      {isLoading ? "Kayıtlar yükleniyor..." : "Kayıt bulunamadı"}
                    </TableCell>
                  </TableRow>
                ) : (
                  currentData.map((item) => (
                    <TableRow
                      key={item.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() =>
                        router.push(`/cari/${activeTab}/${item.id}?company=${companyId}`)
                      }
                    >
                      <TableCell>{item.code || "-"}</TableCell>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell>{item.taxNumber || "-"}</TableCell>
                      <TableCell>{item.phone || "-"}</TableCell>
                      <TableCell>{item.email || "-"}</TableCell>
                      <TableCell>
                        {item.openingBalanceAmount !== undefined
                          ? `${currencyFormatter.format(item.openingBalanceAmount)} ${
                              item.openingBalanceType === "CREDIT" ? "(Alacak)" : "(Borç)"
                            }`
                          : "-"}
                      </TableCell>
                      <TableCell className="text-right">
                        {item.balance !== undefined
                          ? currencyFormatter.format(item.balance)
                          : "-"}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1">
                          <Link href={`/cari/${activeTab}/${item.id}?company=${companyId}`}>
                            <Button variant="ghost" size="sm">
                              <Eye className="h-4 w-4 mr-1" />
                              Detay
                            </Button>
                          </Link>
                          <Link href={`/cari/${activeTab}/${item.id}/edit?company=${companyId}`}>
                            <Button variant="ghost" size="sm">
                              <Pencil className="h-4 w-4 mr-1" />
                              Düzenle
                            </Button>
                          </Link>
                          <Button variant="ghost" size="sm" onClick={() => deleteItem(item.id)}>
                            <Trash2 className="h-4 w-4 mr-1 text-red-600" />
                            Sil
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-4">
        <div className="text-sm text-muted-foreground">
          {totalCount !== null
            ? `Toplam ${totalCount} kayıt`
            : `Toplam ${currentData.length} kayıt`}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
          >
            Önceki
          </Button>
          <span className="text-sm text-muted-foreground">
            Sayfa {page}{totalCount ? ` / ${Math.max(1, Math.ceil(totalCount / pageSize))}` : ""}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={totalCount !== null && page >= Math.ceil(totalCount / pageSize)}
            onClick={() => setPage((prev) => prev + 1)}
          >
            Sonraki
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cari Yaşlandırma</CardTitle>
          <CardDescription>
            Vade günü ve bakiyeye göre yaşlandırma görünümü
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!hasLoadedOnce && isLoading ? (
            <TableSkeleton rows={6} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Hesap</TableHead>
                  <TableHead>Vade Günü</TableHead>
                  <TableHead>Yaşlandırma Dilimi</TableHead>
                  <TableHead className="text-right">Bakiye</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agingRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      Yaşlandırma için bakiye verisi bulunamadı
                    </TableCell>
                  </TableRow>
                ) : (
                  agingRows.map((row) => (
                    <TableRow key={`aging-${row.id}`}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell>{row.dueDays}</TableCell>
                      <TableCell>{row.bucket} gün</TableCell>
                      <TableCell className="text-right">
                        {currencyFormatter.format(Number(row.balance || 0))}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

    </div>
  )
}

