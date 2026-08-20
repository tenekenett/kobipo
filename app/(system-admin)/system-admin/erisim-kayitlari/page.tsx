import { prisma } from "@/lib/db/prisma"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Fingerprint, LogIn, ShieldAlert, UserPlus } from "lucide-react"
import { AccessLogTable } from "@/components/system-admin/access-log-table"

export const dynamic = "force-dynamic"

/**
 * Erişim (trafik) kayıtları — "kim, ne zaman, hangi IP'den".
 *
 * Sistem Logları'ndan AYRI bir ekran: orası yönetici işlemlerinin karışık günlüğü,
 * burası hukuki bir defter. Bir uyuşmazlıkta bakılacak yer burasıdır, o yüzden filtre
 * ve arama IP/e-posta üzerinden çalışır.
 *
 * İlk 500 kayıt çekilir; daha eskisi arama ile değil, veritabanından sorgulanır
 * (defterin tamamını tarayıcıya indirmek ne hızlı ne de gerekli).
 */
export default async function AccessLogPage() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

  const [logs, totals] = await Promise.all([
    prisma.accessLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 500,
      select: {
        id: true,
        action: true,
        reason: true,
        email: true,
        ip: true,
        port: true,
        forwardedFor: true,
        userAgent: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.accessLog.groupBy({
      by: ["action"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
  ])

  const count = (action: string) => totals.find((t) => t.action === action)?._count._all ?? 0

  const stats = [
    { label: "Giriş (30 gün)", value: count("LOGIN"), icon: LogIn, color: "text-emerald-400" },
    {
      label: "Başarısız Deneme",
      value: count("LOGIN_FAILED"),
      icon: ShieldAlert,
      color: "text-red-400",
    },
    { label: "Yeni Kayıt", value: count("SIGNUP"), icon: UserPlus, color: "text-blue-400" },
    {
      label: "Şifre Sıfırlama",
      value: count("PASSWORD_RESET") + count("PASSWORD_RESET_REQUEST"),
      icon: Fingerprint,
      color: "text-amber-400",
    },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-3 text-3xl font-bold text-white">
          <Fingerprint className="h-8 w-8 text-cyan-400" />
          Erişim Kayıtları
        </h1>
        <p className="mt-1 text-slate-400">
          Giriş, çıkış, kayıt ve şifre sıfırlama olayları — IP, varsa kaynak portu ve tarayıcı
          bilgisiyle
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="border-slate-800 bg-slate-900/50">
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

      <Card className="border-slate-800 bg-slate-900/50">
        <CardHeader>
          <CardTitle className="text-white">Son 500 Kayıt</CardTitle>
          <CardDescription className="text-slate-500">
            E-posta, IP veya kullanıcı adıyla arayın. Kaynak portu yalnız vekil sunucu
            ilettiğinde dolar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AccessLogTable
            logs={logs.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() }))}
          />
        </CardContent>
      </Card>
    </div>
  )
}
