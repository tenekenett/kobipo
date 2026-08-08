"use client"

/**
 * Vardiya düzenleme penceresi — ızgarada bara tıklayınca açılır.
 *
 * Sürükleme kaba ayar (15 dk ızgara), bu pencere ince ayar: dakikası dakikasına
 * saat, mola ve not. İkisi aynı veriye yazar; bu yüzden saat alanları da dakika
 * cinsine çevrilir (lib/personel/vardiya.ts).
 *
 * FİİLÎ GİRİŞ/ÇIKIŞ YOK. Takvim bir PLANDIR: personelin planına uyduğu varsayılır,
 * yalnız GELMEDİĞİ ayrıca işaretlenir. Damga alanları (giriş/çıkış saati, "Şimdi"
 * düğmesi, gecikme/mesai sapması) bilinçli olarak kaldırıldı — işletme fiilî
 * saat takibi yapmıyor ve doldurulmayan alanlar puantajı "eksik" gösteriyordu.
 * Veritabanındaki `actualStart/actualEnd` alanları duruyor; ileride istenirse
 * özellik yalnız arayüz tarafında geri açılır.
 */

import { useEffect, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Loader2, Trash2 } from "lucide-react"
import {
  DAY_MINUTES,
  MIN_SHIFT_MINUTES,
  durationLabel,
  hhmmToMinute,
  minuteToHHMM,
  netMinutes,
} from "@/lib/personel/vardiya"

export type ShiftDraft = {
  id?: string
  employeeId: string
  employeeName: string
  /** Hangi güne yazılacak. Hafta görünümünde tıklanan hücrenin günü aktif günden farklı olabilir. */
  workDate?: string
  start: number
  end: number
  /** Personel bu vardiyaya gelmedi mi — planın tek istisnası. */
  absent?: boolean
  breakMinutes: number
  note: string
  /** Denetim izi — pencerenin altında "kim, ne zaman" satırı olarak görünür. */
  updatedAt?: string | null
  updatedByName?: string | null
}

