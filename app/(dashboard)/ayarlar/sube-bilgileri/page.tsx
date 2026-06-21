"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  ArrowUpRight,
  Building2,
  GitBranch,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Receipt,
  Store,
  TrendingUp,
  Users,
  Package,
} from "lucide-react"

interface CompanyDetail {
  id: string
  name: string
  taxNumber?: string | null
  taxOffice?: string | null
  address?: string | null
  city?: string | null
  phone?: string | null
  email?: string | null
  isEDonusumEnabled?: boolean
  createdAt?: string
  parentCompanyId?: string | null
  parentCompany?: { id: string; name: string } | null
  branches?: { id: string; name: string }[]
}

interface Invoice {
  id: string
  invoiceNo: string
  type: string
  status: string
  date: string
  totalAmount: number | string
  customer?: { name?: string | null } | null
  supplier?: { name?: string | null } | null
}

const currency = (n: number) =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(n)
const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString("tr-TR", { dateStyle: "medium" }) : "-"

function Stat({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string
  value: string
  icon: typeof Receipt
  accent: string
}) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-1 truncate font-mono text-xl font-bold tabular-nums">{value}</p>
        </div>
        <span className={`rounded-xl p-2 ${accent}`}>
          <Icon className="h-5 w-5" />
        </span>
      </CardContent>
    </Card>
  )
}

