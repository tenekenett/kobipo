"use client"

// Hesabı kalemlere göre bölme.
// Kararlar: docs/restoran/SATIS-EKRANI.md K5 (Faz 2 — "ödemede bölme")
//
// FİŞ TEKTİR, ödeme parçalıdır: iki müşteri ayrı ayrı ödese de belge tek kalır.
// Adisyonu gerçekten ikiye ayırmak (iki ayrı fiş) "bir masada tek açık adisyon"
// kuralını gevşetmeyi gerektiriyor — ayrı karar, F4.
//
// Kalemi bir hesaba atamak yerine "kaça bölelim" sorusuyla başlıyoruz çünkü
// kafede en sık istek eşit bölme; kalem ataması onun üstüne biniyor.

import { useMemo, useState } from "react"
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

export type SplitItem = {
  id: string
  description: string
  quantity: number
  /** Satırın KDV DAHİL, iskonto ÖNCESİ tutarı. */
  lineGross: number
}

const PART_COLORS = [
  "border-kobipo-blue bg-kobipo-blue/10 text-kobipo-blue dark:border-primary dark:bg-primary/15 dark:text-primary",
  "border-kobipo-green/60 bg-kobipo-green/10 text-kobipo-green",
  "border-amber-400 bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  "border-purple-400 bg-purple-100 text-purple-800 dark:bg-purple-950/40 dark:text-purple-300",
]

export function SplitDialog({
  open,
  items,
  /** İskonto sonrası toplam / iskonto öncesi toplam — parça tutarları buna göre ölçeklenir. */
  factor,
  onClose,
  onConfirm,
}: {
  open: boolean
  items: SplitItem[]
  factor: number
  onClose: () => void
  onConfirm: (amounts: number[]) => void
}) {
  const [parts, setParts] = useState(2)
  const [assign, setAssign] = useState<Record<string, number>>({})

  const totals = useMemo(() => {
    const sums = Array.from({ length: parts }, () => 0)
    let unassigned = 0
    for (const item of items) {
      const target = assign[item.id]
      const amount = item.lineGross * factor
      if (target != null && target < parts) sums[target] += amount
      else unassigned += amount
    }
    // Atanmamış kalemler parçalara EŞİT dağılır: kullanıcı yalnız "şu tatlı
    // bende" demek isteyip kalanı bölüştürebilsin.
    const share = unassigned / parts
    return sums.map((s) => Math.round((s + share) * 100) / 100)
  }, [assign, factor, items, parts])

  const grand = totals.reduce((s, v) => s + v, 0)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Hesabı böl</DialogTitle>
          <DialogDescription>
            Kalem seçmezseniz tutar eşit bölünür. Fiş tek kesilir, ödeme parçalı yazılır.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Kaç kişi</span>
          {[2, 3, 4].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setParts(n)}
              className={cn(
                "h-9 w-10 rounded-lg border text-sm font-semibold transition-colors",
                parts === n ? PART_COLORS[0] : "hover:bg-muted",
              )}
            >
              {n}
            </button>
          ))}
        </div>

        <div className="max-h-[45vh] space-y-1.5 overflow-y-auto pr-1">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-2 rounded-lg border p-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  <span className="tabular-nums text-muted-foreground">{qty(item.quantity)} × </span>
                  {item.description}
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {currency(item.lineGross * factor)}
                </p>
              </div>
              <div className="flex gap-1">
                {Array.from({ length: parts }, (_, index) => {
                  const isActive = assign[item.id] === index
                  return (
                    <button
                      key={index}
                      type="button"
                      onClick={() =>
                        setAssign((prev) => {
                          const next = { ...prev }
                          if (isActive) delete next[item.id]
                          else next[item.id] = index
                          return next
                        })
                      }
                      className={cn(
                        "h-8 w-8 rounded-lg border text-xs font-bold transition-colors",
                        isActive ? PART_COLORS[index % PART_COLORS.length] : "hover:bg-muted",
                      )}
                    >
                      {index + 1}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="grid gap-1.5 rounded-lg bg-muted/50 p-2.5 text-sm">
          {totals.map((amount, index) => (
            <div key={index} className="flex justify-between">
              <span className="text-muted-foreground">{index + 1}. hesap</span>
              <span className="font-semibold tabular-nums">{currency(amount)}</span>
            </div>
          ))}
          <div className="flex justify-between border-t pt-1.5 font-bold">
            <span>Toplam</span>
            <span className="tabular-nums">{currency(grand)}</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Vazgeç
          </Button>
          <Button onClick={() => onConfirm(totals)}>Ödemeye geç</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
