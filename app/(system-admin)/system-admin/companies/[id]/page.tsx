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
} from "lucide-react"
import { Role } from "@prisma/client"

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
            <div className="flex items-center gap-3 pt-1">
              <span className="text-slate-500">
                <FileText className="h-4 w-4" />
              </span>
              <div>
                <p className="text-xs text-slate-500">e-Dönüşüm</p>
                <p className="text-sm text-slate-200">
                  {company.isEDonusumEnabled ? "Aktif" : "Pasif"}
                </p>
              </div>
            </div>
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
      </div>
    </div>
  )
}
