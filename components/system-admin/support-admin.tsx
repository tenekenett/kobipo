"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Building2, Loader2, RefreshCw, Send, ShieldCheck } from "lucide-react"

type TicketMessage = {
  id: string
  body: string
  isAdmin: boolean
  createdAt: string
}

type Ticket = {
  id: string
  subject: string
  message: string
  status: string
  accessConsent?: boolean
  createdAt: string
  updatedAt: string
  company?: { id: string; name: string } | null
  createdBy?: { id: string; name: string | null; email: string | null } | null
  messages?: TicketMessage[]
}

const STATUS_META: Record<string, { label: string; className: string }> = {
  OPEN: { label: "Açık", className: "bg-amber-500/15 text-amber-300" },
  ANSWERED: { label: "Yanıtlandı", className: "bg-blue-500/15 text-blue-300" },
  CLOSED: { label: "Kapalı", className: "bg-slate-600/30 text-slate-300" },
}

const FILTERS = [
  { value: "", label: "Tümü" },
  { value: "OPEN", label: "Açık" },
  { value: "ANSWERED", label: "Yanıtlandı" },
  { value: "CLOSED", label: "Kapalı" },
]

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" })

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.OPEN
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${meta.className}`}>
      {meta.label}
    </span>
  )
}

export function SupportAdmin() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState("")
  const [selected, setSelected] = useState<Ticket | null>(null)
  const [replyBody, setReplyBody] = useState("")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchTickets = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/support${statusFilter ? `?status=${statusFilter}` : ""}`, {
        cache: "no-store",
      })
      if (!res.ok) throw new Error("Talepler alınamadı")
      setTickets(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : "Talepler alınamadı")
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => {
    fetchTickets()
  }, [fetchTickets])

  const openTicket = async (t: Ticket) => {
    setSelected(t)
    setReplyBody("")
    try {
      const res = await fetch(`/api/admin/support/${t.id}`, { cache: "no-store" })
      if (res.ok) setSelected(await res.json())
    } catch {
      /* mevcut veriyle göster */
    }
  }

  const refreshSelected = async (id: string) => {
    const res = await fetch(`/api/admin/support/${id}`, { cache: "no-store" })
    if (res.ok) setSelected(await res.json())
    fetchTickets()
  }

  const sendReply = async () => {
    if (!selected || !replyBody.trim()) return
    setSending(true)
    try {
      const res = await fetch(`/api/admin/support/${selected.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: replyBody }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || "Yanıt gönderilemedi")
      }
      setReplyBody("")
      await refreshSelected(selected.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Yanıt gönderilemedi")
    } finally {
      setSending(false)
    }
  }

  const changeStatus = async (status: string) => {
    if (!selected) return
    try {
      const res = await fetch(`/api/admin/support/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      })
      if (res.ok) await refreshSelected(selected.id)
    } catch {
      /* yoksay */
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
      {/* Liste */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-white">Talepler</h2>
          <button
            type="button"
            onClick={fetchTickets}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Yenile
          </button>
        </div>

        <div className="mb-3 flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStatusFilter(f.value)}
              className={`rounded-full px-2.5 py-1 text-xs ${
                statusFilter === f.value
                  ? "bg-orange-500 text-white"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {error && <div className="mb-3 rounded-lg bg-red-500/10 p-2 text-xs text-red-300">{error}</div>}

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Yükleniyor…
          </div>
        ) : tickets.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">Talep yok</p>
        ) : (
          <div className="max-h-[65vh] space-y-1.5 overflow-y-auto">
            {tickets.map((t) => {
              const last = t.messages && t.messages.length > 0 ? t.messages[t.messages.length - 1] : null
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => openTicket(t)}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    selected?.id === t.id
                      ? "border-orange-500/60 bg-slate-800"
                      : "border-slate-800 bg-slate-900 hover:bg-slate-800/60"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium text-white">{t.subject}</p>
                    <StatusBadge status={t.status} />
                  </div>
                  <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-slate-400">
                    {t.company?.name || "—"}
                    {t.accessConsent && (
                      <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-emerald-500/15 px-1 text-[10px] font-semibold text-emerald-300">
                        <ShieldCheck className="h-3 w-3" />
                        izinli
                      </span>
                    )}
                  </p>
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
                    {last?.isAdmin === false && (
                      <span className="rounded bg-amber-500/15 px-1 text-amber-300">yanıt bekliyor</span>
                    )}
                    {fmtDate(t.updatedAt)}
                  </p>
                </button>
              )
            })}
          </div>
        )}
      </section>

      {/* Detay */}
      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
        {!selected ? (
          <div className="flex h-full min-h-[300px] items-center justify-center text-sm text-slate-500">
            Soldan bir talep seçin
          </div>
        ) : (
          <div className="flex h-full flex-col">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-lg font-semibold text-white">{selected.subject}</h2>
                  <StatusBadge status={selected.status} />
                </div>
                <p className="mt-0.5 text-xs text-slate-400">
                  {selected.company?.id ? (
                    <Link
                      href={`/system-admin/companies/${selected.company.id}`}
                      className="inline-flex items-center gap-1 font-medium text-orange-300 hover:text-orange-200 hover:underline"
                      title="Firma detayına git"
                    >
                      <Building2 className="h-3.5 w-3.5" />
                      {selected.company.name}
                    </Link>
                  ) : (
                    "—"
                  )}{" "}
                  · {selected.createdBy?.name || selected.createdBy?.email || "Bilinmeyen kullanıcı"}
                </p>
                <div className="mt-2">
                  {selected.accessConsent ? (
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/15 px-2 py-1 text-xs font-semibold text-emerald-300">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      Kullanıcı hesap erişim/değişiklik izni verdi
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-slate-400">
                      Hesap erişim izni verilmedi — yalnızca yönlendirme yapın
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-1.5">
                {selected.company?.id && (
                  <Link
                    href={`/system-admin/companies/${selected.company.id}`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
                  >
                    <Building2 className="h-3.5 w-3.5" />
                    Firma Detayı
                  </Link>
                )}
                {selected.status !== "CLOSED" ? (
                  <button
                    type="button"
                    onClick={() => changeStatus("CLOSED")}
                    className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
                  >
                    Kapat
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => changeStatus("OPEN")}
                    className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
                  >
                    Yeniden Aç
                  </button>
                )}
              </div>
            </div>

            <div className="my-3 max-h-[50vh] flex-1 space-y-3 overflow-y-auto">
              {/* Açılış mesajı (kullanıcı) */}
              <Bubble
                admin={false}
                label={selected.createdBy?.name || selected.createdBy?.email || "Kullanıcı"}
                date={selected.createdAt}
                body={selected.message}
              />
              {(selected.messages ?? []).map((m) => (
                <Bubble
                  key={m.id}
                  admin={m.isAdmin}
                  label={m.isAdmin ? "Destek (Siz)" : selected.createdBy?.name || "Kullanıcı"}
                  date={m.createdAt}
                  body={m.body}
                />
              ))}
            </div>

            <div className="space-y-2 border-t border-slate-800 pt-3">
              <textarea
                rows={3}
                placeholder="Yanıtınızı yazın…"
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                disabled={sending}
                className="w-full rounded-lg bg-slate-800 px-3 py-2 text-sm text-white placeholder:text-slate-500"
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={sendReply}
                  disabled={sending || !replyBody.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Yanıtla
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function Bubble({
  admin,
  label,
  date,
  body,
}: {
  admin: boolean
  label: string
  date: string
  body: string
}) {
  return (
    <div className={`flex ${admin ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
          admin ? "bg-orange-500/20 text-orange-50" : "bg-slate-800 text-slate-100"
        }`}
      >
        <div className={`mb-0.5 text-[10px] font-semibold ${admin ? "text-orange-200/80" : "text-slate-400"}`}>
          {label} · {fmtDate(date)}
        </div>
        <div className="whitespace-pre-wrap break-words">{body}</div>
      </div>
    </div>
  )
}
