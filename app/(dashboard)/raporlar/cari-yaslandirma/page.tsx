"use client"

import { Fragment, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ChevronDown, ChevronRight, User, FileText } from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"

type Bucket =
  | "not_due"
  | "overdue"

type Totals = Record<Bucket, number> & {
  overdueAvgDays: number
  performanceAvgDays: number
  performanceScore: number
  performanceLabel: string
  total: number
}

type AgingInvoice = {
  id: string
  invoiceNo: string
  date: string
  effectiveDueDate: string
  totalAmount: number
  paidAmount: number
  openAmount: number
  overdueDays: number
  bucket: Bucket
}

type AgingAccount = {
  id: string
  name: string
  code: string | null
  paymentDueDays: number | null
  taxNumber: string | null
  totals: Totals
  invoices: AgingInvoice[]
}

type AgingResponse = {
  asOf: string
  customers: { accounts: AgingAccount[]; totals: Totals }
  suppliers: { accounts: AgingAccount[]; totals: Totals }
}

const BUCKET_LABEL: Record<Bucket, string> = {
  not_due: "Vadesi Gelmemiş",
  overdue: "Vadesi Geçmiş",
}

const BUCKET_TONE: Record<Bucket, string> = {
  not_due: "text-emerald-600",
  overdue: "text-red-600",
}

const BUCKET_BADGE: Record<Bucket, string> = {
  not_due: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300 border border-emerald-200",
  overdue: "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300 border border-red-200",
}

function fmtTRY(value: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    minimumFractionDigits: 2,
  }).format(value || 0)
}

function fmtDate(value: string) {
  if (!value) return "-"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "-"
  return d.toLocaleDateString("tr-TR")
}

function fmtDays(value: number) {
  if (!Number.isFinite(value)) return "-"
  if (value > 0) return `+${value.toFixed(1)} gün`
  if (value < 0) return `${value.toFixed(1)} gün`
  return "0.0 gün"
}