export function VardiyaDialog({
  draft,
  employees,
  isSaving,
  onClose,
  onSave,
  onDelete,
}: {
  draft: ShiftDraft | null
  /**
   * Personel seçimi YALNIZ yeni vardiyada gösterilir.
   *
   * Izgarada bar zaten bir satıra (kişiye) çizilir, orada seçim gereksiz. Ama
   * mobil listede satır kavramı yok: "Vardiya ekle" düğmesi kimin adına
   * eklendiğini soramadığı sürece hep ilk personele yazıyordu ve düzeltmenin
   * yolu da yoktu. Mevcut bir vardiyanın personelini değiştirmek ise taşımadır
   * ve ızgarada sürükleyerek yapılır.
   */
  employees: { id: string; name: string }[]
  isSaving: boolean
  onClose: () => void
  onSave: (next: ShiftDraft) => void
  onDelete: (id: string) => void
}) {
  const [start, setStart] = useState("09:00")
  const [end, setEnd] = useState("17:00")
  // Bitiş 1440'ı aştığında `type="time"` onu gösteremez (00:00'a sarar). Ertesi
  // gün bilgisi bu yüzden ayrı bir anahtar: 22:00–02:00 vardiyası ekranda
  // "22:00 → 02:00 (ertesi gün)" diye okunur, veri tarafında 1320–1560 kalır.
  const [nextDay, setNextDay] = useState(false)
  const [breakMinutes, setBreakMinutes] = useState("0")
  const [note, setNote] = useState("")
  const [absent, setAbsent] = useState(false)
  const [employeeId, setEmployeeId] = useState("")
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!draft) return
    setEmployeeId(draft.employeeId)
    setStart(minuteToHHMM(draft.start))
    setEnd(minuteToHHMM(draft.end))
    setNextDay(draft.end > DAY_MINUTES)
    setBreakMinutes(String(draft.breakMinutes))
    setNote(draft.note || "")
    setAbsent(draft.absent === true)
    setError(null)
  }, [draft])

  if (!draft) return null
  // `draft` bir parametre olduğu için daraltma iç fonksiyonlara taşınmıyor; sabite alıyoruz.
  const current = draft

  const s = hhmmToMinute(start)
  const rawEnd = hhmmToMinute(end)
  const e = rawEnd == null ? null : rawEnd + (nextDay ? DAY_MINUTES : 0)
  const brk = Math.max(0, Math.round(Number(breakMinutes) || 0))
  const valid = s != null && e != null && e - s >= MIN_SHIFT_MINUTES

  function submit() {
    if (s == null || e == null) {
      setError("Saatler SS:DD biçiminde olmalı")
      return
    }
    if (e - s < MIN_SHIFT_MINUTES) {
      setError(
        e <= s
          ? "Bitiş başlangıçtan sonra olmalı — gece vardiyasında 'Ertesi gün' anahtarını açın"
          : `Vardiya en az ${MIN_SHIFT_MINUTES} dakika olmalı`,
      )
      return
    }
    if (brk >= e - s) {
      setError("Mola vardiya süresinden uzun olamaz")
      return
    }
    onSave({
      ...current,
      // Personel yalnız yeni kayıtta değişebilir; düzenlemede taslaktaki kalır.
      employeeId: current.id ? current.employeeId : employeeId || current.employeeId,
      employeeName:
        employees.find((emp) => emp.id === employeeId)?.name ?? current.employeeName,
      start: s,
      end: e,
      breakMinutes: brk,
      note: note.trim(),
      absent,
    })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {draft.id ? "Vardiyayı düzenle" : "Yeni vardiya"} — {draft.employeeName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!draft.id && employees.length > 1 && (
            <div className="space-y-1.5">
              <Label htmlFor="vardiya-personel">Personel</Label>
              <select
                id="vardiya-personel"
                value={employeeId}
                onChange={(ev) => setEmployeeId(ev.target.value)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="vardiya-basla">Başlangıç</Label>
              <Input
                id="vardiya-basla"
                type="time"
                value={start}
                onChange={(ev) => setStart(ev.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="vardiya-bitis">Bitiş</Label>
              <Input
                id="vardiya-bitis"
                type="time"
                value={end}
                onChange={(ev) => setEnd(ev.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/70 px-3 py-2">
            <div>
              <p className="text-sm font-medium">Ertesi gün biter</p>
              <p className="text-xs text-muted-foreground">Gece vardiyası (ör. 22:00 → 02:00)</p>
            </div>
            <Switch checked={nextDay} onCheckedChange={setNextDay} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="vardiya-mola">Mola (dk)</Label>
              <Input
                id="vardiya-mola"
                type="number"
                min={0}
                step={5}
                value={breakMinutes}
                onChange={(ev) => setBreakMinutes(ev.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Net çalışma</Label>
              <div className="flex h-10 items-center rounded-md border border-border/70 bg-muted/40 px-3 text-sm font-semibold tabular-nums">
                {valid ? durationLabel(netMinutes(s!, e!, brk)) : "—"}
              </div>
            </div>
          </div>

          {/* Devamsızlık — planın TEK istisnası.
              Personelin planına uyduğu varsayılır; bu kutu yalnız gelmediğinde
              işaretlenir ve vardiya takvimde üzeri çizili görünür. */}
          {draft.id && (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border/70 bg-muted/20 p-3">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-kobipo-blue"
                checked={absent}
                onChange={(ev) => setAbsent(ev.target.checked)}
              />
              <span>
                <span className="block text-sm font-medium">Gelmedi</span>
                <span className="block text-xs text-muted-foreground">
                  Bu vardiya çalışılmadı olarak işaretlenir; puantajda devamsızlık sayılır.
                </span>
              </span>
            </label>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="vardiya-not">Not</Label>
            <Input
              id="vardiya-not"
              value={note}
              onChange={(ev) => setNote(ev.target.value)}
              placeholder="Opsiyonel — ör. açılış sorumlusu"
            />
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          {/* Denetim izi. Bordro itirazında ("bu vardiyayı ben böyle yazmadım")
              cevap verilebilsin diye; kiosktan atılan damga da burada ayrışır. */}
          {draft.id && draft.updatedAt && (
            <p className="text-[11px] text-muted-foreground">
              Son değişiklik: {draft.updatedByName || "bilinmiyor"} ·{" "}
              {new Date(draft.updatedAt).toLocaleString("tr-TR", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 pt-2">
          {draft.id ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onDelete(draft.id!)}
              disabled={isSaving}
              className="text-red-600 hover:text-red-700 dark:text-red-400"
            >
              <Trash2 className="mr-1 h-4 w-4" /> Sil
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={isSaving}>
              Vazgeç
            </Button>
            <Button onClick={submit} disabled={isSaving}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Kaydet
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
