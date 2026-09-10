"use client"

/**
 * Devam özetinden bordroya aktarım.
 *
 * Para tutarı BURADA hesaplanır, uçta değil — `bordro-aktar-dialog.tsx` ile aynı
 * gerekçe: günlük yevmiye böleni ve "raporlu günü kes/kesme" kararı işletmeye ve
 * sözleşmeye göre değişir. Sunucuda sabitlenselerdi kullanıcı görmeden bordroya
 * girerlerdi; burada her ikisi de ekranda duruyor ve değiştirilebiliyor.
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
import { MONTHLY_PAYROLL_DAYS, dailyRate } from "@/lib/personel/bordro-hesap"
import { DEVAM_STATUS, deductionDaysFor, type DevamStatus } from "@/lib/personel/devam"

export type DevamBordroRow = {
  employeeId: string
  name: string
  grossSalary: number | null
  counts: Record<DevamStatus, number>
  payroll: { id: string; status: string; bonus: number; otherDeduction: number } | null
}

export function DevamBordroDialog({
  row,
  periodLabel,
  isSaving,
  onClose,
  onApply,
}: {
  row: DevamBordroRow | null
  periodLabel: string
  isSaving: boolean
  onClose: () => void
  onApply: (input: { employeeId: string; bonus: number; otherDeduction: number }) => void
}) {
  const [yevmiye, setYevmiye] = useState("0")
  const [bonus, setBonus] = useState("0")
  const [countUnpaid, setCountUnpaid] = useState(true)
  const [countSick, setCountSick] = useState(false)

  useEffect(() => {
    if (!row) return
    // Yevmiye `dailyRate` ile hesaplanır, elle bölünmez: özet tablosu da onu
    // kullanıyor ve iki yerde ayrı yuvarlama, aynı personel için tabloda
    // 6.502,50 ₺ pencerede 6.502,47 ₺ gösteriyordu.
    setYevmiye(dailyRate(row.grossSalary).toFixed(2))
    // Mevcut bordronun primi KORUNUR: aktarım prim alanının da üzerine yazıyor,
    // sıfırla gelseydi elle girilmiş bir prim sessizce silinirdi.
    setBonus(String(row.payroll?.bonus ?? 0))
    setCountUnpaid(true)
    setCountSick(false)
  }, [row])

  const calc = useMemo(() => {
    if (!row) return null
    const days = deductionDaysFor(row.counts, { countSick, countUnpaid })
    const rate = Number(yevmiye) || 0
    return { days, deduction: round2(days * rate), bonus: round2(Number(bonus) || 0) }
  }, [row, yevmiye, bonus, countSick, countUnpaid])

  if (!row || !calc) return null

  const paid = row.payroll?.status === "PAID"
  const gunler: [DevamStatus, number][] = (Object.keys(row.counts) as DevamStatus[])
    .map((key) => [key, row.counts[key]] as [DevamStatus, number])
    .filter(([, count]) => count > 0)

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
            Bu personelin brüt maaşı tanımlı değil; kesinti hesaplanamaz. Personel
            kartından maaşı girip tekrar deneyin.
          </p>
        ) : paid ? (
          <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-400">
            Bu dönemin bordrosu ödenmiş durumda; düzenlenemez.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-border/70 bg-muted/20 p-3 text-sm">
              {gunler.map(([status, count]) => (
                <div key={status} className="flex justify-between">
                  <span className="text-muted-foreground">{DEVAM_STATUS[status].label}</span>
                  <span className="font-semibold tabular-nums">{count} gün</span>
                </div>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="devam-yevmiye">Günlük yevmiye (₺)</Label>
              <Input
                id="devam-yevmiye"
                type="number"
                step="0.01"
                value={yevmiye}
                onChange={(e) => setYevmiye(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                Brüt / {MONTHLY_PAYROLL_DAYS} gün (SGK gün sayısı)
              </p>
            </div>

            <div className="space-y-1.5">
              <span className="text-sm font-medium">Kesilecek günler</span>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" className="h-3.5 w-3.5 accent-kobipo-blue" checked disabled />
                Devamsızlık ({row.counts.ABSENT} gün) ve yarım günler — her zaman kesilir
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-kobipo-blue"
                  checked={countUnpaid}
                  onChange={(e) => setCountUnpaid(e.target.checked)}
                />
                Ücretsiz izin ({row.counts.UNPAID_LEAVE} gün)
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-kobipo-blue"
                  checked={countSick}
                  onChange={(e) => setCountSick(e.target.checked)}
                />
                Raporlu günler ({row.counts.SICK} gün) — SGK ödeneği ayrıdır
              </label>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="devam-prim">Prim / ek ödeme (₺)</Label>
              <Input
                id="devam-prim"
                type="number"
                step="0.01"
                value={bonus}
                onChange={(e) => setBonus(e.target.value)}
              />
            </div>

            <div className="space-y-1 rounded-lg border border-border/70 p-3 text-sm">
              <div className="flex justify-between">
                <span>Prim / ek ödeme</span>
                <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  +{money(calc.bonus)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Gün kesintisi ({calc.days} gün)</span>
                <span className="font-semibold tabular-nums text-red-600 dark:text-red-400">
                  −{money(calc.deduction)}
                </span>
              </div>
              {row.payroll ? (
                <p className="pt-1 text-[11px] text-muted-foreground">
                  Bu dönemde bordro var; prim ve kesinti alanları ÜZERİNE YAZILIR (şu an{" "}
                  {money(row.payroll.bonus)} / {money(row.payroll.otherDeduction)}).
                </p>
              ) : (
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
