"use client"

import { useCallback, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"
import { LifeBuoy, Loader2, MessageSquare, Send } from "lucide-react"

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
  createdAt: string
  updatedAt: string
  messages?: TicketMessage[]
}

const STATUS_META: Record<string, { label: string; className: string }> = {
  OPEN: { label: "Açık", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
  ANSWERED: { label: "Yanıtlandı", className: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" },
  CLOSED: { label: "Kapalı", className: "bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300" },
}

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.OPEN
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${meta.className}`}>
      {meta.label}
    </span>
  )
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" })

export default function DestekPage() {
  const companyId = useSearchParams().get("company")
  const { toast } = useToast()

  const [subject, setSubject] = useState("")
  const [message, setMessage] = useState("")
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [selected, setSelected] = useState<Ticket | null>(null)
  const [replyBody, setReplyBody] = useState("")
  const [replying, setReplying] = useState(false)

  const fetchTickets = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/support/tickets?companyId=${companyId}`, { cache: "no-store" })
      if (res.ok) setTickets(await res.json())
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    fetchTickets()
  }, [fetchTickets])

  const createTicket = async () => {
    if (!companyId) return
    if (!subject.trim() || !message.trim()) {
      toast({ title: "Eksik bilgi", description: "Konu ve mesaj zorunlu.", variant: "destructive" })
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch("/api/support/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, subject, message }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Talep oluşturulamadı")
      toast({ title: "Talep oluşturuldu", description: "Destek ekibimiz en kısa sürede dönüş yapacak." })
      setSubject("")
      setMessage("")
      fetchTickets()
    } catch (e) {
      toast({
        title: "Hata",
        description: e instanceof Error ? e.message : "Talep oluşturulamadı",
        variant: "destructive",
      })
    } finally {
      setSubmitting(false)
    }
  }

  const openTicket = async (t: Ticket) => {
    setSelected(t)
    setReplyBody("")
    // En güncel konuşmayı çek.
    try {
      const res = await fetch(`/api/support/tickets/${t.id}`, { cache: "no-store" })
      if (res.ok) setSelected(await res.json())
    } catch {
      /* mevcut veriyle göster */
    }
  }

  const sendReply = async () => {
    if (!selected || !replyBody.trim()) return
    setReplying(true)
    try {
      const res = await fetch(`/api/support/tickets/${selected.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: replyBody }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Yanıt gönderilemedi")
      setReplyBody("")
      // Konuşmayı ve listeyi tazele.
      const refreshed = await fetch(`/api/support/tickets/${selected.id}`, { cache: "no-store" })
      if (refreshed.ok) setSelected(await refreshed.json())
      fetchTickets()
    } catch (e) {
      toast({
        title: "Hata",
        description: e instanceof Error ? e.message : "Yanıt gönderilemedi",
        variant: "destructive",
      })
    } finally {
      setReplying(false)
    }
  }

  if (!companyId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Destek</CardTitle>
          <CardDescription>Lütfen bir firma seçin</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-kobipo-blue/10 text-kobipo-blue dark:bg-primary/15 dark:text-primary">
          <LifeBuoy className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold text-kobipo-navy dark:text-foreground">Destek</h1>
          <p className="text-sm text-muted-foreground">
            Bir sorun mu var? Talep oluşturun, ekibimiz buradan yanıtlasın.
          </p>
        </div>
      </div>

      {/* Yeni talep */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Yeni Talep</CardTitle>
          <CardDescription>Konuyu ve sorununuzu mümkün olduğunca açık yazın.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="Konu (ör. E-fatura gönderilemiyor)"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={submitting}
          />
          <Textarea
            placeholder="Sorununuzu detaylı anlatın…"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            disabled={submitting}
          />
          <div className="flex justify-end">
            <Button onClick={createTicket} disabled={submitting || !subject.trim() || !message.trim()}>
              {submitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Gönderiliyor…
                </>
              ) : (
                <>
                  <Send className="mr-2 h-4 w-4" />
                  Talep Gönder
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Talep listesi */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Taleplerim</CardTitle>
          <CardDescription>
            {loading ? "Yükleniyor…" : `${tickets.length} talep`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Yükleniyor…
            </div>
          ) : tickets.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              <MessageSquare className="mx-auto mb-2 h-6 w-6 opacity-50" />
              Henüz destek talebiniz yok.
            </div>
          ) : (
            <div className="divide-y rounded-lg border">
              {tickets.map((t) => {
                const last = t.messages && t.messages.length > 0 ? t.messages[t.messages.length - 1] : null
                const preview = last?.body ?? t.message
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => openTicket(t)}
                    className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium">{t.subject}</p>
                        {last?.isAdmin && (
                          <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                            Yeni yanıt
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{preview}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">{fmtDate(t.updatedAt)}</p>
                    </div>
                    <StatusBadge status={t.status} />
                  </button>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Konuşma */}
      <Dialog open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 pr-6">
              <span className="truncate">{selected?.subject}</span>
              {selected && <StatusBadge status={selected.status} />}
            </DialogTitle>
          </DialogHeader>

          <div className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
            {selected && (
              <>
                {/* Açılış mesajı (kullanıcı) */}
                <Bubble mine label="Siz" date={selected.createdAt} body={selected.message} />
                {(selected.messages ?? []).map((m) => (
                  <Bubble
                    key={m.id}
                    mine={!m.isAdmin}
                    label={m.isAdmin ? "Destek Ekibi" : "Siz"}
                    date={m.createdAt}
                    body={m.body}
                  />
                ))}
              </>
            )}
          </div>

          {selected && selected.status !== "CLOSED" ? (
            <div className="space-y-2 border-t pt-3">
              <Textarea
                placeholder="Yanıtınızı yazın…"
                value={replyBody}
                onChange={(e) => setReplyBody(e.target.value)}
                rows={3}
                disabled={replying}
              />
              <div className="flex justify-end">
                <Button onClick={sendReply} disabled={replying || !replyBody.trim()}>
                  {replying ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Gönderiliyor…
                    </>
                  ) : (
                    <>
                      <Send className="mr-2 h-4 w-4" />
                      Yanıtla
                    </>
                  )}
                </Button>
              </div>
            </div>
          ) : selected ? (
            <p className="border-t pt-3 text-center text-xs text-muted-foreground">
              Bu talep kapatıldı. Yeni bir konu için talep oluşturabilirsiniz.
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Bubble({
  mine,
  label,
  date,
  body,
}: {
  mine: boolean
  label: string
  date: string
  body: string
}) {
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
          mine
            ? "bg-kobipo-blue text-white dark:bg-primary dark:text-primary-foreground"
            : "bg-muted text-foreground"
        }`}
      >
        <div className={`mb-0.5 text-[10px] font-semibold ${mine ? "text-white/70" : "text-muted-foreground"}`}>
          {label} · {fmtDate(date)}
        </div>
        <div className="whitespace-pre-wrap break-words">{body}</div>
      </div>
    </div>
  )
}
