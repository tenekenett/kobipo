"use client"

import { useMemo, useState } from "react"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Search } from "lucide-react"

export type AccessLogRow = {
  id: string
  action: string
  reason: string | null
  email: string | null
  ip: string | null
  port: number | null
  forwardedFor: string | null
  userAgent: string | null
  /** ISO — sunucudan string olarak gelir (Date client component'e geçirilemiyor). */
  createdAt: string
  user: { id: string; name: string | null; email: string } | null
}

const ACTION_LABELS: Record<string, string> = {
  LOGIN: "Giriş",
  LOGIN_FAILED: "Başarısız giriş",
  LOGOUT: "Çıkış",
  SIGNUP: "Kayıt",
  PASSWORD_RESET_REQUEST: "Şifre sıfırlama talebi",
  PASSWORD_RESET: "Şifre değiştirildi",
}

const ACTION_COLORS: Record<string, string> = {
  LOGIN: "bg-emerald-500/20 text-emerald-400",
  LOGIN_FAILED: "bg-red-500/20 text-red-400",
  LOGOUT: "bg-slate-500/20 text-slate-300",
  SIGNUP: "bg-blue-500/20 text-blue-400",
  PASSWORD_RESET_REQUEST: "bg-amber-500/20 text-amber-400",
  PASSWORD_RESET: "bg-amber-500/20 text-amber-400",
}

/** "Mozilla/5.0 (X11; Linux …) Chrome/141…" → "Chrome · Linux". Tam metin title'da durur. */
function shortAgent(ua: string | null): string {
  if (!ua) return "-"
  const browser =
    /Edg\//.test(ua) ? "Edge"
    : /OPR\//.test(ua) ? "Opera"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : /Firefox\//.test(ua) ? "Firefox"
    : "Bilinmeyen"
  const os =
    /Android/.test(ua) ? "Android"
    : /iPhone|iPad/.test(ua) ? "iOS"
    : /Windows/.test(ua) ? "Windows"
    : /Mac OS X/.test(ua) ? "macOS"
    : /Linux/.test(ua) ? "Linux"
    : ""
  return os ? `${browser} · ${os}` : browser
}

export function AccessLogTable({ logs }: { logs: AccessLogRow[] }) {
  const [query, setQuery] = useState("")
  const [action, setAction] = useState<string>("")

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase("tr-TR")
    return logs.filter((log) => {
      if (action && log.action !== action) return false
      if (!q) return true
      // IP araması hukuki sorgunun ana ekseni; e-posta ve ad da aranır.
      return [log.email, log.ip, log.user?.email, log.user?.name, log.forwardedFor]
        .filter(Boolean)
        .some((field) => field!.toLocaleLowerCase("tr-TR").includes(q))
    })
  }, [logs, query, action])

  const actions = useMemo(() => Array.from(new Set(logs.map((l) => l.action))).sort(), [logs])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input
            placeholder="E-posta, IP veya kullanıcı ara..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="border-slate-700 bg-slate-800/50 pl-10 text-white placeholder:text-slate-500"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setAction("")}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              action === "" ? "bg-cyan-500/20 text-cyan-300" : "bg-slate-800 text-slate-400"
            }`}
          >
            Tümü
          </button>
          {actions.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setAction(a === action ? "" : a)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                a === action ? "bg-cyan-500/20 text-cyan-300" : "bg-slate-800 text-slate-400"
              }`}
            >
              {ACTION_LABELS[a] ?? a}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <Table>
          <TableHeader>
            <TableRow className="border-slate-800 hover:bg-slate-800/50">
              <TableHead className="text-slate-400">Tarih</TableHead>
              <TableHead className="text-slate-400">Olay</TableHead>
              <TableHead className="text-slate-400">Kullanıcı</TableHead>
              <TableHead className="text-slate-400">IP</TableHead>
              <TableHead className="text-slate-400">Port</TableHead>
              <TableHead className="text-slate-400">Tarayıcı</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-slate-500">
                  {logs.length === 0 ? "Henüz erişim kaydı yok" : "Arama sonucu bulunamadı"}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((log) => (
                <TableRow key={log.id} className="border-slate-800 hover:bg-slate-800/50">
                  <TableCell className="whitespace-nowrap text-sm text-slate-400">
                    {new Date(log.createdAt).toLocaleString("tr-TR")}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${
                        ACTION_COLORS[log.action] ?? "bg-slate-700 text-slate-300"
                      }`}
                    >
                      {ACTION_LABELS[log.action] ?? log.action}
                    </span>
                    {log.reason && (
                      <p className="mt-0.5 text-xs text-slate-500">{log.reason}</p>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-slate-300">
                    {log.user ? (
                      <span>
                        {log.user.name || log.user.email}
                        {log.user.name && (
                          <span className="block text-xs text-slate-500">{log.user.email}</span>
                        )}
                      </span>
                    ) : (
                      // Kullanıcı yoksa (bulunamayan e-postayla deneme) girilen adres tek izdir.
                      <span className="text-slate-400">{log.email || "-"}</span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-sm text-slate-300">
                    {log.ip || "-"}
                    {log.forwardedFor && log.forwardedFor !== log.ip && (
                      <span
                        className="block text-xs text-slate-500"
                        title={`x-forwarded-for: ${log.forwardedFor}`}
                      >
                        zincir: {log.forwardedFor.length > 28 ? `${log.forwardedFor.slice(0, 28)}…` : log.forwardedFor}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-sm text-slate-300">
                    {log.port ?? <span className="text-slate-600">-</span>}
                  </TableCell>
                  <TableCell className="text-sm text-slate-400" title={log.userAgent ?? undefined}>
                    {shortAgent(log.userAgent)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-sm text-slate-500">{filtered.length} kayıt gösteriliyor</p>
    </div>
  )
}
