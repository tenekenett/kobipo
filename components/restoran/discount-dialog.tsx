"use client"

// Hesap iskontosu — yüzde ya da tutar, sebebiyle birlikte.
// Kararlar: docs/restoran/SATIS-EKRANI.md K3
//
// Tutar KDV DAHİL girilir: kullanıcı hesabın altındaki rakama bakıp "50 lira
// düş" der. Matrah karşılığına çevirmek sunucunun işi (lib/restoran/tickets.ts).

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { currency } from "@/lib/fis/receipt-html"
import { cn } from "@/lib/utils"

export type DiscountValue = {
  type: "PERCENT" | "AMOUNT"
  value: number
  reason: string | null
} | null

const REASONS = ["Personel", "Öğrenci", "Sadık müşteri", "Şikâyet telafisi", "Kampanya"]

/** Sık kullanılan yüzdeler — kasiyer sayı yazmadan tek dokunuşla seçsin. */
const QUICK_PERCENTS = [5, 10, 15, 20]

export function DiscountDialog({
  open,
  gross,
  current,
  onClose,
  onApply,
}: {
  open: boolean
  /** İskonto öncesi hesap toplamı (KDV dahil) — önizleme için. */
  gross: number
  current: DiscountValue
  onClose: () => void
  onApply: (value: DiscountValue) => void
}) {
  const [type, setType] = useState<"PERCENT" | "AMOUNT">(current?.type ?? "PERCENT")
  const [value, setValue] = useState(current ? String(current.value) : "")
  const [reason, setReason] = useState(current?.reason ?? "")

  const parsed = parseFloat(value.replace(",", ".")) || 0
  const discount =
    type === "PERCENT" ? gross * (Math.min(100, Math.max(0, parsed)) / 100) : Math.min(parsed, gross)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>İskonto</DialogTitle>
          <DialogDescription>
            Hesabın tamamına uygulanır ve fişe indirimli tutar yazılır.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {(["PERCENT", "AMOUNT"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={cn(
                  "rounded-lg border p-2.5 text-sm font-semibold transition-colors",
                  type === t
                    ? "border-kobipo-blue bg-kobipo-blue/10 text-kobipo-blue dark:border-primary dark:bg-primary/15 dark:text-primary"
                    : "hover:bg-muted",
                )}
              >
                {t === "PERCENT" ? "Yüzde (%)" : "Tutar (₺)"}
              </button>
            ))}
          </div>

          {type === "PERCENT" && (
            <div className="flex gap-2">
              {QUICK_PERCENTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setValue(String(p))}
                  className="h-9 flex-1 rounded-lg border text-sm font-semibold transition-colors hover:bg-muted"
                >
                  %{p}
                </button>
              ))}
            </div>
          )}

          <div>
            <Label className="text-xs text-muted-foreground">
              {type === "PERCENT" ? "Yüzde" : "Tutar (KDV dahil)"}
            </Label>
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              inputMode="decimal"
              placeholder="0"
              className="mt-1.5 h-11 text-right text-lg font-bold tabular-nums"
            />
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Sebep</Label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r === reason ? "" : r)}
                  className={cn(
                    "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                    reason === r
                      ? "border-kobipo-blue bg-kobipo-blue/10 text-kobipo-blue dark:border-primary dark:bg-primary/15 dark:text-primary"
                      : "hover:bg-muted",
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="veya yazın"
              className="mt-2"
            />
          </div>

          <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Yeni toplam</span>
            <span className="font-bold tabular-nums">
              {currency(Math.max(0, gross - discount))}
              <span className="ml-2 text-xs font-normal text-kobipo-green">
                −{currency(discount)}
              </span>
            </span>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {current ? (
            <Button variant="ghost" onClick={() => onApply(null)}>
              İskontoyu kaldır
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Vazgeç
            </Button>
            <Button
              disabled={parsed <= 0}
              onClick={() => onApply({ type, value: parsed, reason: reason.trim() || null })}
            >
              Uygula
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
