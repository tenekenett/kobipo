"use client"

import { Minus, Plus } from "lucide-react"

interface QuantityStepperProps {
  value: number
  onChange: (value: number) => void
  step?: number
  min?: number
  disabled?: boolean
  /** Bulunduğu alanı doldur (mobil için); aksi halde içeriğe göre daralır. */
  fullWidth?: boolean
  className?: string
  inputClassName?: string
}

/** İki ondalığa yuvarla — float toplama hatalarını engelle. */
const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Miktar girişi için kompakt [−] [input] [+] adımlayıcı. Hızlı satış/alış gibi
 * POS benzeri ekranlarda miktarı tek tıkla artırıp azaltmak için.
 */
export function QuantityStepper({
  value,
  onChange,
  step = 1,
  min = 0,
  disabled,
  fullWidth = false,
  className = "",
  inputClassName = "",
}: QuantityStepperProps) {
  const dec = () => onChange(round2(Math.max(min, value - step)))
  const inc = () => onChange(round2(value + step))

  return (
    <div
      className={`${fullWidth ? "flex w-full" : "inline-flex"} items-center overflow-hidden rounded-md border bg-background ${className}`}
    >
      <button
        type="button"
        onClick={dec}
        disabled={disabled || value <= min}
        aria-label="Azalt"
        className="flex h-9 w-8 shrink-0 items-center justify-center text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40"
      >
        <Minus className="h-3.5 w-3.5" />
      </button>
      <input
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        value={value === 0 ? "" : String(value)}
        placeholder="0"
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className={`h-9 ${fullWidth ? "w-full flex-1 min-w-0" : "w-12"} border-x bg-transparent text-center text-sm outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none ${inputClassName}`}
      />
      <button
        type="button"
        onClick={inc}
        disabled={disabled}
        aria-label="Artır"
        className="flex h-9 w-8 shrink-0 items-center justify-center text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-40"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
