"use client"

/**
 * Vardiya düzenleme penceresi — ızgarada bara tıklayınca açılır.
 *
 * Sürükleme kaba ayar (15 dk ızgara), bu pencere ince ayar: dakikası dakikasına
 * saat, mola ve not. İkisi aynı veriye yazar; bu yüzden saat alanları da dakika
 * cinsine çevrilir (lib/personel/vardiya.ts).
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
  actualNetMinutes,
  deviationLabel,
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
  /** Fiilî giriş/çıkış — boş bırakılabilir (henüz damgalanmadı). */
  actualStart?: number | null
  actualEnd?: number | null
  absent?: boolean
  breakMinutes: number
  note: string
}

export function VardiyaDialog({
  draft,
  isSaving,
  onClose,
  onSave,
  onDelete,
  onClock,
}: {
  draft: ShiftDraft | null
  isSaving: boolean
  onClose: () => void
  onSave: (next: ShiftDraft) => void
  onDelete: (id: string) => void
  /**
   * "Şimdi" damgası — Kaydet'i BEKLEMEDEN yazar. Damga anlık bir olaydır: forma
   * yazıp kaydetmeyi unutmak, geçmişe dönük düzeltilmesi gereken bir kayıt bırakır.
   */
  onClock: (id: string, action: "in" | "out", minute: number) => void
}) {
  const [start, setStart] = useState("09:00")
  const [end, setEnd] = useState("17:00")
  // Bitiş 1440'ı aştığında `type="time"` onu gösteremez (00:00'a sarar). Ertesi
  // gün bilgisi bu yüzden ayrı bir anahtar: 22:00–02:00 vardiyası ekranda
  // "22:00 → 02:00 (ertesi gün)" diye okunur, veri tarafında 1320–1560 kalır.
  const [nextDay, setNextDay] = useState(false)
  const [breakMinutes, setBreakMinutes] = useState("0")
  const [note, setNote] = useState("")
  // Fiilî damgalar boş string ile "damgalanmadı"yı taşır: type="time" null tutamıyor.
  const [actualIn, setActualIn] = useState("")
  const [actualOut, setActualOut] = useState("")
  const [outNextDay, setOutNextDay] = useState(false)
  const [absent, setAbsent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!draft) return
    setStart(minuteToHHMM(draft.start))
    setEnd(minuteToHHMM(draft.end))
    setNextDay(draft.end > DAY_MINUTES)
    setBreakMinutes(String(draft.breakMinutes))
    setNote(draft.note || "")
    setActualIn(draft.actualStart != null ? minuteToHHMM(draft.actualStart) : "")
    setActualOut(draft.actualEnd != null ? minuteToHHMM(draft.actualEnd) : "")
    setOutNextDay((draft.actualEnd ?? 0) > DAY_MINUTES)
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

  const aIn = actualIn ? hhmmToMinute(actualIn) : null
  const rawOut = actualOut ? hhmmToMinute(actualOut) : null
  const aOut = rawOut == null ? null : rawOut + (outNextDay ? DAY_MINUTES : 0)
  // Sapma planla karşılaştırılır; plan alanları hâlâ düzenleniyor olabilir, o yüzden
  // ekrandaki (kaydedilmemiş) değerler kullanılır — pencere kendi içinde tutarlı kalsın.
  const times =
    s != null && e != null
      ? { plannedStart: s, plannedEnd: e, actualStart: aIn, actualEnd: aOut, breakMinutes: brk }
      : null
  const deviation = times ? deviationLabel(times) : null
  const actualNet = times ? actualNetMinutes(times) : null

  /** "Şimdi" damgası: saat İSTEMCİDEN okunur — sunucu üretimde UTC'de çalışıyor. */
  const nowHHMM = () => {
    const d = new Date()
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  }

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
    if ((actualIn && aIn == null) || (actualOut && aOut == null)) {
      setError("Fiilî saatler SS:DD biçiminde olmalı")
      return
    }
    if (aIn != null && aOut != null && aOut < aIn) {
      setError("Fiilî çıkış girişten önce olamaz — gece vardiyasında 'ertesi gün'ü işaretleyin")
      return
    }
    onSave({
      ...current,
      start: s,
      end: e,
      breakMinutes: brk,
      note: note.trim(),
      // Devamsızlıkta damgalar sunucuda da temizlenir; burada da göndermiyoruz ki
      // ekranda "gelmedi" yazarken saat kalmasın.
      actualStart: absent ? null : aIn,
      actualEnd: absent ? null : aOut,
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

          {/* Fiilî giriş/çıkış — plan yukarıda, gerçekleşen burada. Yalnız kayıtlı
              vardiyada anlamlı: henüz açılmamış vardiyanın damgası olmaz. */}
          {draft.id && (
            <div className="space-y-3 rounded-lg border border-border/70 bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Fiilî giriş / çıkış</p>
                <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-kobipo-blue"
                    checked={absent}
                    onChange={(ev) => setAbsent(ev.target.checked)}
                  />
                  Gelmedi
                </label>
              </div>

              {absent ? (
                <p className="text-xs text-muted-foreground">
                  Devamsızlık işaretlendi; girilen fiilî saatler silinecek.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="vardiya-fiili-giris">Giriş</Label>
                      <div className="flex gap-1">
                        <Input
                          id="vardiya-fiili-giris"
                          type="time"
                          value={actualIn}
                          onChange={(ev) => setActualIn(ev.target.value)}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="shrink-0"
                          disabled={isSaving}
                          onClick={() => {
                            const now = nowHHMM()
                            setActualIn(now)
                            onClock(current.id!, "in", hhmmToMinute(now)!)
                          }}
                        >
                          Şimdi
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="vardiya-fiili-cikis">Çıkış</Label>
                      <div className="flex gap-1">
                        <Input
                          id="vardiya-fiili-cikis"
                          type="time"
                          value={actualOut}
                          onChange={(ev) => setActualOut(ev.target.value)}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="shrink-0"
                          disabled={isSaving}
                          onClick={() => {
                            const now = nowHHMM()
                            setActualOut(now)
                            setOutNextDay(false)
                            onClock(current.id!, "out", hhmmToMinute(now)!)
                          }}
                        >
                          Şimdi
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-kobipo-blue"
                        checked={outNextDay}
                        onChange={(ev) => setOutNextDay(ev.target.checked)}
                      />
                      Çıkış ertesi gün
                    </label>
                    <div className="text-xs">
                      {actualNet != null && (
                        <span className="font-semibold tabular-nums">
                          Fiilî {durationLabel(actualNet)}
                        </span>
                      )}
                      {deviation && (
                        <span className="ml-2 text-amber-600 dark:text-amber-400">{deviation}</span>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
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
