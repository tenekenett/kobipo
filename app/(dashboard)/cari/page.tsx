"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react"
import { useSearchParams } from "next/navigation"
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
import {
  StyledTableContainer,
  StyledTableHeaderRow,
  StyledTableHead,
  StyledTableRow,
  EntityCell,
  MonoCell,
} from "@/components/ui/styled-table"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/components/ui/use-toast"
import { Plus, Search, Eye, Pencil, Trash2, Loader2 } from "lucide-react"
import Link from "next/link"
import {
  CariArchiveDeleteDialog,
  type CariDeletability,
} from "@/components/cari/cari-archive-delete-dialog"
import { ExportButton } from "@/components/export/export-button"

function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="h-10 w-64 animate-pulse rounded bg-muted" />
          <TableHead className="h-10 w-32 animate-pulse rounded bg-muted" />
          <TableHead className="h-10 w-28 animate-pulse rounded bg-muted" />
          <TableHead className="h-10 w-24 animate-pulse rounded bg-muted" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: rows }).map((_, i) => (
          <TableRow key={i}>
            <TableCell><div className="h-4 w-48 animate-pulse rounded bg-muted/60" /></TableCell>
            <TableCell><div className="h-4 w-24 animate-pulse rounded bg-muted/60" /></TableCell>
            <TableCell><div className="h-4 w-20 animate-pulse rounded bg-muted/60" /></TableCell>
            <TableCell><div className="h-4 w-16 animate-pulse rounded bg-muted/60" /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

interface Customer {
  id: string
  code?: string
  slug?: string
  name: string
  nickname?: string | null
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

  // Silme: önce kaydın silinebilirliğini (açık bakiye / açık fatura / geçmiş)
  // çekip diyaloğu o sebeplerle aç. Diyalog temizse sil onayı, silinemiyor ama
  // arşivlenebiliyorsa arşiv teklifi, ikisi de değilse sebepleri gösterir.
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [deletability, setDeletability] = useState<CariDeletability | null>(null)
  const [loadingDeleteId, setLoadingDeleteId] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

  const entityLabel = activeTab === "customers" ? "Müşteri" : "Tedarikçi"

  const requestDelete = async (item: Customer) => {
    const endpoint = activeTab === "customers" ? "customers" : "suppliers"
    setLoadingDeleteId(item.id)
    // Varsayılan: silinebilir kabul et; sebepler alınamazsa backend DELETE'te
    // yine 409 ile engeller ve sebep döner (güvenli taraf).
    let next: CariDeletability = {
      canDelete: true,
      canArchive: true,
      deleteBlockReasons: [],
      archiveBlockReasons: [],
    }
    try {
      const res = await fetch(`/api/cari/${endpoint}/${item.id}?companyId=${companyId}&only=deletability`)
      const body = await res.json().catch(() => ({}))
      if (res.ok && body?.deletability) next = body.deletability
    } catch {
      /* sebepler alınamadı → backend DELETE'te yine doğrular */
    } finally {
      setLoadingDeleteId(null)
    }
    setDeletability(next)
    setDeleteTarget({ id: item.id, name: item.name })
  }

  const performDelete = async () => {
    if (!deleteTarget) return
    const endpoint = activeTab === "customers" ? "customers" : "suppliers"
    setIsProcessing(true)
    try {
      const res = await fetch(`/api/cari/${endpoint}/${deleteTarget.id}?companyId=${companyId}`, {
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
      setDeleteTarget(null)
      void fetchData().catch(() => {
        toast({
          title: "Uyarı",
          description: "Kayıt silindi ancak liste yenilenemedi. Sayfayı yenileyin.",
          variant: "destructive",
        })
      })
    } finally {
      setIsProcessing(false)
    }
  }

  const performArchive = async () => {
    if (!deleteTarget) return
    const endpoint = activeTab === "customers" ? "customers" : "suppliers"
    setIsProcessing(true)
    try {
      const res = await fetch(`/api/cari/${endpoint}/${deleteTarget.id}?companyId=${companyId}`, {
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
      setDeleteTarget(null)
      void fetchData().catch(() => {})
    } finally {
      setIsProcessing(false)
    }
  }

  const currentData = activeTab === "customers" ? customers : suppliers

  if (!companyId) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Lütfen bir firma seçin</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Cari Hesaplar</h1>
          <p className="text-muted-foreground">
            Müşteri ve tedarikçi yönetimi
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Aktif sekme + arama sunucuya gider: indirilen dosya ekranın 50'lik
              sayfasını değil, filtreye uyan TÜM carileri içerir. */}
          <ExportButton
            dataset="cari"
            companyId={companyId}
            params={{ tab: activeTab, search: debouncedSearch }}
            size="default"
          />
          <Link href={`/cari/${activeTab}/new?company=${companyId}`}>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Yeni {activeTab === "customers" ? "Müşteri" : "Tedarikçi"}
            </Button>
          </Link>
        </div>
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
            <StyledTableContainer>
            <Table>
              <TableHeader>
                <StyledTableHeaderRow>
                  <StyledTableHead>Ad</StyledTableHead>
                  <StyledTableHead>Vergi No</StyledTableHead>
                  <StyledTableHead className="text-right">Bakiye</StyledTableHead>
                  <StyledTableHead className="text-right">İşlem</StyledTableHead>
                </StyledTableHeaderRow>
              </TableHeader>
              <TableBody>
                {currentData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      {isLoading ? "Kayıtlar yükleniyor..." : "Kayıt bulunamadı"}
                    </TableCell>
                  </TableRow>
                ) : (
                  currentData.map((item, idx) => {
                    const balance = Number(item.balance ?? 0)
                    const balanceTone =
                      balance > 0
                        ? "text-emerald-600 dark:text-emerald-400"
                        : balance < 0
                          ? "text-rose-600 dark:text-rose-400"
                          : "text-muted-foreground"
                    const rowHref = `/cari/${activeTab}/${item.slug || item.id}?company=${companyId}`
                    return (
                      <StyledTableRow
                        key={item.id}
                        index={idx}
                        className="cursor-pointer"
                        // Satırın tamamı bağlantı yüzeyi: sağ tık → "yeni sekmede aç".
                        href={rowHref}
                        hrefLabel={`${item.name} detayı`}
                      >
                        <TableCell>
                          <EntityCell name={item.name} maxWidth={360} />
                          {/* Takma ad: ünvan resmi ad olduğu için kullanıcının cariyi
                              tanıdığı ad hemen altında, ikinci satırda gösterilir. */}
                          {item.nickname && (
                            <p
                              className="truncate pl-6 text-xs text-muted-foreground"
                              style={{ maxWidth: 360 }}
                              title={item.nickname}
                            >
                              {item.nickname}
                            </p>
                          )}
                        </TableCell>
                        <TableCell><MonoCell value={item.taxNumber} /></TableCell>
                        <TableCell
                          className={cn(
                            "whitespace-nowrap text-right font-semibold tabular-nums",
                            balanceTone,
                          )}
                        >
                          {item.balance !== undefined
                            ? currencyFormatter.format(item.balance)
                            : "-"}
                        </TableCell>
                        {/* Aksiyon hücresi bağlantı kaplamasının dışında kalmalı,
                            yoksa butonlar tıklanamaz olur. */}
                        <TableCell
                          data-row-link-skip
                          className="text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex justify-end gap-0.5">
                            <Link href={rowHref} aria-label="Detay">
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <Eye className="h-4 w-4" />
                              </Button>
                            </Link>
                            <Link
                              href={`/cari/${activeTab}/${item.slug || item.id}/edit?company=${companyId}`}
                              aria-label="Düzenle"
                            >
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </Link>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-rose-600 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300"
                              aria-label="Sil"
                              disabled={loadingDeleteId === item.id}
                              onClick={() => requestDelete(item)}
                            >
                              {loadingDeleteId === item.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </TableCell>
                      </StyledTableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
            </StyledTableContainer>
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

      <CariArchiveDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        mode="delete"
        entityLabel={entityLabel}
        deletability={deletability}
        isProcessing={isProcessing}
        onConfirmArchive={performArchive}
        onConfirmDelete={performDelete}
      />
    </div>
  )
}

