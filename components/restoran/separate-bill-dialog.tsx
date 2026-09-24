"use client"

// "Ayrı hesaplara ayır" — seçilen kalemler (adet bölünebilir) YENİ bir adisyona
// taşınır, o hesap kendi fişiyle kapanır. Kural sunucuda: lib/restoran/split.ts
//
// "Hesabı böl"den (split-dialog.tsx) farkı: orada FİŞ TEK kalır, yalnız ödeme
// parçalanır. Burada her hesap ayrı fiştir — biri erken kalkıyorsa ya da herkes
// kendi aldığının fişini istiyorsa. Tek seferde BİR yeni hesap açılır; üç kişi
// ayrı ödeyecekse işlem tekrarlanır (her seferinde kalanlar görünür, hata azalır).

import { useEffect, useMemo, useState } from "react"
import { Minus, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { currency } from "@/lib/fis/receipt-html"
import { qty } from "@/lib/format"
import { cn } from "@/lib/utils"

export type SeparableItem = {
  id: string
  description: string
  quantity: number
  /** Birim fiyatın KDV DAHİL, iskonto ÖNCESİ karşılığı. */
  unitGross: number
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000

export function SeparateBillDialog({
  open,
  items,
  factor,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean
  items: SeparableItem[]
  /** İskonto sonrası / öncesi oranı — ekrandaki tutarlar buna göre ölçeklenir. */
  factor: number
  busy: boolean
  onClose: () => void
  onConfirm: (moves: Array<{ itemId: string; quantity: number }>) => void
}) {
  const [moving, setMoving] = useState<Record<string, number>>({})

  useEffect(() => {
    if (open) setMoving({})
  }, [open])

  const set = (item: SeparableItem, value: number) =>
    setMoving((prev) => ({ ...prev, [item.id]: Math.max(0, Math.min(item.quantity, round4(value))) }))

  const { newTotal, keepTotal, movesAll, moves } = useMemo(() => {
    let moved = 0
    let all = 0
    for (const item of items) {
      all += item.quantity * item.unitGross
      moved += (moving[item.id] ?? 0) * item.unitGross
    }
    const list = items
      .filter((item) => (moving[item.id] ?? 0) > 0)
      .map((item) => ({ itemId: item.id, quantity: moving[item.id] }))
    return {
      newTotal: moved * factor,
      keepTotal: (all - moved) * factor,
      movesAll: all > 0 && Math.abs(all - moved) < 0.0001,
      moves: list,
    }
  }, [factor, items, moving])

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ayrı hesaba ayır</DialogTitle>
          <DialogDescription>
            Seçtiğiniz kalemler yeni bir hesaba taşınır ve kendi fişiyle kapanır. Birden çok kişi ayrı ödeyecekse
            işlemi her kişi için tekrarlayın.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[50vh] space-y-1.5 overflow-y-auto pr-1">
          {items.map((item) => {
            const value = moving[item.id] ?? 0
            return (
              <div
                key={item.id}
                className={cn("flex items-center gap-2 rounded-lg border p-2", value > 0 && "border-primary bg-primary/5")}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.description}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {qty(item.quantity)} × {currency(item.unitGross * factor)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    aria-label={`${item.description} bir azalt`}
                    disabled={value <= 0}
                    onClick={() => set(item, Number.isInteger(value) ? value - 1 : Math.floor(value))}
                  >
                    <Minus className="h-3.5 w-3.5" />
                  </Button>
                  <span className="w-10 text-center text-sm font-semibold tabular-nums">{qty(value)}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    aria-label={`${item.description} bir artır`}
                    disabled={value >= item.quantity}
                    onClick={() => set(item, value + 1)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={() => set(item, value >= item.quantity ? 0 : item.quantity)}
                  >
                    {value >= item.quantity ? "Hiçbiri" : "Tümü"}
                  </Button>
                </div>
              </div>
            )
          })}
        </div>

        <div className="grid gap-1.5 rounded-lg bg-muted/50 p-2.5 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Bu hesapta kalan</span>
            <span className="font-semibold tabular-nums">{currency(keepTotal)}</span>
          </div>
          <div className="flex justify-between font-bold">
            <span>Yeni hesap</span>
            <span className="tabular-nums">{currency(newTotal)}</span>
          </div>
          {movesAll && (
            <p className="text-xs text-red-700 dark:text-red-300">
              Hesabın tamamı ayrılamaz; bu hesapta en az bir kalem kalmalı. Tüm hesabı taşımak için "Masayı değiştir"i
              kullanın.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Vazgeç
          </Button>
          <Button onClick={() => onConfirm(moves)} disabled={busy || moves.length === 0 || movesAll}>
            {busy ? "Ayrılıyor…" : "Ayrı hesap aç"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
