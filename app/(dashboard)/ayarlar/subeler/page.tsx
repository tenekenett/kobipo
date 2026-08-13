"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ArrowRight, Building2, CheckCircle2, Plus } from "lucide-react"
import { findCompanyByParam } from "@/lib/company/client-selection"
import { withCompanyHref } from "@/lib/company/href"
import { companyDisplayName } from "@/lib/company/display-name"

interface Company {
  id: string
  slug?: string
  name: string
  branchName?: string | null
  isEDonusumEnabled?: boolean
  isBranch?: boolean
  parentName?: string | null
}

/** `/api/companies/branch-quota` yanıtı — şube açma denetimiyle aynı kaynaktan gelir. */
interface BranchQuota {
  quota: number
  used: number
  remaining: number
  canAddBranch: boolean
  hasActiveSubscription: boolean
}

export default function SubelerPage() {
  const searchParams = useSearchParams()
  const activeCompanyId = searchParams.get("company")
  // Yeni şube, aktif (ana) firmaya bağlanır. Aktif firma yoksa buton pasif olur.
  const branchHref = activeCompanyId
    ? `/companies/new?mode=branch&parent=${encodeURIComponent(activeCompanyId)}`
    : "/companies/new?mode=branch"
  const [companies, setCompanies] = useState<Company[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [quota, setQuota] = useState<BranchQuota | null>(null)
  // `?company=` SEF sonrası slug taşır; kartlardaki "Aktif" rozeti cuid ile karşılaştırıldığı
  // için hiç görünmüyordu. Param'ı önce gerçek id'ye çöz.
  const activeId = findCompanyByParam(companies, activeCompanyId)?.id ?? activeCompanyId
  const activeCompanyName = companies.find((c) => c.id === activeId)?.name ?? null
  const quotaFull = !!quota && !quota.canAddBranch

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    fetch("/api/companies", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : []))
      .then((data: Company[]) => {
        if (!cancelled) setCompanies(Array.isArray(data) ? data : [])
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Kota AKTİF HESABINDIR (şubeden bakılsa da ana firmanın kotası döner), bu yüzden
  // `?company=` değişince yeniden okunur.
  useEffect(() => {
    if (!activeCompanyId) {
      setQuota(null)
      return
    }
    let cancelled = false
    fetch(`/api/companies/branch-quota?companyId=${encodeURIComponent(activeCompanyId)}`, {
      cache: "no-store",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: BranchQuota | null) => {
        if (!cancelled) setQuota(data && typeof data.quota === "number" ? data : null)
      })
      .catch(() => {
        if (!cancelled) setQuota(null)
      })
    return () => {
      cancelled = true
    }
  }, [activeCompanyId])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-kobipo-navy dark:text-foreground">Şube Yönetimi</h1>
          <p className="text-sm text-muted-foreground">
            Erişiminiz olan tüm firma/şubeleri görüntüleyin ve yenisini ekleyin
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/companies/new">
            <Button variant="outline">
              <Plus className="mr-2 h-4 w-4" />
              Yeni Firma
            </Button>
          </Link>
          <Link href={branchHref} aria-disabled={quotaFull} tabIndex={quotaFull ? -1 : undefined}>
            <Button
              disabled={!activeCompanyId || quotaFull}
              title={quotaFull ? "Şube kotanız dolu — aboneliğinizi yükseltin" : undefined}
            >
              <Plus className="mr-2 h-4 w-4" />
              Yeni Şube
            </Button>
          </Link>
        </div>
      </div>

      {/* Şube kotası — şube açma denetimiyle aynı kaynaktan (getBranchQuotaStatus). */}
      {quota && (
        <Card>
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-medium">Şube kotası</span>
                <span className="text-lg font-bold tabular-nums">
                  {quota.used}/{quota.quota}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {activeCompanyName ? `· ${activeCompanyName}` : ""}
                </span>
              </div>
              <div
                className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuenow={quota.used}
                aria-valuemin={0}
                aria-valuemax={quota.quota}
              >
                <div
                  className={`h-full rounded-full transition-all ${
                    quotaFull ? "bg-amber-500" : "bg-primary"
                  }`}
                  style={{
                    width: `${quota.quota > 0 ? Math.min(100, (quota.used / quota.quota) * 100) : 100}%`,
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {!quota.hasActiveSubscription
                  ? "Aktif aboneliğiniz yok — şube açmak için abonelik gerekir."
                  : quota.remaining > 0
                    ? `${quota.remaining} şube daha açabilirsiniz.`
                    : "Kotanız dolu. Yeni şube için kotanızı yükseltin."}
              </p>
            </div>
            {(quotaFull || !quota.hasActiveSubscription) && (
              <Link href={withCompanyHref("/ayarlar/abonelik", activeCompanyId)}>
                <Button variant="outline" size="sm" className="shrink-0">
                  Kotayı yükselt
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Firmalar ve şubeler</CardTitle>
          {/* "Toplam N şube" YANILTICIYDI: bu liste kullanıcının üye olduğu HER firmayı
              (başka hesaplar dahil) ve onların şubelerini gösterir; kota ise yalnız AKTİF
              hesabın şubelerini sayar. İki sayı farklı kümeler — ayrımı açıkça yazıyoruz. */}
          <CardDescription>
            {isLoading
              ? "Yükleniyor…"
              : `Erişiminiz olan ${companies.length} firma/şube` +
                (quota ? ` · aktif hesabınızın ${quota.used} şubesi var` : "")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Yükleniyor…</p>
          ) : companies.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm font-medium">Henüz şube yok</p>
              <p className="mt-1 text-xs text-muted-foreground">
                İlk şubenizi oluşturarak başlayın.
              </p>
              <Link href={branchHref}>
                <Button className="mt-4" disabled={!activeCompanyId}>
                  <Plus className="mr-2 h-4 w-4" />
                  Yeni Şube
                </Button>
              </Link>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {companies.map((c) => {
                const isActive = c.id === activeId
                return (
                  <div
                    key={c.id}
                    className="group flex items-start justify-between gap-3 rounded-xl border p-4 transition-colors hover:border-primary/40 hover:bg-muted/30"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-kobipo-blue/10 text-kobipo-blue dark:bg-primary/15 dark:text-primary">
                        <Building2 className="h-5 w-5" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="truncate font-semibold">{companyDisplayName(c)}</p>
                          {isActive && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                              <CheckCircle2 className="h-2.5 w-2.5" />
                              Aktif
                            </span>
                          )}
                          {c.isBranch && (
                            <span className="inline-flex items-center rounded-full bg-teal-100 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700 dark:bg-teal-900/30 dark:text-teal-300">
                              Şube{c.parentName ? ` · ${c.parentName}` : ""}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {c.isEDonusumEnabled ? (
                            <Badge variant="aktif">E-Dönüşüm</Badge>
                          ) : (
                            <Badge variant="secondary">Standart</Badge>
                          )}
                        </div>
                      </div>
                    </div>
                    {c.isBranch ? (
                      <Link
                        // Aktif firma taşınır: detay sayfası ŞUBEnin verisini gösterir ama
                        // seçim ana firmadadır; param düşerse geri dönüş bağlamı kaybolur.
                        href={withCompanyHref(
                          `/ayarlar/subeler/${encodeURIComponent(c.id)}`,
                          activeCompanyId
                        )}
                        className="inline-flex shrink-0 self-center items-center gap-1.5 rounded-md border border-teal-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-teal-700 transition hover:bg-teal-50 dark:border-teal-800 dark:bg-transparent dark:text-teal-300 dark:hover:bg-teal-900/30"
                        aria-label="Şube detayı"
                      >
                        Detay
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    ) : (
                      <Link
                        href={`/dashboard?company=${encodeURIComponent(c.id)}`}
                        className="shrink-0 self-center text-muted-foreground transition-colors group-hover:text-foreground"
                        aria-label="Firmaya geç"
                      >
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Şube ayarları</CardTitle>
          <CardDescription>
            Aktif şubenin detaylarını düzenlemek için Firma Bilgileri sayfasına gidin.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href={activeCompanyId ? `/ayarlar/firma?company=${activeCompanyId}` : "/ayarlar/firma"}
          >
            <Button variant="outline">Firma Bilgileri</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
