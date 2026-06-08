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
} from "lucide-react"
import { Role } from "@prisma/client"
import { CompanyEInvoiceCard } from "@/components/system-admin/company-einvoice-card"
import { CompanyModulesCard } from "@/components/system-admin/company-modules-card"

export const dynamic = "force-dynamic"

const roleLabels: Record<Role, string> = {
  ADMIN: "Yönetici",
  ACCOUNTANT: "Muhasebeci",
  STOCK: "Stokçu",
  SALES: "Satış",
  VIEWER: "Görüntüleyici",
}

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

  const [byType, byStatus, amountAgg, lastInvoice, lastEFaturaNo, lastEArchiveNo, lastSeriNo] =
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
    ])

  const typeCount = (t: string) => byType.find((r) => r.invoiceType === t)?._count._all ?? 0
  const statusCount = (s: string) => byStatus.find((r) => r.status === s)?._count._all ?? 0
  const totalAmount = Number(amountAgg._sum.totalAmount ?? 0)
  const fmtTRY = (n: number) =>
    new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(n)

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

  const invoiceStatCards = [
    { label: "E-Fatura", value: typeCount("E_INVOICE"), color: "text-blue-300" },
    { label: "E-Arşiv", value: typeCount("E_ARCHIVE"), color: "text-cyan-300" },
    { label: "Taslak", value: statusCount("DRAFT"), color: "text-slate-300" },
    { label: "Gönderilmiş", value: statusCount("SENT"), color: "text-emerald-300" },
    { label: "İptal", value: statusCount("CANCELLED"), color: "text-red-300" },
  ]

  const infoRows: { icon: React.ReactNode; label: string; value: string | null }[] = [
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
      label: "Son Güncelleme",
      value: new Date(company.updatedAt).toLocaleString("tr-TR"),
    },
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
        <Card className="bg-slate-900/50 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Users className="h-5 w-5 text-emerald-400" />
              Kullanıcılar ({company.users.length})
            </CardTitle>
            <CardDescription className="text-slate-500">
              Bu firmaya bağlı kullanıcılar ve rolleri
            </CardDescription>
          </CardHeader>
          <CardContent>
            {company.users.length === 0 ? (
              <div className="text-center py-8 text-slate-500">Bağlı kullanıcı yok</div>
            ) : (
              <div className="space-y-3">
                {company.users.map((uc) => (
                  <div
                    key={uc.user.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-slate-800/50"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 shrink-0 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-medium">
                        {uc.user.name?.charAt(0) || uc.user.email.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-white truncate">
                          {uc.user.name || "İsimsiz"}
                        </p>
                        <p className="text-xs text-slate-500 truncate">{uc.user.email}</p>
                      </div>
                    </div>
                    <span className="shrink-0 text-xs px-2 py-1 rounded-full bg-slate-700/60 text-slate-300">
                      {roleLabels[uc.role]}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

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

        {/* Modül yönetimi (firma bazında aç/kapa) */}
        <CompanyModulesCard companyId={company.id} initialDisabled={company.disabledModules ?? []} />

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
