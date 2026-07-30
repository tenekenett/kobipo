"use client"

// Hesap paneli — adisyon ve kahveci satış ekranının ORTAK sağ sütunu.
// Kararlar: docs/restoran/SATIS-EKRANI.md (§4.1, K1, K8)
//
// Neden ortak: ikram/zayi, iskonto, seçenek ve hesap fişi yetenekleri iki
// ekranda da lazım. İki kopya olsaydı biri "ikram stoktan düşer" kuralını
// unuttuğu an iki ekran farklı davranırdı.
//
// Görünür kontrol BÜTÇESİ (İş 9 yöntemi): kalem satırında TEK kontrol vardır —
// "⋮". Adet, not, ikram, zayi, iptal hepsi onun içinde. Eskiden satırda dört
// kontrol (− sayı + çöp) duruyordu ve altı yeni yetenek eklenince satır
// okunamaz hale gelirdi.

import { useState } from "react"
import { MoreVertical, Receipt } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { QuantityStepper } from "@/components/ui/quantity-stepper"
import { currency } from "@/lib/fis/receipt-html"
import { qty } from "@/lib/format"
// Saf sabit modülü: tickets.ts prisma import ediyor, istemciye giremez.
import { TICKET_ITEM_REASONS, type TicketItemStatus } from "@/lib/restoran/ticket-constants"
import { cn } from "@/lib/utils"

export type PanelItem = {
  id: string
  description: string
  note?: string | null
  options?: Array<{ optionName: string }>
  quantity: number
  /** NET birim fiyat — panel brüte çevirip gösterir (ekranda daima KDV dahil). */
  unitPrice: number
  vatRate: number
  status?: TicketItemStatus
  reasonLabel?: string | null
}

export type PanelTotals = {
  /** İskonto öncesi, KDV dahil. */
  gross: number
  /** Uygulanan iskonto (KDV dahil). */
  discount: number
  total: number
}

const STATUS_BADGE: Record<Exclude<TicketItemStatus, "NORMAL">, { label: string; cls: string }> = {
  COMP: {
    label: "İKRAM",
    cls: "bg-kobipo-green/15 text-kobipo-green border-kobipo-green/40",
  },
  WASTE: {
    label: "ZAYİ",
    cls: "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-700",
  },
  VOID: {
    label: "İPTAL",
    cls: "bg-muted text-muted-foreground border-border",
  },
}

