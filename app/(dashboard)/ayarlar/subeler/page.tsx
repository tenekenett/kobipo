"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { AlertTriangle, ArrowRight, Building2, CheckCircle2, Plus } from "lucide-react"
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
  /** Doluysa şubedir (üyeliksiz erişimde `isBranch` de dolu olur, üyelikte olmaz). */
  parentCompanyId?: string | null
  parentName?: string | null
  /** Şube değilken doluysa: hesaba bağlı ek firma (ayrı VKN, ortak abonelik). */
  accountRootId?: string | null
}

/** `/api/companies/quota` yanıtındaki tek kota — açma denetimiyle aynı kaynaktan gelir. */
interface QuotaStatus {
  quota: number
  used: number
  remaining: number
  canAdd: boolean
  hasActiveSubscription: boolean
}

/** Hesabın iki kotası: şube (aynı VKN) ve ek firma (ayrı VKN). Ayrı havuzlardır. */
interface AccountQuotas {
  branch: QuotaStatus
  company: QuotaStatus
}

/**
 * Firma/şube ekleme sayfasından kota nedeniyle geri gönderilen kullanıcıya sebebi yazar.
 * Param'ı `companies/new` sayfasının sunucu kapısı koyar (bkz. o dosyanın başlığı).
 */
const QUOTA_NOTICE: Record<string, string> = {
  branch:
    "Şube kotanız dolu — yeni şube ekleyemezsiniz. Eklemek için aboneliğinizden ek şube satın alın.",
  company:
    "Firma kotanız dolu — yeni firma ekleyemezsiniz. Eklemek için aboneliğinizden ek firma satın alın.",
  // "Kotası dolu" değil "hiç aboneliği yok": çözümü farklı, mesajı da farklı olmalı.
  subscription:
    "Aktif aboneliğiniz yok — yeni firma veya şube eklemek için önce abonelik gerekir.",
  account:
    "Zaten bir hesabınız var. Yeni firma, mevcut hesabınıza ek firma olarak eklenir — aşağıdaki firma kotasını kullanır.",
}