export default function CariYaslandirmaPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const [data, setData] = useState<AgingResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<"customers" | "suppliers">("customers")
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!companyId) {
      setData(null)
      return
    }
    const load = async () => {
      setIsLoading(true)
      setError(null)
      try {
        const res = await fetch(
          `/api/raporlar/cari-yaslandirma?companyId=${encodeURIComponent(companyId)}`,
          { cache: "no-store" }
        )
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || `Hata: ${res.status}`)
        }
        const json = (await res.json()) as AgingResponse
        setData(json)
      } catch (e: any) {
        setError(e.message || "Yaşlandırma verisi yüklenemedi")
        setData(null)
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [companyId])

  const current = useMemo(() => {
    if (!data) return null
    return tab === "customers" ? data.customers : data.suppliers
  }, [data, tab])

  const toggle = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))

  if (!companyId) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Lütfen bir firma seçin</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Cari Yaşlandırma</h1>
          <p className="text-muted-foreground">
            Açık faturalardan üretilen, vadeye göre yaşlandırma raporu
          </p>
        </div>
        {data?.asOf ? (
          <div className="text-xs text-muted-foreground">
            Hesaplama tarihi: {new Date(data.asOf).toLocaleString("tr-TR")}
          </div>
        ) : null}
      </div>

      <div className="flex gap-2 border-b">
        <Button
          variant={tab === "customers" ? "default" : "ghost"}
          onClick={() => setTab("customers")}
        >
          Müşteriler
        </Button>
        <Button
          variant={tab === "suppliers" ? "default" : "ghost"}
          onClick={() => setTab("suppliers")}
        >
          Tedarikçiler
        </Button>
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {error}
        </div>
      ) : null}

      {isLoading && !data ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Yükleniyor...
          </CardContent>
        </Card>
      ) : null}

      {current ? (
        <>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
            <SummaryCard label="Toplam Açık" value={current.totals.total} tone="text-foreground" />
            {(["not_due", "overdue"] as Bucket[]).map((b) => (
              <SummaryCard
                key={b}
                label={BUCKET_LABEL[b]}
                value={current.totals[b]}
                tone={BUCKET_TONE[b]}
              />
            ))}
            <InfoCard
              label="Vadesi Geçmiş Ortalama"
              primary={fmtDays(current.totals.overdueAvgDays)}
              secondary={fmtTRY(current.totals.overdue)}
            />
            <InfoCard
              label="Geri Dönüş"
              primary={`${current.totals.performanceScore}/100 · ${current.totals.performanceLabel}`}
              secondary={fmtDays(current.totals.performanceAvgDays)}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>
                {tab === "customers" ? "Müşteri Yaşlandırması" : "Tedarikçi Yaşlandırması"}
              </CardTitle>
              <CardDescription>
                Hesap bazında açık tutar, gecikme ve ödeme performansı
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Hesap</TableHead>
                    <TableHead className="text-right">Toplam Açık</TableHead>
                    <TableHead className="text-right">Vadesi Gelmemiş</TableHead>
                    <TableHead className="text-right">Vadesi Geçmiş</TableHead>
                    <TableHead className="text-right">Geri Dönüş</TableHead>
                    <TableHead className="text-right">İşlem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {current.accounts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground">
                        Açık bakiyeli hesap bulunamadı
                      </TableCell>
                    </TableRow>
                  ) : (
                    current.accounts.map((acc) => {
                      const isOpen = Boolean(expanded[acc.id])
                      const partyParam = tab === "customers" ? "customerId" : "supplierId"
                      const from = encodeURIComponent("/raporlar/cari-yaslandirma")
                      const profileHref = `/cari/${tab}/${acc.id}?company=${companyId}&from=${from}`
                      const ekstreHref = `/cari/ekstre?company=${companyId}&${partyParam}=${acc.id}&from=${from}`
                      return (
                        <Fragment key={acc.id}>
                          <TableRow
                            className="cursor-pointer hover:bg-muted/40"
                            onClick={() => toggle(acc.id)}
                          >
                            <TableCell>
                              {isOpen ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="font-medium">{acc.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {acc.code ? `${acc.code} · ` : ""}
                                Vade: {acc.paymentDueDays ?? 0} gün
                              </div>
                            </TableCell>
                            <TableCell className="text-right font-semibold">
                              {fmtTRY(acc.totals.total)}
                            </TableCell>
                            <TableCell className={cn("text-right tabular-nums", BUCKET_TONE.not_due)}>
                              {fmtTRY(acc.totals.not_due)}
                            </TableCell>
                            <TableCell className={cn("text-right tabular-nums", BUCKET_TONE.overdue)}>
                              <div className="font-medium">{fmtTRY(acc.totals.overdue)}</div>
                              <div className="text-xs text-muted-foreground">
                                Ort. {fmtDays(acc.totals.overdueAvgDays)}
                              </div>
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              <div className="font-medium">
                                {acc.totals.performanceScore}/100 · {acc.totals.performanceLabel}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {fmtDays(acc.totals.performanceAvgDays)}
                              </div>
                            </TableCell>
                            <TableCell
                              className="text-right"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="flex justify-end gap-0.5">
                                <Link
                                  href={profileHref}
                                  aria-label={tab === "customers" ? "Müşteri profili" : "Tedarikçi profili"}
                                >
                                  <Button variant="ghost" size="icon" className="h-8 w-8" title="Profil">
                                    <User className="h-4 w-4" />
                                  </Button>
                                </Link>
                                <Link href={ekstreHref} aria-label="Ekstre / Excel">
                                  <Button variant="ghost" size="icon" className="h-8 w-8" title="Ekstre & Excel">
                                    <FileText className="h-4 w-4" />
                                  </Button>
                                </Link>
                              </div>
                            </TableCell>
                          </TableRow>
                          {isOpen ? (
                            <TableRow>
                              <TableCell colSpan={7} className="bg-muted/20 p-0">
                                <div className="p-3">
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead>Fatura No</TableHead>
                                        <TableHead>Tarih</TableHead>
                                        <TableHead>Vade</TableHead>
                                        <TableHead>Geciken Gün</TableHead>
                                        <TableHead>Dilim</TableHead>
                                        <TableHead className="text-right">Tutar</TableHead>
                                        <TableHead className="text-right">Ödenen</TableHead>
                                        <TableHead className="text-right">Açık</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {acc.invoices.length === 0 ? (
                                        <TableRow>
                                          <TableCell colSpan={8} className="text-center text-muted-foreground">
                                            Açık fatura yok
                                          </TableCell>
                                        </TableRow>
                                      ) : (
                                        acc.invoices.map((inv) => (
                                          <TableRow key={inv.id}>
                                            <TableCell className="font-medium">{inv.invoiceNo}</TableCell>
                                            <TableCell>{fmtDate(inv.date)}</TableCell>
                                            <TableCell>{fmtDate(inv.effectiveDueDate)}</TableCell>
                                            <TableCell>
                                              {inv.bucket === "not_due" ? (
                                                <span className="text-xs text-muted-foreground">vadesi gelmedi</span>
                                              ) : (
                                                <span className="text-sm font-medium">{inv.overdueDays}</span>
                                              )}
                                            </TableCell>
                                            <TableCell>
                                              <span
                                                className={cn(
                                                  "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                                                  BUCKET_BADGE[inv.bucket]
                                                )}
                                              >
                                                {BUCKET_LABEL[inv.bucket]}
                                              </span>
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                              {fmtTRY(inv.totalAmount)}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                              {fmtTRY(inv.paidAmount)}
                                            </TableCell>
                                            <TableCell className="text-right font-semibold tabular-nums">
                                              {fmtTRY(inv.openAmount)}
                                            </TableCell>
                                          </TableRow>
                                        ))
                                      )}
                                    </TableBody>
                                  </Table>
                                </div>
                              </TableCell>
                            </TableRow>
                          ) : null}
                        </Fragment>
                      )
                    })
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  )
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className={cn("mt-1 text-xl font-bold tabular-nums", tone)}>{fmtTRY(value)}</div>
      </CardContent>
    </Card>
  )
}

function InfoCard({ label, primary, secondary }: { label: string; primary: string; secondary?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 text-lg font-semibold tabular-nums">{primary}</div>
        {secondary ? <div className="text-xs text-muted-foreground">{secondary}</div> : null}
      </CardContent>
    </Card>
  )
}
