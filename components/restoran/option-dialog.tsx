"use client"

// Ürün seçeneği (porsiyon / modifier) seçimi.
// Kararlar: docs/restoran/SATIS-EKRANI.md K6
//
// EN ÖNEMLİ KURAL: seçeneği OLMAYAN ürün bu diyaloğu hiç görmez — tek dokunuşta
// sepete girer. Kahveciyi yavaşlatacak tek şey her üründe açılan bir diyalogdur;
// çağıran ekranlar bu yüzden `groups.length === 0` durumunda doğrudan ekler.
//
// Fiyat farkı burada YALNIZ GÖSTERİLİR; kaleme yansıtan hesap sunucudadır
// (fiyatın ürün kartından kopyalanmasıyla aynı gerekçe).

import { useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatMoney } from "@/lib/format"
import type { OptionGroupView } from "@/lib/restoran/product-options"
import { cn } from "@/lib/utils"

export type OptionPick = { optionIds: string[]; note: string | null; extraGross: number }

export function OptionDialog({
  open,
  productName,
  basePrice,
  priceCurrency,
  groups,
  initialNote,
  onCancel,
  onConfirm,
}: {
  open: boolean
  productName: string
  /** Ürünün KDV DAHİL taban fiyatı — başlıktaki tutar bunun üstüne biner. */
  basePrice: number
  /**
   * Ürünün para birimi — fiyat ve seçenek farkı BU cinsten gösterilir. Ürün USD
   * fiyatlıyken ₺ basmak "1 $ = 1 ₺" yanılgısı üretir (bkz. lib/format.ts).
   * Tezgâhta fiş TRY kesilir; çevrim sepete/adisyona eklenirken yapılır.
   */
  priceCurrency?: string | null
  groups: OptionGroupView[]
  initialNote?: string | null
  onCancel: () => void
  onConfirm: (pick: OptionPick) => void
}) {
  // Varsayılanlar açılışta işaretli gelir: "Normal süt" gibi şıklar için
  // kullanıcı hiçbir şeye dokunmadan Ekle'ye basabilsin.
  const [selected, setSelected] = useState<Record<string, string[]>>(() => defaultsOf(groups))
  const [note, setNote] = useState(initialNote ?? "")
  const [dirtyKey, setDirtyKey] = useState("")

  // Diyalog başka ürün için yeniden açıldığında seçim sıfırlanmalı.
  const key = groups.map((g) => g.id).join("|") + productName
  if (open && dirtyKey !== key) {
    setDirtyKey(key)
    setSelected(defaultsOf(groups))
    setNote(initialNote ?? "")
  }

  const toggle = (group: OptionGroupView, optionId: string) => {
    setSelected((prev) => {
      const current = prev[group.id] ?? []
      if (group.isMulti) {
        return {
          ...prev,
          [group.id]: current.includes(optionId)
            ? current.filter((id) => id !== optionId)
            : [...current, optionId],
        }
      }
      // Tek seçimli grupta aynı şıkka tekrar basmak seçimi kaldırır — zorunlu
      // grupta kaldırmaya izin verilmez (aksi halde Ekle kilitli kalır).
      const isSame = current[0] === optionId
      return { ...prev, [group.id]: isSame && !group.isRequired ? [] : [optionId] }
    })
  }

  const { extraGross, missing } = useMemo(() => {
    let extra = 0
    let missingCount = 0
    for (const group of groups) {
      const picks = selected[group.id] ?? []
      if (group.isRequired && picks.length === 0) missingCount += 1
      for (const id of picks) {
        const option = group.options.find((o) => o.id === id)
        if (option) extra += option.priceDelta
      }
    }
    return { extraGross: extra, missing: missingCount }
  }, [groups, selected])

  const optionIds = groups.flatMap((g) => selected[g.id] ?? [])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{productName}</DialogTitle>
        </DialogHeader>

        <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
          {groups.map((group) => (
            <div key={group.id}>
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-sm font-semibold">{group.name}</span>
                {group.isRequired && (
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    ZORUNLU
                  </span>
                )}
                {group.isMulti && (
                  <span className="text-[10px] text-muted-foreground">çoklu seçim</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {group.options.map((option) => {
                  const isActive = (selected[group.id] ?? []).includes(option.id)
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => toggle(group, option.id)}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                        isActive
                          ? "border-kobipo-blue bg-kobipo-blue/10 text-kobipo-blue dark:border-primary dark:bg-primary/15 dark:text-primary"
                          : "hover:bg-muted",
                      )}
                    >
                      {option.name}
                      {option.priceDelta !== 0 && (
                        <span className="ml-1.5 text-xs text-muted-foreground">
                          {option.priceDelta > 0 ? "+" : "−"}
                          {formatMoney(Math.abs(option.priceDelta), priceCurrency)}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          <div>
            <Label className="text-xs text-muted-foreground">Not</Label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="az şekerli, buzsuz…"
              className="mt-1.5"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Vazgeç
          </Button>
          <Button
            disabled={missing > 0}
            onClick={() => onConfirm({ optionIds, note: note.trim() || null, extraGross })}
          >
            {missing > 0
              ? "Zorunlu seçim bekleniyor"
              : `Ekle — ${formatMoney(basePrice + extraGross, priceCurrency)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function defaultsOf(groups: OptionGroupView[]): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const group of groups) {
    const def = group.options.find((o) => o.isDefault)
    out[group.id] = def ? [def.id] : []
  }
  return out
}