export default function SubelerPage() {
  const searchParams = useSearchParams()
  const activeCompanyId = searchParams.get("company")
  const quotaNotice = QUOTA_NOTICE[searchParams.get("quota") ?? ""] ?? null
  // Yeni şube aktif firmaya bağlanır; yeni FİRMA ise aktif firmanın HESABINA (kotayı o
  // öder, modülleri o verir). İkisi de aktif firma olmadan açılamaz.
  const branchHref = activeCompanyId
    ? `/companies/new?mode=branch&parent=${encodeURIComponent(activeCompanyId)}`
    : "/companies/new?mode=branch"
  const companyHref = activeCompanyId
    ? `/companies/new?account=${encodeURIComponent(activeCompanyId)}`
    : "/companies/new"
  const [companies, setCompanies] = useState<Company[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [quotas, setQuotas] = useState<AccountQuotas | null>(null)
  // `?company=` SEF sonrası slug taşır; kartlardaki "Aktif" rozeti cuid ile karşılaştırıldığı
  // için hiç görünmüyordu. Param'ı önce gerçek id'ye çöz.
  const activeId = findCompanyByParam(companies, activeCompanyId)?.id ?? activeCompanyId
  const activeCompanyName = companies.find((c) => c.id === activeId)?.name ?? null
  const branchQuotaFull = !!quotas && !quotas.branch.canAdd
  const companyQuotaFull = !!quotas && !quotas.company.canAdd

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

  // Kotalar AKTİF HESABINDIR (şubeden ya da ek firmadan bakılsa da hesabın kotası
  // döner), bu yüzden `?company=` değişince yeniden okunur.
  useEffect(() => {
    if (!activeCompanyId) {
      setQuotas(null)
      return
    }
    let cancelled = false
    fetch(`/api/companies/quota?companyId=${encodeURIComponent(activeCompanyId)}`, {
      cache: "no-store",
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: AccountQuotas | null) => {
        if (!cancelled) setQuotas(data && typeof data.branch?.quota === "number" ? data : null)
      })
      .catch(() => {
        if (!cancelled) setQuotas(null)
      })
    return () => {
      cancelled = true
    }
  }, [activeCompanyId])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-kobipo-navy dark:text-foreground">
            Firma ve Şube Yönetimi
          </h1>
          <p className="text-sm text-muted-foreground">
            Erişiminiz olan tüm firma/şubeleri görüntüleyin ve yenisini ekleyin
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <AddButton
            href={companyHref}
            disabled={!activeCompanyId || companyQuotaFull}
            variant="outline"
            title={
              companyQuotaFull ? "Firma kotanız dolu — ek firma satın alın" : "Ayrı VKN'li yeni firma"
            }
          >
            Yeni Firma
          </AddButton>
          <AddButton
            href={branchHref}
            disabled={!activeCompanyId || branchQuotaFull}
            title={branchQuotaFull ? "Şube kotanız dolu — ek şube satın alın" : "Aynı VKN, yeni adres"}
          >
            Yeni Şube
          </AddButton>
        </div>
      </div>

      {quotaNotice && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{quotaNotice}</p>
        </div>
      )}

      {/* İKİ AYRI KOTA. Açma denetimiyle aynı kaynaktan gelir (getAccountQuotas), yoksa
          ekran "hakkınız var" derken API 402 döndürebilir. */}
      {quotas && (
        <div className="grid gap-3 sm:grid-cols-2">
          <QuotaCard
            title="Şube kotası"
            hint="Aynı VKN, farklı adres"
            status={quotas.branch}
            accountName={activeCompanyName}
            emptyText="Aktif aboneliğiniz yok — şube açmak için abonelik gerekir."
            remainingText={(n) => `${n} şube daha açabilirsiniz.`}
            fullText="Kotanız dolu. Yeni şube için ek şube satın alın."
            upgradeHref={withCompanyHref("/ayarlar/abonelik", activeCompanyId)}
          />
          <QuotaCard
            title="Firma kotası"
            hint="Ayrı VKN, aynı abonelik"
            status={quotas.company}
            accountName={activeCompanyName}
            emptyText="Aktif aboneliğiniz yok — ek firma açmak için abonelik gerekir."
            remainingText={(n) => `${n} firma daha açabilirsiniz.`}
            fullText="Kotanız dolu. Yeni firma için ek firma satın alın."
            upgradeHref={withCompanyHref("/ayarlar/abonelik", activeCompanyId)}
          />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Firmalar ve şubeler</CardTitle>
          {/* "Toplam N şube" YANILTICIYDI: bu liste kullanıcının üye olduğu HER firmayı
              (başka hesaplar dahil) ve onların şubelerini gösterir; kota ise yalnız AKTİF
              hesabınkileri sayar. İki sayı farklı kümeler — ayrımı açıkça yazıyoruz. */}
          <CardDescription>
            {isLoading
              ? "Yükleniyor…"
              : `Erişiminiz olan ${companies.length} firma/şube` +
                (quotas
                  ? ` · aktif hesabınızda ${quotas.company.used} ek firma, ${quotas.branch.used} şube var`
                  : "")}
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
              <AddButton
                href={branchHref}
                disabled={!activeCompanyId || branchQuotaFull}
                className="mt-4"
                title={branchQuotaFull ? "Şube kotanız dolu — ek şube satın alın" : undefined}
              >
                Yeni Şube
              </AddButton>
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
                          {/* Şube ölçüsü ROZETTE `parentCompanyId`dir, `isBranch` değil:
                              `isBranch` yalnız "üyeliksiz, parent-admin erişimiyle görülen
                              şube" için doludur. Doğrudan üye olunan şube de şubedir —
                              yoksa `accountRootId` dolu olduğu için "Ek firma" etiketi
                              alırdı (canlıda 3 üyeli böyle bir şube var). */}
                          {c.isBranch || c.parentCompanyId ? (
                            <span className="inline-flex items-center rounded-full bg-teal-100 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700 dark:bg-teal-900/30 dark:text-teal-300">
                              Şube{c.parentName ? ` · ${c.parentName}` : ""}
                            </span>
                          ) : c.accountRootId ? (
                            // Ek firma: ayrı VKN'li tüzel kişi ama abonelik hesap kökünden
                            // akıyor — kullanıcı hangi hesabın kotasını kullandığını görmeli.
                            <span className="inline-flex items-center rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                              Ek firma{c.parentName ? ` · ${c.parentName}` : ""}
                            </span>
                          ) : null}
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

/**
 * Kotaya bağlı "ekle" butonu.
 *
 * Devre dışıyken bağlantı HİÇ çizilmez — `<Link>` içine konmuş `disabled` bir Button
 * gri görünür ama TIKLANABİLİR kalır: buton `disabled:pointer-events-none` ile tıklama
 * hedefi olmaktan çıkar, tıklama altındaki anchor'a düşer ve gezinme yine olur.
 * `aria-disabled`/`tabIndex={-1}` yalnız klavye ve ekran okuyucu içindir, fareyi tutmaz.
 * Sunucu zaten 402 döndürür, ama kullanıcıyı dolu kotayla forma sokmak yanlış.
 */
function AddButton({
  href,
  disabled,
  title,
  variant,
  className,
  children,
}: {
  href: string
  disabled: boolean
  title?: string
  variant?: "outline"
  className?: string
  children: React.ReactNode
}) {
  const button = (
    <Button variant={variant} disabled={disabled} title={title} className={className}>
      <Plus className="mr-2 h-4 w-4" />
      {children}
    </Button>
  )
  return disabled ? button : <Link href={href}>{button}</Link>
}

/**
 * Tek bir hesap kotasının kartı (şube ya da firma). İkisi aynı bileşenden çizilir ki
 * "kullanılan/kota" okuması ve dolu uyarısı iki üründe de birebir aynı görünsün.
 */
function QuotaCard({
  title,
  hint,
  status,
  accountName,
  emptyText,
  remainingText,
  fullText,
  upgradeHref,
}: {
  title: string
  hint: string
  status: QuotaStatus
  accountName: string | null
  emptyText: string
  remainingText: (remaining: number) => string
  fullText: string
  upgradeHref: string
}) {
  const full = !status.canAdd
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-4">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-sm font-medium">{title}</span>
            <span className="text-lg font-bold tabular-nums">
              {status.used}/{status.quota}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {accountName ? `· ${accountName}` : ""}
            </span>
          </div>
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{hint}</p>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={status.used}
            aria-valuemin={0}
            aria-valuemax={status.quota}
          >
            <div
              className={`h-full rounded-full transition-all ${full ? "bg-amber-500" : "bg-primary"}`}
              style={{
                width: `${status.quota > 0 ? Math.min(100, (status.used / status.quota) * 100) : 100}%`,
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {!status.hasActiveSubscription
              ? emptyText
              : status.remaining > 0
                ? remainingText(status.remaining)
                : fullText}
          </p>
        </div>
        {(full || !status.hasActiveSubscription) && (
          <Link href={upgradeHref} className="self-start">
            <Button variant="outline" size="sm">
              Kotayı yükselt
            </Button>
          </Link>
        )}
      </CardContent>
    </Card>
  )
}
