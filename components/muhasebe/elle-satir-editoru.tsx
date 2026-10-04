"use client"

import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { tutarSifirli, type PlanHesabi } from "@/components/muhasebe/ortak"
import { HesapSecici } from "@/components/muhasebe/hesap-secici"

/**
 * Elle satır editörü — elle (mahsup) fiş ve açılış fişinin farkını dağıtan satırlar.
 * Durum çağıranda tutulur; editör yalnız satırları düzenler ve farkı gösterir.
 */

export type ElleSatirTaslagi = {
  anahtar: string
  side: "DEBIT" | "CREDIT"
  amount: string
  accountId: string | null
  description: string
}

let sayac = 0
export function yeniSatir(side: "DEBIT" | "CREDIT" = "DEBIT", amount = ""): ElleSatirTaslagi {
  sayac += 1
  return { anahtar: `s${Date.now()}-${sayac}`, side, amount, accountId: null, description: "" }
}

/** "1.234,56" ya da "1234.56" → sayı; geçersizse NaN. */
export function tutarOku(s: string): number {
  const t = s.trim()
  if (!t) return NaN
  const normal = t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t
  return Math.round(Number(normal) * 100) / 100
}

export function elleToplamlar(satirlar: ElleSatirTaslagi[]) {
  let borc = 0
  let alacak = 0
  for (const s of satirlar) {
    const n = tutarOku(s.amount)
    if (!Number.isFinite(n)) continue
    if (s.side === "DEBIT") borc += n
    else alacak += n
  }
  return { borc: Math.round(borc * 100) / 100, alacak: Math.round(alacak * 100) / 100 }
}

export function ElleSatirEditoru({
  companyId,
  hesaplar,
  satirlar,
  onDegis,
  onHesapAcildi,
  disabled,
}: {
  companyId: string
  hesaplar: PlanHesabi[]
  satirlar: ElleSatirTaslagi[]
  onDegis: (s: ElleSatirTaslagi[]) => void
  onHesapAcildi?: () => Promise<void> | void
  disabled?: boolean
}) {
  const guncelle = (anahtar: string, d: Partial<ElleSatirTaslagi>) =>
    onDegis(satirlar.map((s) => (s.anahtar === anahtar ? { ...s, ...d } : s)))

  return (
    <div className="space-y-2">
      <div className="hidden grid-cols-[6rem_minmax(0,1fr)_8rem_minmax(0,0.8fr)_2.5rem] gap-2 px-1 text-xs font-semibold uppercase tracking-wide text-kobipo-gray md:grid">
        <span>Taraf</span>
        <span>Hesap</span>
        <span className="text-right">Tutar (₺)</span>
        <span>Açıklama</span>
        <span />
      </div>
      {satirlar.map((s) => {
        const n = tutarOku(s.amount)
        return (
          <div
            key={s.anahtar}
            className="grid gap-2 rounded-xl border border-kobipo-border/70 p-2 md:grid-cols-[6rem_minmax(0,1fr)_8rem_minmax(0,0.8fr)_2.5rem] md:border-0 md:p-0"
          >
            <select
              value={s.side}
              onChange={(e) => guncelle(s.anahtar, { side: e.target.value as "DEBIT" | "CREDIT" })}
              disabled={disabled}
              className="h-10 rounded-md border border-input bg-background px-2 text-sm"
              aria-label="Borç / alacak"
            >
              <option value="DEBIT">Borç</option>
              <option value="CREDIT">Alacak</option>
            </select>
            <HesapSecici
              companyId={companyId}
              hesaplar={hesaplar}
              deger={s.accountId}
              onSec={(id) => guncelle(s.anahtar, { accountId: id })}
              onHesapAcildi={onHesapAcildi}
              disabled={disabled}
              hatali={!s.accountId}
            />
            <Input
              inputMode="decimal"
              value={s.amount}
              onChange={(e) => guncelle(s.anahtar, { amount: e.target.value })}
              disabled={disabled}
              placeholder="0,00"
              className={cn("text-right tabular-nums", s.amount && !(n > 0) && "border-red-400")}
              aria-label="Tutar"
            />
            <Input
              value={s.description}
              onChange={(e) => guncelle(s.anahtar, { description: e.target.value })}
              disabled={disabled}
              placeholder="Açıklama"
              aria-label="Açıklama"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onDegis(satirlar.filter((x) => x.anahtar !== s.anahtar))}
              disabled={disabled}
              aria-label="Satırı sil"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )
      })}
      <Button type="button" variant="outline" size="sm" onClick={() => onDegis([...satirlar, yeniSatir()])} disabled={disabled}>
        <Plus className="mr-1.5 h-4 w-4" /> Satır ekle
      </Button>
    </div>
  )
}

export function DengeSatiri({ borc, alacak }: { borc: number; alacak: number }) {
  const fark = Math.round((borc - alacak) * 100) / 100
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-end gap-4 rounded-xl px-3 py-2 text-sm tabular-nums",
        fark === 0
          ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
          : "bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100",
      )}
    >
      <span>Borç {tutarSifirli(borc)}</span>
      <span>Alacak {tutarSifirli(alacak)}</span>
      <span className="font-semibold">{fark === 0 ? "Dengeli" : `Fark ${tutarSifirli(Math.abs(fark))} (${fark > 0 ? "borç fazla" : "alacak fazla"})`}</span>
    </div>
  )
}
