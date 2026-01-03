import { prisma } from "@/lib/db/prisma"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { FileText, AlertTriangle, Info, AlertCircle } from "lucide-react"

export const dynamic = "force-dynamic"

export default async function LogsPage() {
  const logs = await prisma.systemLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      user: {
        select: { name: true, email: true }
      }
    }
  })

  const stats = {
    total: logs.length,
    info: logs.filter(l => l.level === "INFO").length,
    warn: logs.filter(l => l.level === "WARN").length,
    error: logs.filter(l => l.level === "ERROR").length,
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <FileText className="h-8 w-8 text-purple-400" />
          Sistem Logları
        </h1>
        <p className="text-slate-400 mt-1">
          Sistem geneli aktivite kayıtları
        </p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-slate-900/50 border-slate-800">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Toplam Log</p>
                <p className="text-3xl font-bold text-white">{stats.total}</p>
              </div>
              <FileText className="h-8 w-8 text-slate-500" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/50 border-slate-800">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Bilgi</p>
                <p className="text-3xl font-bold text-blue-400">{stats.info}</p>
              </div>
              <Info className="h-8 w-8 text-blue-400/50" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/50 border-slate-800">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Uyarı</p>
                <p className="text-3xl font-bold text-yellow-400">{stats.warn}</p>
              </div>
              <AlertTriangle className="h-8 w-8 text-yellow-400/50" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900/50 border-slate-800">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">Hata</p>
                <p className="text-3xl font-bold text-red-400">{stats.error}</p>
              </div>
              <AlertCircle className="h-8 w-8 text-red-400/50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Logs Table */}
      <Card className="bg-slate-900/50 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white">Aktivite Kayıtları</CardTitle>
          <CardDescription className="text-slate-500">
            Son 100 sistem aktivitesi
          </CardDescription>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              Henüz log kaydı yok
            </div>
          ) : (
            <div className="space-y-2">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start gap-4 p-4 rounded-lg bg-slate-800/50 hover:bg-slate-800 transition-colors"
                >
                  <span className={`px-2 py-0.5 rounded text-xs font-medium shrink-0 ${
                    log.level === "ERROR" 
                      ? "bg-red-500/20 text-red-400"
                      : log.level === "WARN"
                      ? "bg-yellow-500/20 text-yellow-400"
                      : "bg-blue-500/20 text-blue-400"
                  }`}>
                    {log.level}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium text-white">{log.action}</span>
                      {log.entity && (
                        <span className="text-slate-500">• {log.entity}</span>
                      )}
                    </div>
                    {log.details && (
                      <p className="text-sm text-slate-400 mt-1 truncate">
                        {log.details}
                      </p>
                    )}
                    <div className="flex items-center gap-4 mt-2 text-xs text-slate-600">
                      {log.user && (
                        <span>{log.user.name || log.user.email}</span>
                      )}
                      {log.ipAddress && <span>IP: {log.ipAddress}</span>}
                    </div>
                  </div>
                  <span className="text-xs text-slate-600 shrink-0">
                    {new Date(log.createdAt).toLocaleString("tr-TR")}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

