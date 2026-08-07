"use client"

/**
 * Puantajdan bordroya aktarım.
 *
 * Para tutarı BURADA hesaplanır, puantaj ucunda değil: fazla mesai çarpanı ve
 * günlük yevmiye böleni işletmeye göre değişen, mevzuata bağlı seçimlerdir.
 * Sunucuda sabitlenselerdi kullanıcı görmeden bordroya girerlerdi — burada her
 * biri ekranda duruyor ve elle değiştirilebiliyor.
 *
 * Sonuç ÖNERİDİR: pencere yalnız `bonus` ve `otherDeduction` alanlarını doldurur,
 * bordroyu onaylamaz ya da ödemez.
 */

import { useEffect, useMemo, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2 } from "lucide-react"
import { money } from "@/lib/format"
import { durationLabel } from "@/lib/personel/vardiya"
// Saatlik ücretin böleni puantaj ekranında da kullanılıyor: burada ayrı bir
// sabit dursaydı aynı personel iki ekranda iki farklı saat ücretine sahip olurdu.
import { MONTHLY_WORK_HOURS } from "@/lib/personel/maliyet"

/** Fazla mesai saat ücreti normalin 1,5 katıdır (İş Kanunu 41. md). */
const DEFAULT_OVERTIME_MULTIPLIER = 1.5

/** Günlük yevmiye = brüt / 30 (SGK gün sayısı). */
const MONTHLY_DAYS = 30

export type PuantajRow = {
  employeeId: string
  name: string
  grossSalary: number | null
  overtimeMinutes: number
  absentCount: number
  lateMinutes: number
  payroll: { id: string; status: string; bonus: number; otherDeduction: number } | null
}

export function BordroAktarDialog({
  row,
  periodLabel,
  isSaving,
  onClose,
  onApply,
}: {
  row: PuantajRow | null
  periodLabel: string
  isSaving: boolean
  onClose: () => void
  onApply: (input: { employeeId: string; bonus: number; otherDeduction: number }) => void
}) {
  const [hourlyRate, setHourlyRate] = useState("0")
  const [multiplier, setMultiplier] = useState(String(DEFAULT_OVERTIME_MULTIPLIER))
  const [dailyRate, setDailyRate] = useState("0")
  const [countAbsence, setCountAbsence] = useState(true)

  useEffect(() => {
    if (!row) return
    const gross = row.grossSalary ?? 0
    setHourlyRate(gross > 0 ? (gross / MONTHLY_WORK_HOURS).toFixed(2) : "0")
    setDailyRate(gross > 0 ? (gross / MONTHLY_DAYS).toFixed(2) : "0")
    setMultiplier(String(DEFAULT_OVERTIME_MULTIPLIER))
    setCountAbsence(true)
  }, [row])

  const calc = useMemo(() => {
    if (!row) return null
    const hourly = Number(hourlyRate) || 0
    const mult = Number(multiplier) || 0
    const daily = Number(dailyRate) || 0
    const bonus = (row.overtimeMinutes / 60) * hourly * mult
    const deduction = countAbsence ? row.absentCount * daily : 0
    return { bonus: round2(bonus), deduction: round2(deduction) }
  }, [row, hourlyRate, multiplier, dailyRate, countAbsence])

  if (!row || !calc) return null

  const paid = row.payroll?.status === "PAID"

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Bordroya aktar — {row.name} · {periodLabel}
          </DialogTitle>
        </DialogHeader>

        {row.grossSalary == null || row.grossSalary <= 0 ? (
          <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            Bu personelin brüt maaşı tanımlı değil; öneri hesaplanamaz. Personel kartından
            maaşı girip tekrar deneyin.
          </p>
        ) : paid ? (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-400">
            Bu dönemin bordrosu ödenmiş durumda; düzenlenemez.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-border/70 bg-muted/20 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Fazla mesai</span>
                <span className="font-semibold tabular-nums">
                  {durationLabel(row.overtimeMinutes)}
                </span>
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-muted-foreground">Devamsızlık</span>
                <span className="font-semibold tabular-nums">{row.absentCount} gün</span>
              </div>
              {row.lateMinutes > 0 && (
                <div className="mt-1 flex justify-between">
                  <span className="text-muted-foreground">Toplam gecikme</span>
                  {/* Gecikme tutara ÇEVRİLMİYOR: ücretten kesilmesi ayrı bir hukuki
                      karardır, burada yalnız bilgi olarak duruyor. */}
                  <span className="tabular-nums">{durationLabel(row.lateMinutes)}</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="bordro-saat">Saat ücreti (₺)</Label>
                <Input
                  id="bordro-saat"
                  type="number"
                  step="0.01"
                  value={hourlyRate}
                  onChange={(e) => setHourlyRate(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Brüt / {MONTHLY_WORK_HOURS} sa (haftalık 45 sa)
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bordro-carpan">Mesai çarpanı</Label>
                <Input
                  id="bordro-carpan"
                  type="number"
                  step="0.1"
                  value={multiplier}
                  onChange={(e) => setMultiplier(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">Yasal alt sınır 1,5</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="bordro-yevmiye">Günlük yevmiye (₺)</Label>
              <Input
                id="bordro-yevmiye"
                type="number"
                step="0.01"
                value={dailyRate}
                onChange={(e) => setDailyRate(e.target.value)}
                disabled={!countAbsence}
              />
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-kobipo-blue"
                  checked={countAbsence}
                  onChange={(e) => setCountAbsence(e.target.checked)}
                />
                Devamsızlığı ücretten düş ({row.absentCount} gün)
              </label>
            </div>

            <div className="space-y-1 rounded-lg border border-border/70 p-3 text-sm">
              <div className="flex justify-between">
                <span>Prim / fazla mesai</span>
                <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  +{money(calc.bonus)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Devamsızlık kesintisi</span>
                <span className="font-semibold tabular-nums text-red-600 dark:text-red-400">
                  −{money(calc.deduction)}
                </span>
              </div>
              {row.payroll && (
                <p className="pt-1 text-[11px] text-muted-foreground">
                  Bu dönemde bordro var; prim ve kesinti alanları ÜZERİNE YAZILIR
                  (şu an {money(row.payroll.bonus)} / {money(row.payroll.otherDeduction)}).
                </p>
              )}
              {!row.payroll && (
                <p className="pt-1 text-[11px] text-muted-foreground">
                  Bu dönemde bordro yok; brüt maaş üzerinden taslak bordro oluşturulur.
                </p>
              )}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Vazgeç
          </Button>
          <Button
            onClick={() =>
              onApply({
                employeeId: row.employeeId,
                bonus: calc.bonus,
                otherDeduction: calc.deduction,
              })
            }
            disabled={isSaving || paid || !row.grossSalary}
          >
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Bordroya yaz
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

const round2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100