export function TicketPanel({
  title = "Adisyon",
  items,
  totals,
  discountLabel,
  readOnly = false,
  allowStatus = true,
  emptyText = "Menüden ürün seçin",
  footer,
  onQuantity,
  onSetStatus,
  onEditNote,
  className,
}: {
  title?: string
  items: PanelItem[]
  totals: PanelTotals
  /** "İskonto %10" gibi — iskonto satırının etiketi. */
  discountLabel?: string | null
  readOnly?: boolean
  /** Kahveci ekranında ikram/zayi yok: satış henüz oluşmadı, iptal = sil. */
  allowStatus?: boolean
  emptyText?: string
  footer?: React.ReactNode
  onQuantity: (id: string, quantity: number) => void
  onSetStatus?: (
    id: string,
    status: TicketItemStatus,
    reasonCode: string | null,
    reason: string | null,
  ) => void
  onEditNote?: (id: string) => void
  className?: string
}) {
  const [reasonFor, setReasonFor] = useState<{
    item: PanelItem
    status: Exclude<TicketItemStatus, "NORMAL">
    code: string
    note: string
  } | null>(null)

  const billableCount = items
    .filter((i) => (i.status ?? "NORMAL") === "NORMAL")
    .reduce((s, i) => s + i.quantity, 0)

  const grossOf = (item: PanelItem) => item.unitPrice * (1 + item.vatRate / 100)

  return (
    <Card className={cn("xl:sticky xl:top-4", className)}>
      <CardContent className="space-y-3 p-3">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Receipt className="h-4 w-4 text-kobipo-blue dark:text-primary" />
            {title}
          </span>
          <span className="text-xs text-muted-foreground">{qty(billableCount)} adet</span>
        </div>

        {items.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <div className="max-h-[52vh] space-y-1.5 overflow-y-auto pr-1">
            {items.map((item) => {
              const status = (item.status ?? "NORMAL") as TicketItemStatus
              const badge = status === "NORMAL" ? null : STATUS_BADGE[status]
              const lineTotal = item.quantity * grossOf(item)
              const optionText = (item.options ?? []).map((o) => o.optionName).join(" · ")
              return (
                <div
                  key={item.id}
                  className={cn(
                    "flex items-start gap-2 rounded-lg border p-2",
                    status === "VOID" && "opacity-50",
                    status === "WASTE" && "opacity-70",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-medium">
                      <span className="tabular-nums text-muted-foreground">
                        {qty(item.quantity)} ×
                      </span>
                      <span className="truncate">{item.description}</span>
                      {badge && (
                        <span
                          className={cn(
                            "shrink-0 rounded border px-1 py-px text-[10px] font-bold",
                            badge.cls,
                          )}
                        >
                          {badge.label}
                        </span>
                      )}
                    </p>
                    {(optionText || item.note) && (
                      <p className="truncate text-xs text-muted-foreground">
                        {[optionText, item.note].filter(Boolean).join(" · ")}
                      </p>
                    )}
                    {item.reasonLabel && (
                      <p className="truncate text-xs text-muted-foreground">{item.reasonLabel}</p>
                    )}
                  </div>

                  <span
                    className={cn(
                      "shrink-0 text-sm font-semibold tabular-nums",
                      status !== "NORMAL" && "text-muted-foreground line-through",
                    )}
                  >
                    {currency(status === "COMP" ? 0 : lineTotal)}
                  </span>

                  {!readOnly && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label="Kalem işlemleri"
                          className="-mr-1 shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                          <span className="text-xs text-muted-foreground">Adet</span>
                          <QuantityStepper
                            value={item.quantity}
                            onChange={(v) => onQuantity(item.id, v)}
                            min={0}
                          />
                        </div>
                        {onEditNote && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => onEditNote(item.id)}>
                              Not düzenle
                            </DropdownMenuItem>
                          </>
                        )}
                        {allowStatus && onSetStatus && (
                          <>
                            <DropdownMenuSeparator />
                            {status !== "NORMAL" ? (
                              <DropdownMenuItem
                                onClick={() => onSetStatus(item.id, "NORMAL", null, null)}
                              >
                                Geri al (hesaba dön)
                              </DropdownMenuItem>
                            ) : (
                              <>
                                <DropdownMenuItem
                                  onClick={() =>
                                    setReasonFor({ item, status: "VOID", code: "", note: "" })
                                  }
                                >
                                  İptal — hazırlanmadı
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() =>
                                    setReasonFor({ item, status: "COMP", code: "", note: "" })
                                  }
                                >
                                  İkram — para alınmaz
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() =>
                                    setReasonFor({ item, status: "WASTE", code: "", note: "" })
                                  }
                                >
                                  Zayi — döküldü / bozuldu
                                </DropdownMenuItem>
                              </>
                            )}
                          </>
                        )}
                        {!allowStatus && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-red-600 dark:text-red-400"
                              onClick={() => onQuantity(item.id, 0)}
                            >
                              Satırı sil
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Toplam bloğu TEK satır: ara toplam/KDV dökümü kasiyerin kararını
            değiştirmiyordu, müşterinin sorduğu tek şey toplam. Döküm hesap
            fişinde ve fişte duruyor. */}
        <div className="space-y-1 border-t pt-2">
          {totals.discount > 0 && (
            <div className="flex justify-between text-sm text-kobipo-green">
              <span>{discountLabel || "İskonto"}</span>
              <span className="tabular-nums">−{currency(totals.discount)}</span>
            </div>
          )}
          <div className="flex justify-between text-lg font-bold">
            <span>TOPLAM</span>
            <span className="tabular-nums">{currency(totals.total)}</span>
          </div>
        </div>

        {footer}
      </CardContent>

      {/* Sebep zorunlu: serbest metin olsaydı rapor gruplanamazdı. Açıklama
          isteyen kullanıcı alttaki nota yazar. */}
      <Dialog open={!!reasonFor} onOpenChange={(open) => !open && setReasonFor(null)}>
        <DialogContent className="sm:max-w-md">
          {reasonFor && (
            <>
              <DialogHeader>
                <DialogTitle>
                  {reasonFor.status === "COMP"
                    ? "İkram"
                    : reasonFor.status === "WASTE"
                      ? "Zayi"
                      : "Kalemi iptal et"}{" "}
                  — {reasonFor.item.description}
                </DialogTitle>
                <DialogDescription>
                  {reasonFor.status === "COMP"
                    ? "Hesapta 0,00 olarak görünür; malzemesi stoktan düşer."
                    : reasonFor.status === "WASTE"
                      ? "Hesapta görünmez; malzemesi stoktan düşer."
                      : "Hesapta görünmez; stok etkilenmez (ürün hazırlanmadı)."}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="grid gap-1.5">
                  {TICKET_ITEM_REASONS[reasonFor.status].map((r) => (
                    <button
                      key={r.code}
                      type="button"
                      onClick={() => setReasonFor({ ...reasonFor, code: r.code })}
                      className={cn(
                        "rounded-lg border p-2.5 text-left text-sm font-medium transition-colors",
                        reasonFor.code === r.code
                          ? "border-kobipo-blue bg-kobipo-blue/10 text-kobipo-blue dark:border-primary dark:bg-primary/15 dark:text-primary"
                          : "hover:bg-muted",
                      )}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Açıklama (isteğe bağlı)</Label>
                  <Input
                    value={reasonFor.note}
                    onChange={(e) => setReasonFor({ ...reasonFor, note: e.target.value })}
                    placeholder="Kısa not"
                    className="mt-1.5"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setReasonFor(null)}>
                  Vazgeç
                </Button>
                <Button
                  disabled={!reasonFor.code}
                  onClick={() => {
                    onSetStatus?.(
                      reasonFor.item.id,
                      reasonFor.status,
                      reasonFor.code,
                      reasonFor.note.trim() || null,
                    )
                    setReasonFor(null)
                  }}
                >
                  Uygula
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  )
}