export default function SubeBilgileriPage() {
  const companyId = useSearchParams().get("company")
  const [company, setCompany] = useState<CompanyDetail | null>(null)
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [customerCount, setCustomerCount] = useState(0)
  const [productCount, setProductCount] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    setLoading(true)
    Promise.all([
      fetch(`/api/companies/${companyId}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/e-donusum/invoices?companyId=${companyId}`, { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : [],
      ),
      fetch(`/api/cari/customers?companyId=${companyId}`, { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : [],
      ),
      fetch(`/api/stok/products?companyId=${companyId}`, { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : [],
      ),
    ])
      .then(([comp, inv, cust, prod]) => {
        if (cancelled) return
        setCompany(comp)
        setInvoices(Array.isArray(inv) ? inv : [])
        const custArr = Array.isArray(cust) ? cust : cust?.items ?? []
        setCustomerCount(custArr.length)
        setProductCount(Array.isArray(prod) ? prod.length : 0)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [companyId])

  const stats = useMemo(() => {
    const sales = invoices.filter((i) => i.type === "SALES")
    const purchases = invoices.filter((i) => i.type === "PURCHASE")
    const salesTotal = sales.reduce((s, i) => s + Number(i.totalAmount || 0), 0)
    return { salesTotal, salesCount: sales.length, purchaseCount: purchases.length }
  }, [invoices])

  const recent = useMemo(
    () =>
      [...invoices]
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 8),
    [invoices],
  )

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Şube Bilgileri</CardTitle>
          <CardDescription>Lütfen bir firma/şube seçin</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const isBranch = Boolean(company?.parentCompanyId)
  const hasBranches = (company?.branches?.length ?? 0) > 0

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-kobipo-blue/10 text-kobipo-blue dark:bg-primary/15 dark:text-primary">
            <Store className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-2xl font-bold text-kobipo-navy dark:text-foreground">Şube Bilgileri</h1>
            <p className="text-sm text-muted-foreground">
              Seçili şubenin bilgileri ve yapılan işlemler
            </p>
          </div>
        </div>
        <Link href={`/ayarlar/firma?company=${companyId}`}>
          <Button variant="outline">Bilgileri Düzenle</Button>
        </Link>
      </div>

      {loading && !company ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Yükleniyor…
        </div>
      ) : !company ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Firma bilgisi yüklenemedi.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Kimlik kartı */}
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-lg">{company.name}</CardTitle>
                {isBranch ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-kobipo-blue/10 px-2 py-0.5 text-xs font-semibold text-kobipo-blue dark:bg-primary/15 dark:text-primary">
                    <GitBranch className="h-3 w-3" />
                    Şube
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                    <Building2 className="h-3 w-3" />
                    Ana Firma
                  </span>
                )}
                {company.isEDonusumEnabled && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                    e-Dönüşüm aktif
                  </span>
                )}
              </div>
              {isBranch && company.parentCompany && (
                <CardDescription>
                  <Link
                    href={`/ayarlar/sube-bilgileri?company=${company.parentCompany.id}`}
                    className="text-kobipo-blue hover:underline dark:text-primary"
                  >
                    {company.parentCompany.name}
                  </Link>{" "}
                  firmasının şubesi
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
              <Info label="VKN / TCKN" value={company.taxNumber} mono />
              <Info label="Vergi Dairesi" value={company.taxOffice} />
              <Info label="Adres" value={company.address} icon={MapPin} />
              <Info label="Şehir" value={company.city} />
              <Info label="Telefon" value={company.phone} icon={Phone} />
              <Info label="E-Posta" value={company.email} icon={Mail} />
              <Info label="Oluşturulma" value={fmtDate(company.createdAt)} />
            </CardContent>
          </Card>

          {/* İşlem özeti */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Toplam Satış"
              value={currency(stats.salesTotal)}
              icon={TrendingUp}
              accent="bg-kobipo-blue/10 text-kobipo-blue dark:bg-primary/15 dark:text-primary"
            />
            <Stat
              label="Satış Faturası"
              value={String(stats.salesCount)}
              icon={Receipt}
              accent="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
            />
            <Stat
              label="Müşteri"
              value={String(customerCount)}
              icon={Users}
              accent="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
            />
            <Stat
              label="Ürün / Hizmet"
              value={String(productCount)}
              icon={Package}
              accent="bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300"
            />
          </div>

          {/* Ana firmanın şubeleri */}
          {hasBranches && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Şubeler</CardTitle>
                <CardDescription>{company.branches!.length} şube</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2 sm:grid-cols-2">
                  {company.branches!.map((b) => (
                    <Link
                      key={b.id}
                      href={`/ayarlar/sube-bilgileri?company=${b.id}`}
                      className="flex items-center justify-between gap-2 rounded-lg border p-3 text-sm transition-colors hover:border-primary/40 hover:bg-muted/40"
                    >
                      <span className="flex items-center gap-2 truncate">
                        <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="truncate font-medium">{b.name}</span>
                      </span>
                      <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Son işlemler */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Son işlemler</CardTitle>
              <CardDescription>Bu şubede kesilen son faturalar</CardDescription>
            </CardHeader>
            <CardContent>
              {recent.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Henüz işlem yok
                </p>
              ) : (
                <ul className="divide-y rounded-lg border">
                  {recent.map((inv) => {
                    const isSale = inv.type === "SALES"
                    const party = isSale
                      ? inv.customer?.name?.trim() || "Perakende"
                      : inv.supplier?.name?.trim() || "—"
                    return (
                      <li key={inv.id}>
                        <Link
                          href={`/faturalar/${inv.id}/onizleme?company=${companyId}`}
                          className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span
                                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                  isSale
                                    ? "bg-kobipo-blue/10 text-kobipo-blue dark:bg-primary/15 dark:text-primary"
                                    : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                                }`}
                              >
                                {isSale ? "Satış" : "Alış"}
                              </span>
                              <span className="truncate font-medium">{party}</span>
                            </div>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {inv.invoiceNo} · {fmtDate(inv.date)}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm font-semibold tabular-nums">
                              {currency(Number(inv.totalAmount || 0))}
                            </span>
                            <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                          </div>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function Info({
  label,
  value,
  icon: Icon,
  mono,
}: {
  label: string
  value?: string | null
  icon?: typeof MapPin
  mono?: boolean
}) {
  return (
    <div className="flex items-start gap-2">
      {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`break-words ${mono ? "font-mono" : ""}`}>{value || "-"}</p>
      </div>
    </div>
  )
}
