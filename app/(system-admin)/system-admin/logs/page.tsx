import Link from "next/link"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { trFoldAnyLike, trLikePattern } from "@/lib/db/tr-search"
import { PAGE_FORBIDDEN_ACTION, PERMISSION_LOG_ACTIONS } from "@/lib/audit/permission-log"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { FileText, AlertTriangle, Info, AlertCircle, Search } from "lucide-react"

export const dynamic = "force-dynamic"

const LIMIT = 200

/**
 * Süzgeçler. Yetki değişiklikleri (üyelik ekleme/çıkarma, rol ve sayfa izni, özel rol) ve
 * sayfa kapısı retleri 2026-10-05'ten beri yazılıyor (lib/audit/permission-log.server.ts):
 * "bu çalışanın yetkisi ne zaman, kim tarafından değişti" sorusu e-posta ya da firma adıyla
 * aranarak cevaplanır.
 */
const FILTERS: Array<{ key: string; label: string; actions: string[] | null }> = [
  { key: "", label: "Tümü", actions: null },
  { key: "yetki", label: "Yetki değişiklikleri", actions: PERMISSION_LOG_ACTIONS },
  { key: "red", label: "Yetki reddi", actions: [PAGE_FORBIDDEN_ACTION] },
]

function filterHref(key: string, q: string): string {
  const params = new URLSearchParams()
  if (key) params.set("tur", key)
  if (q) params.set("q", q)
  const query = params.toString()
  return query ? `/system-admin/logs?${query}` : "/system-admin/logs"
}

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const q = typeof params.q === "string" ? params.q.trim() : ""
  const filter = FILTERS.find((f) => f.key === params.tur) ?? FILTERS[0]
  const pattern = trLikePattern(q)

  // Türkçe duyarsız arama (CLAUDE.md): Prisma `where`ine katlama sokulamadığı için önce ham
  // SQL ile id ön süzgeci. Kaydın kullanıcısı (değişikliği yapan ya da reddedilen) da aranır.
  let ids: string[] | null = null
  if (pattern) {
    const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT l.id FROM system_logs l
      LEFT JOIN users u ON u.id = l."userId"
      WHERE ${trFoldAnyLike(["l.details", "l.action", 'l."entityId"', "u.email", "u.name"], pattern)}
      ${filter.actions ? Prisma.sql`AND l.action IN (${Prisma.join(filter.actions)})` : Prisma.empty}
      ORDER BY l."createdAt" DESC
      LIMIT ${LIMIT}
    `)
    ids = rows.map((r) => r.id)
  }

  const logs = await prisma.systemLog.findMany({
    where: {
      ...(ids ? { id: { in: ids } } : {}),
      ...(filter.actions ? { action: { in: filter.actions } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: LIMIT,
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

      {/* Süzgeç + arama */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Link
              key={f.key || "tumu"}
              href={filterHref(f.key, q)}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
                f.key === filter.key
                  ? "bg-purple-500/20 text-purple-200"
                  : "bg-slate-800/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
        <form action="/system-admin/logs" className="flex w-full gap-2 md:w-auto">
          {filter.key && <input type="hidden" name="tur" value={filter.key} />}
          <input
            name="q"
            defaultValue={q}
            placeholder="E-posta, firma adı, eylem…"
            className="h-9 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-slate-200 placeholder:text-slate-500 focus:border-purple-500 focus:outline-none md:w-72"
          />
          <button
            type="submit"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-800 px-3 text-sm text-slate-200 hover:bg-slate-700"
          >
            <Search className="h-4 w-4" />
            Ara
          </button>
        </form>
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
            {logs.length === LIMIT ? `En yeni ${LIMIT} kayıt` : `${logs.length} kayıt`}
            {q ? ` · “${q}” araması` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              {q || filter.key ? "Bu süzgeçle eşleşen kayıt yok" : "Henüz log kaydı yok"}
            </div>
          ) : (
            <div className="space-y-2">
              {logs.map((log) => {
                // İlk satır özet, kalanı ayrıntı (yetki kayıtları önce/sonra listesini taşır).
                const [headline, ...rest] = (log.details ?? "").split("\n")
                return (
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
                      {headline && (
                        <p className="text-sm text-slate-400 mt-1 break-words">
                          {headline}
                        </p>
                      )}
                      {rest.length > 0 && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-300">
                            Ayrıntı
                          </summary>
                          <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-slate-400">
                            {rest.join("\n")}
                          </pre>
                        </details>
                      )}
                      <div className="flex items-center gap-4 mt-2 text-xs text-slate-600">
                        {log.user && (
                          <span>{log.user.name || log.user.email}</span>
                        )}
                        {log.ipAddress && <span>IP: {log.ipAddress}</span>}
                      </div>
                    </div>
                    <span className="text-xs text-slate-600 shrink-0">
                      {new Date(log.createdAt).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
