import { prisma } from "@/lib/db/prisma"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Building2 } from "lucide-react"
import { CompanyTable } from "@/components/system-admin/company-table"
import { CreateCompanyButton } from "@/components/system-admin/create-company-button"

export const dynamic = "force-dynamic"

export default async function CompaniesPage() {
  const companies = await prisma.company.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      users: {
        include: {
          user: {
            select: { id: true, name: true, email: true }
          }
        }
      },
      _count: {
        select: {
          customers: true,
          suppliers: true,
          products: true,
          invoices: true,
        }
      }
    }
  })

  const stats = {
    total: companies.length,
    active: companies.filter(c => c.isActive).length,
    inactive: companies.filter(c => !c.isActive).length,
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Building2 className="h-8 w-8 text-blue-400" />
            Firma Yönetimi
          </h1>
          <p className="text-slate-400 mt-1">
            Sistemdeki tüm firmaları yönetin
          </p>
        </div>
        <CreateCompanyButton />
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-slate-900/50 border-slate-800">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Toplam Firma</p>
                <p className="text-3xl font-bold text-white">{stats.total}</p>
              </div>
              <Building2 className="h-10 w-10 text-blue-400/50" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/50 border-slate-800">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Aktif Firma</p>
                <p className="text-3xl font-bold text-green-400">{stats.active}</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center">
                <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/50 border-slate-800">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Pasif Firma</p>
                <p className="text-3xl font-bold text-red-400">{stats.inactive}</p>
              </div>
              <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center">
                <div className="w-3 h-3 rounded-full bg-red-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Companies Table */}
      <Card className="bg-slate-900/50 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white">Firma Listesi</CardTitle>
          <CardDescription className="text-slate-500">
            Tüm kayıtlı firmalar ve detayları
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CompanyTable companies={companies} />
        </CardContent>
      </Card>
    </div>
  )
}

