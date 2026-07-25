"use client"

// Ödeme kutusu — nakit/kart/havale, parçalı ödeme, para üstü, veresiye.
// Mantık saf modülde: lib/satis/payment.ts
//
// Durumu ÇAĞIRAN tutar (state + onChange): satışı tamamlayan kod aynı state'ten
// hem tahsilat parçalarını hem fiş dökümünü üretiyor; panelin kendi içinde
// saklasaydı ikisi ayrışabilirdi.

import { Banknote, CreditCard, Landmark, Split } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { currency } from "@/lib/fis/receipt-html"
import type { RefAccount } from "@/lib/swr/use-company-data"
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  parseAmount,
  paymentSummary,
  round2,
  splitTotal,
  type PaymentMethod,
  type PaymentState,
} from "@/lib/satis/payment"

const METHOD_ICONS: Record<PaymentMethod, typeof Banknote> = {
  CASH: Banknote,
  CREDIT_CARD: CreditCard,
  BANK_TRANSFER: Landmark,
}

/** Kasadaki nakit tuşları — kahvecide en sık verilen banknotlar. */
const QUICK_CASH = [50, 100, 200, 500]

export function PaymentPanel({
  total,
  state,
  onChange,
  accounts,
  className,
}: {
  total: number
  state: PaymentState
  onChange: (patch: Partial<PaymentState>) => void
  accounts: RefAccount[]
  className?: string
}) {
  const summary = paymentSummary(state, total)
  const entered = splitTotal(state.split)
  const splitRemaining = round2(total - entered)

  const setSplit = (method: PaymentMethod, value: string) =>
    onChange({ split: { ...state.split, [method]: value } })

  /** Kalan tutarı nakit alanına ekler (tek tuşla kapatma). */
  const fillRemainder = () => {
    if (splitRemaining <= 0) return
    onChange({
      split: {
        ...state.split,
        CASH: String(round2(parseAmount(state.split.CASH) + splitRemaining)),
      },
    })
  }

  return (
    <div className={cn("space-y-3", className)}>
      {!state.isCredit && (
        <button
          type="button"
          onClick={() => onChange({ splitMode: !state.splitMode })}
          className={cn(
            "flex w-full items-center justify-center gap-2 rounded-lg border-2 p-2.5 text-sm font-bold transition-colors",
            state.splitMode
              ? "border-kobipo-blue bg-kobipo-blue/10 text-kobipo-blue dark:border-primary dark:bg-primary/15 dark:text-primary"
              : "border-dashed border-kobipo-blue/50 text-kobipo-blue hover:bg-kobipo-blue/5 dark:border-primary/50 dark:text-primary dark:hover:bg-primary/10"
          )}
        >
          <Split className="h-4 w-4" />
          Parçalı Ödeme{state.splitMode ? " • Açık" : ""}
        </button>
      )}

      {state.isCredit ? null : state.splitMode ? (
        <div className="space-y-2">
          {PAYMENT_METHODS.map((m) => {
            const Icon = METHOD_ICONS[m]
            return (
              <div key={m} className="flex items-center gap-2">
                <span className="flex w-28 shrink-0 items-center gap-1.5 text-sm font-medium">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  {PAYMENT_METHOD_LABELS[m]}
                </span>
                <Input
                  value={state.split[m]}
                  onChange={(e) => setSplit(m, e.target.value)}
                  inputMode="decimal"
                  placeholder="0,00"
                  className="h-10 flex-1 text-right tabular-nums"
                />
              </div>
            )
          })}
          <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-1.5 text-sm">
            <span className="text-muted-foreground">Toplam ödenen</span>
            <span className="font-semibold tabular-nums">{currency(entered)}</span>
          </div>
          <div className="flex items-center justify-between px-1 text-sm">
            <span className="text-muted-foreground">
              {splitRemaining >= 0 ? "Kalan" : "Para üstü"}
            </span>
            <span
              className={cn(
                "font-bold tabular-nums",
                splitRemaining > 0.005 ? "text-amber-600 dark:text-amber-400" : "text-kobipo-green"
              )}
            >
              {currency(Math.abs(splitRemaining))}
            </span>
          </div>
          {splitRemaining > 0.005 && (
            <button
              type="button"
              onClick={fillRemainder}
              className="w-full rounded-lg border border-kobipo-green/40 bg-kobipo-green/10 py-2 text-sm font-semibold text-kobipo-green transition-colors hover:bg-kobipo-green/20"
            >
              Kalanı nakite ekle
            </button>
          )}
        </div>
      ) : (
        <>
          {state.method === "CASH" && (
            <>
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Ödenen (nakit)</Label>
                <span className="text-xs text-muted-foreground">
                  Para Üstü:{" "}
                  <span className="font-bold text-kobipo-green">{currency(summary.change)}</span>
                </span>
              </div>
              <Input
                value={state.tendered}
                onChange={(e) => onChange({ tendered: e.target.value })}
                inputMode="decimal"
                placeholder="0,00"
                className="h-12 text-right text-lg font-bold tabular-nums"
              />
              <div className="grid grid-cols-4 gap-2">
                {QUICK_CASH.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => onChange({ tendered: String(n) })}
                    className="rounded-lg border border-border py-2.5 text-sm font-semibold transition-colors hover:border-kobipo-blue hover:bg-kobipo-blue/5 dark:hover:border-primary dark:hover:bg-primary/10"
                  >
                    {n}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => onChange({ tendered: String(round2(total)) })}
                className="w-full rounded-lg border border-kobipo-green/40 bg-kobipo-green/10 py-2.5 text-sm font-semibold text-kobipo-green transition-colors hover:bg-kobipo-green/20"
              >
                Tam — {currency(total)}
              </button>
            </>
          )}

          <div className={cn("grid grid-cols-3 gap-2", state.method === "CASH" && "border-t pt-3")}>
            {PAYMENT_METHODS.map((m) => {
              const Icon = METHOD_ICONS[m]
              const isActive = !state.isCredit && state.method === m
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() =>
                    onChange({ method: m, isCredit: false, ...(m !== "CASH" ? { tendered: "" } : {}) })
                  }
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-lg border p-3 text-[11px] font-semibold transition-colors",
                    isActive
                      ? "border-kobipo-blue bg-kobipo-blue/10 text-kobipo-blue dark:border-primary dark:bg-primary/15 dark:text-primary"
                      : "border-border hover:bg-muted"
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {PAYMENT_METHOD_LABELS[m]}
                </button>
              )
            })}
          </div>
        </>
      )}

      <button
        type="button"
        onClick={() => onChange({ isCredit: !state.isCredit })}
        className={cn(
          "w-full rounded-lg border p-2.5 text-sm font-semibold transition-colors",
          state.isCredit
            ? "border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
            : "border-border text-muted-foreground hover:bg-muted"
        )}
      >
        Veresiye / Açık Hesap {state.isCredit ? "• Açık" : ""}
      </button>

      {!state.isCredit && !state.splitMode && accounts.length > 0 && (
        <div>
          <Label className="text-xs text-muted-foreground">Kasa / Banka Hesabı</Label>
          <Select value={state.accountId} onValueChange={(v) => onChange({ accountId: v })}>
            <SelectTrigger className="mt-1.5">
              <SelectValue placeholder="Hesap seçin" />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name} {a.type === "CASH" ? "(Kasa)" : "(Banka)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {!state.isCredit && state.splitMode && (
        <p className="px-1 text-xs text-muted-foreground">
          Nakit kasaya, kart/havale bankaya otomatik işlenir. Kalan tutar açık hesap olarak kalır.
        </p>
      )}
    </div>
  )
}
