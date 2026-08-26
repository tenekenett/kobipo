import { prisma } from "@/lib/db/prisma"
import { notFound } from "next/navigation"
import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Building2,
  ArrowLeft,
  Users,
  FileText,
  Package,
  Truck,
  Mail,
  Phone,
  Globe,
  MapPin,
  Hash,
  Calendar,
  Briefcase,
  Receipt,
  Settings2,
} from "lucide-react"
import { CompanyEInvoiceCard } from "@/components/system-admin/company-einvoice-card"
import { CompanyModulesCard } from "@/components/system-admin/company-modules-card"
import { CompanyQuotaCard } from "@/components/system-admin/company-quota-card"
import { getAccountQuotas } from "@/lib/billing/entitlements"
import { getFreeModuleKeys } from "@/lib/billing/free-modules"
import { CompanyUsersCard } from "@/components/system-admin/company-users-card"
import { companyDisplayName } from "@/lib/company/display-name"

export const dynamic = "force-dynamic"

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const company = await prisma.company.findUnique({
    where: { id },
    include: {
      users: {
        include: {
          user: { select: { id: true, name: true, email: true, isSuperAdmin: true } },
        },
      },
      _count: {
        select: {
          customers: true,
          suppliers: true,
          products: true,
          invoices: true,
        },
      },
    },
  })

  if (!company) notFound()

  // Şube ise ana firması. (Hesap kökü ayrıca çözülmüyor: aşağıdaki `accountRootName`
  // zaten `getAccountQuotas`tan geliyor — ikinci bir sorgu iki kaynak demek olurdu.)
  // Ünvanlar birbirine benzediği için id yerine adıyla gösteriliyor.
  const parentCompany = company.parentCompanyId
    ? await prisma.company.findUnique({
        where: { id: company.parentCompanyId },
        select: { id: true, name: true, branchName: true },
      })
    : null

  // Seri bazında son kesilen belge numarası (DB) — entegratöre bağımlı değil.
  const lastByPrefix = async (prefix: string | null) => {
    if (!prefix) return null
    const inv = await prisma.invoice.findFirst({
      where: { companyId: id, invoiceNo: { startsWith: prefix } },
      orderBy: { invoiceNo: "desc" },
      select: { invoiceNo: true },
    })
    return inv?.invoiceNo ?? null
  }

  const [byType, byStatus, amountAgg, lastInvoice, lastEFaturaNo, lastEArchiveNo, lastSeriNo, allUsers] =
    await Promise.all([
      prisma.invoice.groupBy({
        by: ["invoiceType"],
        where: { companyId: id },
        _count: { _all: true },
      }),
      prisma.invoice.groupBy({
        by: ["status"],
        where: { companyId: id },
        _count: { _all: true },
      }),
      prisma.invoice.aggregate({
        where: { companyId: id },
        _sum: { totalAmount: true },
      }),
      prisma.invoice.findFirst({
        where: { companyId: id },
        orderBy: { date: "desc" },
        select: { invoiceNo: true, date: true, totalAmount: true, invoiceType: true, status: true },
      }),
      lastByPrefix(company.eFaturaPrefix),
      lastByPrefix(company.eArchivePrefix),
      lastByPrefix(company.invoiceSeriesPrefix),
      prisma.user.findMany({
        orderBy: { email: "asc" },
        select: { id: true, name: true, email: true },
      }),
    ])

  // Kotalar hesap (kök firma) düzeyindedir; şube/ek firma detayında da hesabın değerleri
  // gösterilir. Kart hangi hesaba yazacağını söyleyebilsin diye kökün adı da çözülür.
  const quotas = await getAccountQuotas(company.id)
  const accountRootName =
    quotas.rootCompanyId === company.id
      ? company.name
      : (
          await prisma.company.findUnique({
            where: { id: quotas.rootCompanyId },
            select: { name: true },
          })
        )?.name ?? "ana hesap"

  const typeCount = (t: string) => byType.find((r) => r.invoiceType === t)?._count._all ?? 0
  const statusCount = (s: string) => byStatus.find((r) => r.status === s)?._count._all ?? 0
  const totalAmount = Number(amountAgg._sum.totalAmount ?? 0)
  const fmtTRY = (n: number) =>
    new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(n)

  // JSON ayarlar ham hâliyle basılmaz (fiş şablonunda logo data-URL'i var, yüzlerce
  // KB). Destek için gereken bilgi "özelleştirilmiş mi, neresi dolu".
  const receipt = company.receiptTemplate as Record<string, unknown> | null
  const receiptTemplateSummary = receipt
    ? [
        receipt.logoDataUrl ? "logo var" : null,
        receipt.headerText ? "üst başlık" : null,
        receipt.footerText ? "alt not" : null,
        receipt.widthMm ? `${receipt.widthMm}mm` : null,
      ]
        .filter(Boolean)
        .join(" · ") || "özelleştirilmiş"
    : "Varsayılan"

  const opening = Array.isArray(company.openingHours)
    ? (company.openingHours as { closed?: boolean }[])
    : null
  const openingHoursSummary = opening
    ? `Tanımlı · ${opening.filter((d) => !d?.closed).length}/7 gün açık`
    : "Tanımsız"

  const businessRows: { label: string; value: string | null }[] = [
    { label: "Sektör", value: company.sector },
    { label: "İş Modeli", value: company.businessModel },
    { label: "Çalışan Aralığı", value: company.employeeRange },
    { label: "Aylık Fatura Hacmi", value: company.monthlyInvoiceVolume },
    { label: "Birincil İhtiyaç", value: company.primaryBusinessNeed },
    {
      label: "Daha Önce E-Dönüşüm Kullanımı",
      value:
        company.usesEDonusumBefore === null
          ? null
          : company.usesEDonusumBefore
          ? "Evet"
          : "Hayır",
    },
    {
      label: "Onboarding",
      value: company.onboardingCompletedAt
        ? `Tamamlandı · ${new Date(company.onboardingCompletedAt).toLocaleDateString("tr-TR")}`
        : "Tamamlanmadı",
    },
  ]

  // Firmanın PANELDEN girdiği, yukarıdaki iki kartın kapsamadığı ayarlar. Destek
  // konuşmasında en çok bunlar soruluyor ("fişte logo neden çıkmıyor", "bayi hesabı
  // açıldı mı") ve bugüne kadar tek bakılacak yer veritabanıydı.
  const settingRows: { label: string; value: string | null }[] = [
    {
      label: "Geçmiş Tarihli e-Fatura Serisi",
      value: company.eFaturaBackdatePrefix,
    },
    {
      label: "Geçmiş Tarihli e-Arşiv Serisi",
      value: company.eArchiveBackdatePrefix,
    },
    {
      label: "e-Dönüşüm Hesap Açılışı",
      value: company.eDonusumOnboardingStatus
        ? company.eDonusumTenantCreatedAt
          ? `${company.eDonusumOnboardingStatus} · ${new Date(company.eDonusumTenantCreatedAt).toLocaleString("tr-TR")}`
          : company.eDonusumOnboardingStatus
        : null,
    },
    {
      label: "Aktifleştirilen Ürünler",
      value: company.eDonusumActivatedProducts.length
        ? company.eDonusumActivatedProducts.join(", ")
        : null,
    },
    { label: "Hesap Açılış Hatası", value: company.eDonusumActivationError },
    {
      label: "Fiş Tasarımı",
      value: receiptTemplateSummary,
    },
    {
      label: "Açılış Saatleri",
      value: openingHoursSummary,
    },
    {
      label: "Restoran İskonto Tavanı",
      value:
        company.restaurantMaxDiscountPercent === null
          ? "Sınır yok"
          : `%${Number(company.restaurantMaxDiscountPercent)}`,
    },
  ]

  const invoiceStatCards = [
    { label: "E-Fatura", value: typeCount("E_INVOICE"), color: "text-blue-300" },
    { label: "E-Arşiv", value: typeCount("E_ARCHIVE"), color: "text-cyan-300" },
    { label: "Taslak", value: statusCount("DRAFT"), color: "text-slate-300" },
    { label: "Gönderilmiş", value: statusCount("SENT"), color: "text-emerald-300" },
    { label: "İptal", value: statusCount("CANCELLED"), color: "text-red-300" },
  ]

  const infoRows: { icon: React.ReactNode; label: string; value: string | null }[] = [
    // Ünvan ve şube adı AYRI alanlardır: ünvan belgelere basılır, şube adı yalnız
    // arayüzde ayırt eder. Başlıkta yalnız ünvan yazdığı için ikisi de burada.
    { icon: <Building2 className="h-4 w-4" />, label: "Ünvan", value: company.name },
    { icon: <Building2 className="h-4 w-4" />, label: "Şube Adı", value: company.branchName },
    {
      icon: <Building2 className="h-4 w-4" />,
      label: "Bağlı Olduğu Ana Firma",
      value: parentCompany ? companyDisplayName(parentCompany) : null,
    },
    {
      icon: <Building2 className="h-4 w-4" />,
      label: "Hesap (Faturalama) Kökü",
      value: quotas.rootCompanyId === company.id ? "Kendisi (hesap kökü)" : accountRootName,
    },
    { icon: <Hash className="h-4 w-4" />, label: "Vergi No", value: company.taxNumber },
    { icon: <Building2 className="h-4 w-4" />, label: "Vergi Dairesi", value: company.taxOffice },
    { icon: <Mail className="h-4 w-4" />, label: "E-posta", value: company.email },
    { icon: <Phone className="h-4 w-4" />, label: "Telefon", value: company.phone },
    { icon: <Globe className="h-4 w-4" />, label: "Web Sitesi", value: company.website },
    {
      icon: <MapPin className="h-4 w-4" />,
      label: "Adres",
      value: [company.address, company.city, company.country].filter(Boolean).join(", ") || null,
    },
    { icon: <Globe className="h-4 w-4" />, label: "Ülke", value: company.country },
    {
      icon: <Calendar className="h-4 w-4" />,
      label: "Kayıt Tarihi",
      value: new Date(company.createdAt).toLocaleString("tr-TR"),
    },
    {
      icon: <Calendar className="h-4 w-4" />,
      label: "Son Güncelleme",
      value: new Date(company.updatedAt).toLocaleString("tr-TR"),
    },
    { icon: <Hash className="h-4 w-4" />, label: "Adres Anahtarı (slug)", value: company.slug },
    { icon: <Hash className="h-4 w-4" />, label: "Firma ID", value: company.id },
  ]

  const statCards = [
    { label: "Müşteri", value: company._count.customers, icon: Users, color: "text-blue-400" },
    { label: "Tedarikçi", value: company._count.suppliers, icon: Truck, color: "text-emerald-400" },
    { label: "Ürün/Hizmet", value: company._count.products, icon: Package, color: "text-orange-400" },
    { label: "Fatura", value: company._count.invoices, icon: FileText, color: "text-purple-400" },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/system-admin/companies"
            className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-800/50 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <Building2 className="h-7 w-7 text-blue-400" />
              {company.name}
            </h1>
            <p className="text-slate-400 mt-1">
              Kayıt: {new Date(company.createdAt).toLocaleDateString("tr-TR")}
            </p>
          </div>
        </div>
        <span
          className={`px-3 py-1 rounded-full text-sm font-medium ${
            company.isActive ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
          }`}
        >
          {company.isActive ? "Aktif" : "Pasif"}
        </span>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {statCards.map((s) => (
          <Card key={s.label} className="bg-slate-900/50 border-slate-800">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-slate-400">{s.label}</p>
                  <p className="text-3xl font-bold text-white">{s.value}</p>
                </div>
                <s.icon className={`h-10 w-10 ${s.color} opacity-50`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Firma bilgileri */}
        <Card className="bg-slate-900/50 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white">Firma Bilgileri</CardTitle>
            <CardDescription className="text-slate-500">İletişim ve vergi bilgileri</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {infoRows.map((row) => (
              <div
                key={row.label}
                className="flex items-start gap-3 border-b border-slate-800 pb-3 last:border-0 last:pb-0"
              >
                <span className="mt-0.5 text-slate-500">{row.icon}</span>
                <div className="min-w-0">
                  <p className="text-xs text-slate-500">{row.label}</p>
                  <p className="text-sm text-slate-200 break-words">{row.value || "-"}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Kullanıcılar */}
        <CompanyUsersCard
          companyId={company.id}
          members={company.users.map((uc) => ({ role: uc.role, user: uc.user }))}
          allUsers={allUsers}
        />

        {/* İş Profili & Onboarding */}
        <Card className="bg-slate-900/50 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Briefcase className="h-5 w-5 text-amber-400" />
              İş Profili & Onboarding
            </CardTitle>
            <CardDescription className="text-slate-500">
              Sektör, ölçek ve kayıt sürecinde toplanan bilgiler
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {businessRows.map((row) => (
              <div
                key={row.label}
                className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3 last:border-0 last:pb-0"
              >
                <p className="text-xs text-slate-500">{row.label}</p>
                <p className="text-sm text-slate-200 text-right break-words">{row.value || "-"}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Firma tarafından girilen diğer ayarlar */}
        <Card className="bg-slate-900/50 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-sky-400" />
              Kurulum & Tercihler
            </CardTitle>
            <CardDescription className="text-slate-500">
              Panelden girilen ek seriler, e-Dönüşüm hesap açılışı ve tasarım tercihleri
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {settingRows.map((row) => (
              <div
                key={row.label}
                className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3 last:border-0 last:pb-0"
              >
                <p className="text-xs text-slate-500">{row.label}</p>
                <p className="text-sm text-slate-200 text-right break-words">{row.value || "-"}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Fatura İstatistikleri */}
        <Card className="bg-slate-900/50 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Receipt className="h-5 w-5 text-purple-400" />
              Fatura İstatistikleri
            </CardTitle>
            <CardDescription className="text-slate-500">
              Belge türü, durum dağılımı ve toplam tutar
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {invoiceStatCards.map((s) => (
                <div key={s.label} className="rounded-lg bg-slate-800/50 p-3">
                  <p className="text-xs text-slate-500">{s.label}</p>
                  <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                </div>
              ))}
              <div className="rounded-lg bg-slate-800/50 p-3">
                <p className="text-xs text-slate-500">Toplam Tutar</p>
                <p className="text-xl font-bold text-white">{fmtTRY(totalAmount)}</p>
              </div>
            </div>
            <div className="rounded-lg bg-slate-800/40 p-3">
              <p className="text-xs font-medium text-slate-400 mb-1">Son Fatura</p>
              {lastInvoice ? (
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-mono text-slate-200">{lastInvoice.invoiceNo}</span>
                  <span className="text-slate-400">
                    {new Date(lastInvoice.date).toLocaleDateString("tr-TR")} ·{" "}
                    {fmtTRY(Number(lastInvoice.totalAmount))}
                  </span>
                </div>
              ) : (
                <p className="text-sm text-slate-500">Henüz fatura yok</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Modül yönetimi (hesap düzeyinde uygulanır) */}
        <CompanyModulesCard
          companyId={company.id}
          initialDisabled={company.disabledModules ?? []}
          freeModules={await getFreeModuleKeys()}
        />

        {/* Şube + ek firma kotası. Kotalar hesap kökünde tutulur; bu firma bir şube ya da
            ek firma ise değişiklik köke yazılır (kart bunu açıkça söylüyor). */}
        <CompanyQuotaCard
          companyId={company.id}
          accountRootName={accountRootName}
          isAccountRoot={quotas.rootCompanyId === company.id}
          branch={{ quota: quotas.branch.quota, used: quotas.branch.used }}
          company={{ quota: quotas.company.quota, used: quotas.company.used }}
          hasActiveSubscription={quotas.branch.hasActiveSubscription}
        />

        {/* E-Dönüşüm / E-Fatura yapılandırması (görüntüle + düzenle) */}
        <CompanyEInvoiceCard
          data={{
            id: company.id,
            isEDonusumEnabled: company.isEDonusumEnabled,
            eDonusumIntegrator: company.eDonusumIntegrator,
            eDonusumProvider: company.eDonusumProvider,
            eDonusumApiUsername: company.eDonusumApiUsername,
            hasEDonusumPassword: Boolean(company.eDonusumApiPassword),
            eDonusumApiUrl: company.eDonusumApiUrl,
            eDonusumAlias: company.eDonusumAlias,
            eDonusumTenantVkn: company.eDonusumTenantVkn,
            eFaturaPrefix: company.eFaturaPrefix,
            eArchivePrefix: company.eArchivePrefix,
            invoiceSeriesPrefix: company.invoiceSeriesPrefix,
            eDonusumConnectorGuid: company.eDonusumConnectorGuid,
            eDonusumPkAlias: company.eDonusumPkAlias,
            eDonusumGbAlias: company.eDonusumGbAlias,
            eDonusumLastTestedAt: company.eDonusumLastTestedAt?.toISOString() ?? null,
            eDonusumLastTestSuccess: company.eDonusumLastTestSuccess,
            lastEFaturaInvoiceNo: lastEFaturaNo,
            lastEArchiveInvoiceNo: lastEArchiveNo,
            lastSeriInvoiceNo: lastSeriNo,
          }}
        />
      </div>
    </div>
  )
}
