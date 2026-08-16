"use client"

// Ödeme kutusu — nakit/kart/yemek kartı/havale, parçalı ödeme, para üstü, veresiye.
// Mantık saf modülde: lib/satis/payment.ts
//
// Durumu ÇAĞIRAN tutar (state + onChange): satışı tamamlayan kod aynı state'ten
// hem tahsilat parçalarını hem fiş dökümünü üretiyor; panelin kendi içinde
// saklasaydı ikisi ayrışabilirdi.
//
// Parçalı ödeme SATIR LİSTESİ (yönteme anahtarlı değil): "ikisi de kartla
// ödeyecek" kafede en sık bölme biçimi ve eski modelde iki kart tek satıra
// çöküyordu — POS'ta iki ayrı çekim yapılırken kayıtta tek satır kalıyordu.

import { Banknote, CreditCard, Landmark, Plus, Split, Ticket, X } from "lucide-react"
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
  MEAL_CARD_PROVIDERS,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  newPortion,
  parseAmount,
  paymentSummary,
  portionsTotal,
  round2,
  splitEqually,
  type PaymentMethod,
  type PaymentPortion,
  type PaymentState,
} from "@/lib/satis/payment"

const METHOD_ICONS: Record<PaymentMethod, typeof Banknote> = {
  CASH: Banknote,
  CREDIT_CARD: CreditCard,
  MEAL_CARD: Ticket,
  BANK_TRANSFER: Landmark,
}

/**
 * Kutuya YAZILAN metin: ondalık virgülle, kullanıcının yazdığı gibi. Düğmeler
 * `String(1250.5)` yazınca alan "1250.5" gösteriyordu — ipucu "0,00" derken.
 * Çözümleyici ikisini de okuyor, mesele tutarlı görünmek.
 */
const trAmount = (n: number) => String(round2(n)).replace(".", ",")

