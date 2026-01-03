import { prisma } from "@/lib/db/prisma"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Building2, Users, Activity, AlertTriangle, TrendingUp, Clock } from "lucide-react"
import Link from "next/link"

export const dynamic = "force-dynamic"

export default async function SystemAdminDashboard() {
  // İstatistikleri çek
  const [
    totalCompanies,
    activeCompanies,
    totalUsers,
    recentUsers,
    recentCompanies,
    recentLogs,
  ] = await Promise.all([
    prisma.company.count(),
    prisma.company.count({ where: { isActive: true } }),
    prisma.user.count(),
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, name: true, email: true, createdAt: true, isSuperAdmin: true }
    }),
    prisma.company.findMany({
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, name: true, city: true, isActive: true, createdAt: true }
    }),
    prisma.systemLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { user: { select: { name: true, email: true } } }
    }),
  ])

  const inactiveCompanies = totalCompanies - activeCompanies

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white">Sistem Yönetimi</h1>
        <p className="text-slate-400 mt-1">
          Platform geneli istatistikler ve yönetim araçları
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-slate-900/50 border-slate-800 hover:border-slate-700 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">
              Toplam Firma
            </CardTitle>
            <Building2 className="h-5 w-5 text-blue-400" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">{totalCompanies}</div>
            <p className="text-xs text-slate-500 mt-1">
              {activeCompanies} aktif, {inactiveCompanies} pasif
            </p>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/50 border-slate-800 hover:border-slate-700 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">
              Toplam Kullanıcı
            </CardTitle>
            <Users className="h-5 w-5 text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">{totalUsers}</div>
            <p className="text-xs text-slate-500 mt-1">
              Kayıtlı kullanıcı sayısı
            </p>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/50 border-slate-800 hover:border-slate-700 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">
              Sistem Durumu
            </CardTitle>
            <Activity className="h-5 w-5 text-green-400" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-400">Aktif</div>
            <p className="text-xs text-slate-500 mt-1">
              Tüm servisler çalışıyor
            </p>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/50 border-slate-800 hover:border-slate-700 transition-colors">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">
              Uyarılar
            </CardTitle>
            <AlertTriangle className="h-5 w-5 text-yellow-400" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">0</div>
            <p className="text-xs text-slate-500 mt-1">
              Bekleyen uyarı yok
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Content Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent Companies */}
        <Card className="bg-slate-900/50 border-slate-800">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-white flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-blue-400" />
                  Son Eklenen Firmalar
                </CardTitle>
                <CardDescription className="text-slate-500">
                  Son kayıt olan firmalar
                </CardDescription>
              </div>
              <Link 
                href="/system-admin/companies"
                className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
              >
                Tümünü gör →
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {recentCompanies.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                Henüz firma kaydı yok
              </div>
            ) : (
              <div className="space-y-3">
                {recentCompanies.map((company) => (
                  <div
                    key={company.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-slate-800/50 hover:bg-slate-800 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                        <Building2 className="h-5 w-5 text-blue-400" />
                      </div>
                      <div>
                        <p className="font-medium text-white">{company.name}</p>
                        <p className="text-xs text-slate-500">{company.city || "Konum belirtilmemiş"}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        company.isActive 
                          ? "bg-green-500/20 text-green-400" 
                          : "bg-red-500/20 text-red-400"
                      }`}>
                        {company.isActive ? "Aktif" : "Pasif"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Users */}
        <Card className="bg-slate-900/50 border-slate-800">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-white flex items-center gap-2">
                  <Users className="h-5 w-5 text-emerald-400" />
                  Son Kayıt Olan Kullanıcılar
                </CardTitle>
                <CardDescription className="text-slate-500">
                  Yeni kayıt olan kullanıcılar
                </CardDescription>
              </div>
              <Link 
                href="/system-admin/users"
                className="text-sm text-emerald-400 hover:text-emerald-300 transition-colors"
              >
                Tümünü gör →
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {recentUsers.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                Henüz kullanıcı kaydı yok
              </div>
            ) : (
              <div className="space-y-3">
                {recentUsers.map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-slate-800/50 hover:bg-slate-800 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 font-medium">
                        {user.name?.charAt(0) || user.email?.charAt(0) || "?"}
                      </div>
                      <div>
                        <p className="font-medium text-white">{user.name || "İsimsiz"}</p>
                        <p className="text-xs text-slate-500">{user.email}</p>
                      </div>
                    </div>
                    {user.isSuperAdmin && (
                      <span className="text-xs px-2 py-1 rounded-full bg-red-500/20 text-red-400">
                        Super Admin
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* System Logs */}
        <Card className="bg-slate-900/50 border-slate-800 lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-white flex items-center gap-2">
                  <Clock className="h-5 w-5 text-purple-400" />
                  Son Aktiviteler
                </CardTitle>
                <CardDescription className="text-slate-500">
                  Sistem geneli son işlemler
                </CardDescription>
              </div>
              <Link 
                href="/system-admin/logs"
                className="text-sm text-purple-400 hover:text-purple-300 transition-colors"
              >
                Tüm loglar →
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {recentLogs.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                Henüz log kaydı yok
              </div>
            ) : (
              <div className="space-y-2">
                {recentLogs.map((log) => (
                  <div
                    key={log.id}
                    className="flex items-center gap-4 p-3 rounded-lg bg-slate-800/50 text-sm"
                  >
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                      log.level === "ERROR" 
                        ? "bg-red-500/20 text-red-400"
                        : log.level === "WARN"
                        ? "bg-yellow-500/20 text-yellow-400"
                        : "bg-blue-500/20 text-blue-400"
                    }`}>
                      {log.level}
                    </span>
                    <span className="text-slate-300">{log.action}</span>
                    {log.entity && (
                      <span className="text-slate-500">{log.entity}</span>
                    )}
                    <span className="flex-1 text-slate-500 truncate">
                      {log.details}
                    </span>
                    <span className="text-slate-600 text-xs">
                      {new Date(log.createdAt).toLocaleString("tr-TR")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card className="bg-slate-900/50 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-orange-400" />
            Hızlı İşlemler
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Link
              href="/system-admin/companies"
              className="flex flex-col items-center gap-2 p-4 rounded-lg bg-slate-800/50 hover:bg-slate-800 transition-colors group"
            >
              <Building2 className="h-8 w-8 text-blue-400 group-hover:scale-110 transition-transform" />
              <span className="text-sm text-slate-300">Firma Ekle</span>
            </Link>
            <Link
              href="/system-admin/users"
              className="flex flex-col items-center gap-2 p-4 rounded-lg bg-slate-800/50 hover:bg-slate-800 transition-colors group"
            >
              <Users className="h-8 w-8 text-emerald-400 group-hover:scale-110 transition-transform" />
              <span className="text-sm text-slate-300">Kullanıcı Ekle</span>
            </Link>
            <Link
              href="/system-admin/logs"
              className="flex flex-col items-center gap-2 p-4 rounded-lg bg-slate-800/50 hover:bg-slate-800 transition-colors group"
            >
              <Activity className="h-8 w-8 text-purple-400 group-hover:scale-110 transition-transform" />
              <span className="text-sm text-slate-300">Logları Görüntüle</span>
            </Link>
            <Link
              href="/system-admin/settings"
              className="flex flex-col items-center gap-2 p-4 rounded-lg bg-slate-800/50 hover:bg-slate-800 transition-colors group"
            >
              <AlertTriangle className="h-8 w-8 text-yellow-400 group-hover:scale-110 transition-transform" />
              <span className="text-sm text-slate-300">Sistem Ayarları</span>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

