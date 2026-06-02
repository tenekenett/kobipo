import { prisma } from "@/lib/db/prisma"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Users, Shield, UserCheck } from "lucide-react"
import { UserTable } from "@/components/system-admin/user-table"
import { CreateUserButton } from "@/components/system-admin/create-user-button"

export const dynamic = "force-dynamic"

export default async function UsersPage() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      companies: {
        include: {
          company: {
            select: { id: true, name: true, isActive: true }
          }
        }
      }
    }
  })

  const stats = {
    total: users.length,
    superAdmins: users.filter(u => u.isSuperAdmin).length,
    withCompanies: users.filter(u => u.companies.length > 0).length,
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Users className="h-8 w-8 text-emerald-400" />
            Kullanıcı Yönetimi
          </h1>
          <p className="text-slate-400 mt-1">
            Sistemdeki tüm kullanıcıları yönetin
          </p>
        </div>
        <CreateUserButton />
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-slate-900/50 border-slate-800">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Toplam Kullanıcı</p>
                <p className="text-3xl font-bold text-white">{stats.total}</p>
              </div>
              <Users className="h-10 w-10 text-emerald-400/50" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/50 border-slate-800">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Sistem Yöneticisi</p>
                <p className="text-3xl font-bold text-red-400">{stats.superAdmins}</p>
              </div>
              <Shield className="h-10 w-10 text-red-400/50" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/50 border-slate-800">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Firmaya Bağlı</p>
                <p className="text-3xl font-bold text-blue-400">{stats.withCompanies}</p>
              </div>
              <UserCheck className="h-10 w-10 text-blue-400/50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Users Table */}
      <Card className="bg-slate-900/50 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white">Kullanıcı Listesi</CardTitle>
          <CardDescription className="text-slate-500">
            Tüm kayıtlı kullanıcılar ve yetkileri
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UserTable users={users} />
        </CardContent>
      </Card>
    </div>
  )
}

