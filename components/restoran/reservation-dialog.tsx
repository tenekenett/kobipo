"use client"

// Rezervasyon paneli — günün rezervasyon listesi + ekleme/düzenleme formu.
//
// Ayrı bir sayfa DEĞİL, salon planının üstünde bir diyalog: rezervasyon alan
// kişi zaten plana bakıyor ("bu saatte hangi masa boş?"). Ayrı sayfaya
// gitmek o bağlamı kaybettirirdi.

import { useMemo, useState } from "react"
import { CalendarClock, Loader2, Phone, Plus, Trash2, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"
import { WriteAction } from "@/components/dashboard/write-guard"
import { useReservations, type PlanTable, type Reservation } from "@/lib/swr/use-restoran"
import {
  DEFAULT_DURATION_MIN,
  RESERVATION_STATUS_LABEL,
} from "@/lib/restoran/reservation-constants"
import { cn } from "@/lib/utils"

const NO_TABLE = "__NONE__"

/** `datetime-local` yerel saat bekler; `toISOString()` UTC'ye kaydırır. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Bir sonraki yarım saat — form açılınca makul bir saat dolu gelsin. */
function nextHalfHour(): Date {
  const d = new Date()
  d.setSeconds(0, 0)
  d.setMinutes(d.getMinutes() > 30 ? 60 : 30)
  return d
}

const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })

type Form = {
  id?: string
  guestName: string
  phone: string
  guestCount: string
  reservedAt: string
  durationMin: string
  tableId: string
  note: string
}

const emptyForm = (tableId?: string | null): Form => ({
  guestName: "",
  phone: "",
  guestCount: "",
  reservedAt: toLocalInput(nextHalfHour()),
  durationMin: String(DEFAULT_DURATION_MIN),
  tableId: tableId ?? NO_TABLE,
  note: "",
})

interface ReservationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string
  tables: PlanTable[]
  /** Panel kapanınca plan tazelensin: rezerve masa rengi hemen değişsin. */
  onChanged: () => void
  /** Panel belirli bir masa için açıldıysa form o masayla gelir. */
  initialTableId?: string | null
}