/**
 * Kasadaki nakit tuşları — kahvecide en sık verilen banknotlar.
 *
 * EKLERLER, değiştirmezler: müşteri 200 + 50 uzattığında iki tuşa basmak 250
 * yazmalı. Eskiden son basılan tuş öncekini eziyordu (Hızlı Satış ekranı ise
 * baştan beri ekliyordu — aynı iş, iki farklı davranış). Etiketteki "+" bunu
 * görünür kılıyor; tam tutara dönmek için altındaki "Tam" düğmesi var.
 */
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
  const entered = portionsTotal(state.portions)
  const splitRemaining = round2(total - entered)
  /** Kasiyerin yazdığı nakit — hızlı tuşlar bunun ÜSTÜNE ekler. */
  const handedCash = parseAmount(state.tendered)

  const patchPortion = (id: string, patch: Partial<PaymentPortion>) =>
    onChange({ portions: state.portions.map((p) => (p.id === id ? { ...p, ...patch } : p)) })

  const removePortion = (id: string) =>
    onChange({ portions: state.portions.filter((p) => p.id !== id) })

  const addPortion = () =>
    onChange({ portions: [...state.portions, newPortion("CREDIT_CARD")] })

  /** Kalan tutarı seçilen parçaya yazar (tek dokunuşla kapatma). */
  const fillRemainder = (id: string) => {
    if (splitRemaining <= 0) return
    const current = state.portions.find((p) => p.id === id)
    patchPortion(id, { amount: trAmount(parseAmount(current?.amount) + splitRemaining) })
  }

  /** Hesabı N eşit parçaya böler — "ayrı ayrı ödeyeceğiz" akışının kısayolu. */
  const equalSplit = (count: number) => {
    const amounts = splitEqually(total, count)
    onChange({
      splitMode: true,
      // `splitEqually` nokta ile üretiyor (toFixed); kutuda virgülle görünsün.
      portions: amounts.map((amount) => ({
        ...newPortion("CREDIT_CARD"),
        amount: amount.replace(".", ","),
      })),
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
          Hesabı Böl{state.splitMode ? " • Açık" : ""}
        </button>
      )}

      {state.isCredit ? null : state.splitMode ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Eşit böl</span>
            {[2, 3, 4].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => equalSplit(n)}
                className="h-8 w-9 rounded-lg border text-sm font-semibold transition-colors hover:border-kobipo-blue hover:bg-kobipo-blue/5 dark:hover:border-primary dark:hover:bg-primary/10"
              >
                {n}
              </button>
            ))}
          </div>

          {state.portions.map((portion, index) => (
            <div key={portion.id} className="rounded-lg border p-2">
              <div className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-center text-xs font-semibold text-muted-foreground">
                  {index + 1}
                </span>
                <div className="flex flex-1 gap-1">
                  {PAYMENT_METHODS.map((m) => {
                    const Icon = METHOD_ICONS[m]
                    const isActive = portion.method === m
                    return (
                      <button
                        key={m}
                        type="button"
                        title={PAYMENT_METHOD_LABELS[m]}
                        aria-label={PAYMENT_METHOD_LABELS[m]}
                        onClick={() => patchPortion(portion.id, { method: m })}
                        className={cn(
                          "flex h-9 flex-1 items-center justify-center rounded-lg border transition-colors",
                          isActive
                            ? "border-kobipo-blue bg-kobipo-blue/10 text-kobipo-blue dark:border-primary dark:bg-primary/15 dark:text-primary"
                            : "border-border text-muted-foreground hover:bg-muted"
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </button>
                    )
                  })}
                </div>
                <Input
                  value={portion.amount}
                  onChange={(e) => patchPortion(portion.id, { amount: e.target.value })}
                  onFocus={() => splitRemaining > 0.005 && !portion.amount && fillRemainder(portion.id)}
                  inputMode="decimal"
                  placeholder="0,00"
                  className="h-9 w-28 text-right tabular-nums"
                />
                {state.portions.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removePortion(portion.id)}
                    aria-label="Parçayı kaldır"
                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              {portion.method === "MEAL_CARD" && (
                <Select
                  value={portion.provider ?? ""}
                  onValueChange={(v) => patchPortion(portion.id, { provider: v })}
                >
                  <SelectTrigger className="mt-2 h-8">
                    <SelectValue placeholder="Yemek kartı sağlayıcısı" />
                  </SelectTrigger>
                  <SelectContent>
                    {MEAL_CARD_PROVIDERS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          ))}

          <button
            type="button"
            onClick={addPortion}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted"
          >
            <Plus className="h-4 w-4" />
            Parça ekle
          </button>

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
        </div>
      ) : (
        <>
          {state.method === "CASH" && (
            <>
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">
                  Ödenen (nakit)
                  {handedCash > 0 && (
                    <button
                      type="button"
                      onClick={() => onChange({ tendered: "" })}
                      className="ml-2 rounded px-1 font-semibold text-muted-foreground underline-offset-2 hover:underline"
                    >
                      sıfırla
                    </button>
                  )}
                </Label>
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
              {/* Girilen tutar hesabın ALTINDAysa para üstü 0 çıkar ve ekran
                  sessiz kalıyordu — kasiyer "para üstü çalışmıyor" diye okuyor.
                  Eksik tutar yazılıyor; tahsilat yine tamamı sayılır (bu kutu
                  yalnız para üstü hesabı içindir, bkz. PaymentState.tendered). */}
              {handedCash > 0 && handedCash < round2(total) && (
                <p className="px-1 text-xs text-amber-600 dark:text-amber-400">
                  Girilen tutar hesabın {currency(round2(total) - handedCash)} altında — para
                  üstü çıkmaz.
                </p>
              )}
              <div className="grid grid-cols-4 gap-2">
                {QUICK_CASH.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => onChange({ tendered: trAmount(handedCash + n) })}
                    className="rounded-lg border border-border py-2.5 text-sm font-semibold transition-colors hover:border-kobipo-blue hover:bg-kobipo-blue/5 dark:hover:border-primary dark:hover:bg-primary/10"
                  >
                    +{n}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => onChange({ tendered: trAmount(total) })}
                className="w-full rounded-lg border border-kobipo-green/40 bg-kobipo-green/10 py-2.5 text-sm font-semibold text-kobipo-green transition-colors hover:bg-kobipo-green/20"
              >
                Tam — {currency(total)}
              </button>
            </>
          )}

          <div className={cn("grid grid-cols-4 gap-2", state.method === "CASH" && "border-t pt-3")}>
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

          {state.method === "MEAL_CARD" && (
            <Select value={state.provider ?? ""} onValueChange={(v) => onChange({ provider: v })}>
              <SelectTrigger>
                <SelectValue placeholder="Yemek kartı sağlayıcısı" />
              </SelectTrigger>
              <SelectContent>
                {MEAL_CARD_PROVIDERS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
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
          Nakit kasaya, kart/yemek kartı/havale bankaya işlenir. Kalan tutar açık hesap kalır.
        </p>
      )}
    </div>
  )
}
