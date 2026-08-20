import { prisma } from "@/lib/db/prisma"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Users, Shield, UserCheck } from "lucide-react"
import { UserTable } from "@/components/system-admin/user-table"
import { CreateUserButton } from "@/components/system-admin/create-user-button"

export const dynamic = "force-dynamic"

export default async function UsersPage() {
  const [users, companies] = await Promise.all([
    // Alanlar TEK TEK seçilir. `include` (select'siz) tüm satırı döndürüyordu ve satırda
    // `password` HASH'i ile `twoFactorSecret` var — ikisi de RSC payload'ıyla tarayıcıya
    // iniyordu, tablo hiçbirini kullanmadığı hâlde. Firma listesinde aynı ders daha önce
    // alınmıştı (companies/page.tsx). Buraya alan eklerken aynı soruyu sorun:
    // ekranda gösterilecek mi?
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        // Kayıt formunun alanları: telefon ve "hangi firma/şahıs adına kaydoldu".
        // İkincisi Company kaydından ÖNCE alınır (bkz. User.companyDisplayName) —
        // firma hiç açılmamışsa kullanıcının ne yazdığı yalnız burada durur.
        phone: true,
        companyDisplayName: true,
        companyBranchName: true,
        // (emailVerified ÇEKİLMİYOR: uygulamada e-posta doğrulama adımı yok, alanı
        //  hiçbir kod yazmıyor — panelde göstermek olmayan bir eksiklik uydururdu.)
        twoFactorEnabled: true,
        isSuperAdmin: true,
        isBlogEditor: true,
        createdAt: true,
        updatedAt: true,
        companies: {
          select: {
            role: true,
            createdAt: true,
            company: {
              // branchName ŞART: `name` resmi ünvandır ve aynı tüzel kişinin tüm
              // şubelerinde aynıdır — onsuz listede şubeler ayırt edilemiyor.
              // Gösterim: lib/company/display-name.ts
              select: { id: true, name: true, branchName: true, isActive: true }
            }
          }
        }
      }
    }),
    prisma.company.findMany({
      // Aynı ünvanın şubeleri alt alta ve kendi içinde şube adına göre sıralı gelsin.
      orderBy: [{ name: "asc" }, { branchName: "asc" }],
      select: { id: true, name: true, branchName: true, isActive: true },
    }),
  ])

  // Her kullanıcının SON erişim olayı. Kullanıcı başına ayrı sorgu (26 kullanıcı = 26
  // sorgu) yerine tek çekimden ilk-eşleşme: liste zaten tarihe göre sıralı geliyor.
  // Not: yalnız son 2000 olay taranır — daha eskisi zaten "son giriş" değildir.
  const recentAccess = await prisma.accessLog.findMany({
    where: { userId: { not: null }, action: { in: ["LOGIN", "SIGNUP"] } },
    orderBy: { createdAt: "desc" },
    take: 2000,
    select: { userId: true, action: true, ip: true, port: true, createdAt: true },
  })
  const lastAccessByUser = new Map<string, (typeof recentAccess)[number]>()
  for (const row of recentAccess) {
    if (row.userId && !lastAccessByUser.has(row.userId)) lastAccessByUser.set(row.userId, row)
  }

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
        <CreateUserButton companies={companies} />
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
          <UserTable
            users={users.map((u) => {
              const last = lastAccessByUser.get(u.id)
              return {
                ...u,
                lastAccess: last
                  ? {
                      action: last.action,
                      ip: last.ip,
                      port: last.port,
                      at: last.createdAt.toISOString(),
                    }
                  : null,
              }
            })}
            companies={companies}
          />
        </CardContent>
      </Card>
    </div>
  )
}