export function ReservationDialog({
  open,
  onOpenChange,
  companyId,
  tables,
  onChanged,
  initialTableId,
}: ReservationDialogProps) {
  const { toast } = useToast()
  const { reservations, isLoading, mutate } = useReservations(open ? companyId : null)
  const [form, setForm] = useState<Form | null>(null)
  const [saving, setSaving] = useState(false)

  const upcoming = useMemo(
    () => reservations.filter((r) => r.status === "PENDING"),
    [reservations],
  )
  const past = useMemo(() => reservations.filter((r) => r.status !== "PENDING"), [reservations])

  const save = async () => {
    if (!form) return
    if (!form.guestName.trim()) {
      toast({ title: "İsim zorunlu", variant: "destructive" })
      return
    }
    setSaving(true)
    try {
      const payload = {
        companyId,
        guestName: form.guestName.trim(),
        phone: form.phone.trim() || null,
        guestCount: form.guestCount ? Number(form.guestCount) : null,
        reservedAt: new Date(form.reservedAt).toISOString(),
        durationMin: Number(form.durationMin) || DEFAULT_DURATION_MIN,
        tableId: form.tableId === NO_TABLE ? null : form.tableId,
        note: form.note.trim() || null,
      }
      const res = await fetch(
        form.id ? `/api/restoran/rezervasyonlar/${form.id}` : "/api/restoran/rezervasyonlar",
        {
          method: form.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || "Kaydedilemedi")
      setForm(null)
      void mutate()
      onChanged()
      toast({ title: form.id ? "Rezervasyon güncellendi" : "Rezervasyon alındı" })
    } catch (e: any) {
      toast({ title: "Kaydedilemedi", description: e.message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const setStatus = async (r: Reservation, status: "NOSHOW" | "CANCELLED") => {
    try {
      const res = await fetch(`/api/restoran/rezervasyonlar/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, status }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Güncellenemedi")
      void mutate()
      onChanged()
    } catch (e: any) {
      toast({ title: "Güncellenemedi", description: e.message, variant: "destructive" })
    }
  }

  const remove = async (r: Reservation) => {
    try {
      const res = await fetch(
        `/api/restoran/rezervasyonlar/${r.id}?companyId=${companyId}`,
        { method: "DELETE" },
      )
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Silinemedi")
      void mutate()
      onChanged()
    } catch (e: any) {
      toast({ title: "Silinemedi", description: e.message, variant: "destructive" })
    }
  }

  const row = (r: Reservation) => (
    <div
      key={r.id}
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border/70 px-3 py-2 text-sm"
    >
      <span className="w-12 shrink-0 font-bold tabular-nums">{timeLabel(r.reservedAt)}</span>
      <span className="min-w-0 flex-1 truncate font-medium">{r.guestName}</span>
      {r.guestCount ? (
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Users className="h-3 w-3" />
          {r.guestCount}
        </span>
      ) : null}
      <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
        {r.tableName ?? "Masasız"}
      </span>
      {r.phone && (
        <a
          href={`tel:${r.phone}`}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:underline"
        >
          <Phone className="h-3 w-3" />
          {r.phone}
        </a>
      )}
      {r.status !== "PENDING" && (
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-xs font-semibold",
            r.status === "SEATED"
              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
              : "bg-muted text-muted-foreground",
          )}
        >
          {RESERVATION_STATUS_LABEL[r.status]}
        </span>
      )}
      {r.status === "PENDING" && (
        <WriteAction>
          <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() =>
              setForm({
                id: r.id,
                guestName: r.guestName,
                phone: r.phone ?? "",
                guestCount: r.guestCount != null ? String(r.guestCount) : "",
                reservedAt: toLocalInput(new Date(r.reservedAt)),
                durationMin: String(r.durationMin),
                tableId: r.tableId ?? NO_TABLE,
                note: r.note ?? "",
              })
            }
          >
            Düzenle
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => void setStatus(r, "NOSHOW")}
          >
            Gelmedi
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-red-600 dark:text-red-400"
            onClick={() => void remove(r)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          </div>
        </WriteAction>
      )}
    </div>
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setForm(null)
        onOpenChange(o)
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5" />
            Rezervasyonlar
          </DialogTitle>
          <DialogDescription>
            Bugünün rezervasyonları. Masa seçmek zorunlu değil — saati ve kişiyi alıp masayı
            sonra atayabilirsiniz.
          </DialogDescription>
        </DialogHeader>

        {form ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Misafir adı</Label>
                <Input
                  autoFocus
                  value={form.guestName}
                  onChange={(e) => setForm({ ...form, guestName: e.target.value })}
                  placeholder="Ahmet Bey"
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label>Telefon</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="05xx xxx xx xx"
                  className="mt-1.5"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label>Tarih / saat</Label>
                <Input
                  type="datetime-local"
                  value={form.reservedAt}
                  onChange={(e) => setForm({ ...form, reservedAt: e.target.value })}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label>Süre (dk)</Label>
                <Input
                  type="number"
                  min={15}
                  max={480}
                  step={15}
                  value={form.durationMin}
                  onChange={(e) => setForm({ ...form, durationMin: e.target.value })}
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label>Kişi</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.guestCount}
                  onChange={(e) => setForm({ ...form, guestCount: e.target.value })}
                  placeholder="4"
                  className="mt-1.5"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Masa</Label>
                <Select
                  value={form.tableId}
                  onValueChange={(v) => setForm({ ...form, tableId: v })}
                >
                  <SelectTrigger className="mt-1.5">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_TABLE}>Masa seçilmedi</SelectItem>
                    {tables.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                        {t.capacity ? ` · ${t.capacity} kişi` : ""}
                        {t.areaName ? ` · ${t.areaName}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Not</Label>
                <Input
                  value={form.note}
                  onChange={(e) => setForm({ ...form, note: e.target.value })}
                  placeholder="Doğum günü, pasta hazır"
                  className="mt-1.5"
                />
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setForm(null)} disabled={saving}>
                Vazgeç
              </Button>
              <Button onClick={save} disabled={saving}>
                {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                {form.id ? "Güncelle" : "Rezervasyonu al"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <WriteAction>
              <Button size="sm" onClick={() => setForm(emptyForm(initialTableId))}>
                <Plus className="mr-1.5 h-4 w-4" />
                Yeni rezervasyon
              </Button>
            </WriteAction>

            {isLoading && reservations.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Yükleniyor…</p>
            ) : reservations.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Bugün için rezervasyon yok.
              </p>
            ) : (
              <div className="space-y-3">
                {upcoming.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">
                      Bekleyen ({upcoming.length})
                    </p>
                    {upcoming.map(row)}
                  </div>
                )}
                {past.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold uppercase text-muted-foreground">
                      Kapanan ({past.length})
                    </p>
                    {past.map(row)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
