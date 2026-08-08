"use client"

/**
 * Vardiya şablonları — "Sabah 09:00–17:00" gibi tekrar eden kalıplar.
 *
 * Liste + satır içi ekleme tek pencerede: şablon tanımlamak toplu doldurmanın
 * ön adımı, iki ayrı ekrana bölünürse kullanıcı doldurma penceresini kapatıp
 * geri gelmek zorunda kalıyor.
 *
 * DÜZENLEME de aynı formda: şablon düzeltmenin tek yolu sil-yeniden oluştur
 * olduğu sürece, silme pasife aldığı için (`isActive:false`) o şablondan üretilmiş
 * geçmiş vardiyalar barlarının adını ve rengini koruyordu ama saat düzeltmek her
 * seferinde yeni bir şablon bırakıyordu. Aynı kaydı güncellemek geçmişi de düzeltir.
 */

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { DAY_MINUTES, durationLabel, hhmmToMinute, minuteToHHMM, netMinutes } from "@/lib/personel/vardiya"
import {
  SHIFT_COLOR_DOT,
  SHIFT_COLOR_TOKENS,
  type ShiftColor,
} from "@/components/personel/shift-colors"

export type ShiftTemplate = {
  id: string
  name: string
  startMinute: number
  endMinute: number
  breakMinutes: number
  color: string | null
}

type TemplateInput = {
  name: string
  startMinute: number
  endMinute: number
  breakMinutes: number
  color: ShiftColor
}

export function SablonDialog({
  open,
  templates,
  isSaving,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
}: {
  open: boolean
  templates: ShiftTemplate[]
  isSaving: boolean
  onClose: () => void
  onCreate: (t: TemplateInput) => void
  onUpdate: (id: string, t: TemplateInput) => void
  onDelete: (id: string) => void
}) {
  const [name, setName] = useState("")
  const [start, setStart] = useState("09:00")
  const [end, setEnd] = useState("17:00")
  const [nextDay, setNextDay] = useState(false)
  const [brk, setBrk] = useState("60")
  const [color, setColor] = useState<ShiftColor>("blue")
  const [error, setError] = useState<string | null>(null)
  /** Düzenlenen şablonun id'si; null ise form yeni kayıt açar. */
  const [editingId, setEditingId] = useState<string | null>(null)

  if (!open) return null

  function reset() {
    setEditingId(null)
    setName("")
    setStart("09:00")
    setEnd("17:00")
    setNextDay(false)
    setBrk("60")
    setColor("blue")
    setError(null)
  }

  function startEdit(t: ShiftTemplate) {
    setEditingId(t.id)
    setName(t.name)
    setStart(minuteToHHMM(t.startMinute))
    // Gece şablonunda bitiş 1440'ı aşar; `type="time"` bunu gösteremediği için
    // gün bilgisi ayrı anahtarda tutulur (vardiya penceresiyle aynı desen).
    setEnd(minuteToHHMM(t.endMinute))
    setNextDay(t.endMinute > DAY_MINUTES)
    setBrk(String(t.breakMinutes))
    setColor(((t.color as ShiftColor) ?? "blue") || "blue")
    setError(null)
  }

  function submit() {
    const s = hhmmToMinute(start)
    const rawEnd = hhmmToMinute(end)
    const e = rawEnd == null ? null : rawEnd + (nextDay ? DAY_MINUTES : 0)
    if (!name.trim()) {
      setError("Şablon adı girin")
      return
    }
    if (s == null || e == null || e <= s) {
      setError("Bitiş başlangıçtan sonra olmalı — gece vardiyasında 'ertesi gün' işaretleyin")
      return
    }
    const input: TemplateInput = {
      name: name.trim(),
      startMinute: s,
      endMinute: e,
      breakMinutes: Math.max(0, Math.round(Number(brk) || 0)),
      color,
    }
    setError(null)
    if (editingId) onUpdate(editingId, input)
    else onCreate(input)
    reset()
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Vardiya şablonları</DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          {templates.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              Henüz şablon yok. Aşağıdan ekleyin.
            </p>
          ) : (
            templates.map((t) => (
              <div
                key={t.id}
                className={cn(
                  "flex items-center gap-3 rounded-lg border px-3 py-2",
                  editingId === t.id
                    ? "border-kobipo-blue bg-kobipo-blue/5 dark:border-primary dark:bg-primary/10"
                    : "border-border/70",
                )}
              >
                <span
                  className={cn(
                    "h-3 w-3 shrink-0 rounded-full",
                    SHIFT_COLOR_DOT[(t.color as ShiftColor) ?? "blue"] ?? SHIFT_COLOR_DOT.blue,
                  )}
                />
                <span className="flex-1 truncate text-sm font-medium">{t.name}</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {minuteToHHMM(t.startMinute)}–{minuteToHHMM(t.endMinute)}
                  {t.endMinute > DAY_MINUTES && <span className="ml-1 text-amber-600">+1</span>}
                  {" · "}
                  {durationLabel(netMinutes(t.startMinute, t.endMinute, t.breakMinutes))}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => startEdit(t)}
                  disabled={isSaving}
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  title="Şablonu düzenle"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    if (editingId === t.id) reset()
                    onDelete(t.id)
                  }}
                  disabled={isSaving}
                  className="h-8 w-8 text-muted-foreground hover:text-red-600"
                  title="Şablonu kaldır"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>

        <div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-3">
          <p className="text-sm font-semibold">
            {editingId ? "Şablonu düzenle" : "Yeni şablon"}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sablon-ad">Ad</Label>
              <Input
                id="sablon-ad"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Sabah"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sablon-mola">Mola (dk)</Label>
              <Input
                id="sablon-mola"
                type="number"
                min={0}
                step={5}
                value={brk}
                onChange={(e) => setBrk(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sablon-basla">Başlangıç</Label>
              <Input
                id="sablon-basla"
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sablon-bitis">Bitiş</Label>
              <Input
                id="sablon-bitis"
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
              />
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="h-4 w-4 accent-kobipo-blue"
              checked={nextDay}
              onChange={(e) => setNextDay(e.target.checked)}
            />
            Ertesi gün biter (gece vardiyası)
          </label>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Renk</span>
            {SHIFT_COLOR_TOKENS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={cn(
                  "h-6 w-6 rounded-full ring-offset-2 ring-offset-background transition-all",
                  SHIFT_COLOR_DOT[c],
                  color === c && "ring-2 ring-foreground",
                )}
                title={c}
              />
            ))}
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          {/* Düzenlemede saat değişikliği GEÇMİŞ vardiyaları oynatmaz: bar kendi
              kaydettiği saati taşır, şablon yalnız ad ve renk için bağlıdır. */}
          {editingId && (
            <p className="text-xs text-muted-foreground">
              Değişiklik yalnız bundan sonra açılacak vardiyaları etkiler; mevcut barların
              saati değişmez, adı ve rengi güncellenir.
            </p>
          )}

          <div className="flex gap-2">
            <Button onClick={submit} disabled={isSaving} size="sm">
              {isSaving ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : editingId ? (
                <Pencil className="mr-1 h-4 w-4" />
              ) : (
                <Plus className="mr-1 h-4 w-4" />
              )}
              {editingId ? "Kaydet" : "Şablon ekle"}
            </Button>
            {editingId && (
              <Button variant="ghost" size="sm" onClick={reset} disabled={isSaving}>
                Vazgeç
              </Button>
            )}
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={onClose}>
            Kapat
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
