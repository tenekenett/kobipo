"use client"

// Hesap iskontosu — yüzde ya da tutar, sebebiyle ve UYGULAYAN PERSONELLE birlikte.
// Kararlar: docs/restoran/SATIS-EKRANI.md K3
//
// Tutar KDV DAHİL girilir: kullanıcı hesabın altındaki rakama bakıp "50 lira
// düş" der. Matrah karşılığına çevirmek sunucunun işi (lib/restoran/tickets.ts).
//
// Personel seçimi İK kartından (Employee) gelir, oturumu açan kullanıcıdan
// DEĞİL: kafede kasa çoğu zaman ortak hesapla açıktır, "indirimi kim verdi"
// sorusunun cevabı o an masaya bakan garsondur. Oturum izi ayrıca ve sessizce
// yazılır (`discountBy`) — biri sorumluluğu, diğeri kaydı gösterir.

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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { currency } from "@/lib/fis/receipt-html"
import { TICKET_DISCOUNT_REASONS } from "@/lib/restoran/ticket-constants"
import type { RefEmployee } from "@/lib/swr/use-company-data"
import { cn } from "@/lib/utils"

export type DiscountValue = {
  type: "PERCENT" | "AMOUNT"
  value: number
  /** Sabit sebep kodu — rapor bunu gruplar. */
  reasonCode: string | null
  /** Serbest açıklama; kodun yerine geçmez, yanında durur. */
  reason: string | null
  /** İskontoyu uygulayan personelin İK kartı id'si. */
  employeeId: string | null
} | null

/** Sık kullanılan yüzdeler — kasiyer sayı yazmadan tek dokunuşla seçsin. */
const QUICK_PERCENTS = [5, 10, 15, 20]

export function DiscountDialog({
  open,
  gross,
  current,
  employees,
  onClose,
  onApply,
}: {
  open: boolean
  /** İskonto öncesi hesap toplamı (KDV dahil) — önizleme için. */
  gross: number
  current: DiscountValue
  /**
   * Aktif personel. BOŞ ise seçici hiç çizilmez: personel kartı tanımlamamış
   * (ya da `hr` modülünü kullanmayan) işletmede iskonto kilitlenmemeli.
   */
  employees: RefEmployee[]
  onClose: () => void
  onApply: (value: DiscountValue) => void
}) {
  const [type, setType] = useState<"PERCENT" | "AMOUNT">(current?.type ?? "PERCENT")
  const [value, setValue] = useState(current ? String(current.value) : "")
  const [reasonCode, setReasonCode] = useState<string | null>(current?.reasonCode ?? null)
  const [reason, setReason] = useState(current?.reason ?? "")
  const [employeeId, setEmployeeId] = useState<string | null>(current?.employeeId ?? null)

  const parsed = parseFloat(value.replace(",", ".")) || 0
  const discount =
    type === "PERCENT" ? gross * (Math.min(100, Math.max(0, parsed)) / 100) : Math.min(parsed, gross)

  // Personel varsa seçim ZORUNLU — sunucudaki kuralın aynısı, kullanıcı
  // "Uygula"ya basıp hata mesajıyla karşılaşmasın.
  const needsEmployee = employees.length > 0

  /**
   * Açıklama ZORUNLU (2026-08-07). Sebep kodu "ne tür bir indirim" sorusunu
   * cevaplıyor ama "%20 · Sadık müşteri" denetimde tek başına bir şey anlatmıyor:
   * hangi müşteri, hangi söz, kimin onayı. Kod raporun gruplama ekseni, açıklama
   * ise tek tek kayda bakan kişinin okuyacağı yer — ikisi farklı iş görüyor ve
   * biri diğerinin yerine geçmiyor.
   */
  const trimmedReason = reason.trim()
  const canApply = parsed > 0 && (!needsEmployee || !!employeeId) && trimmedReason.length > 0

  const employeeLabel = useMemo(
    () => employees.find((e) => e.id === employeeId)?.name ?? null,
    [employees, employeeId],
  )

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

          {needsEmployee && (
            <div>
              <Label className="text-xs text-muted-foreground">İskontoyu uygulayan personel</Label>
              <Select value={employeeId ?? ""} onValueChange={(v) => setEmployeeId(v || null)}>
                <SelectTrigger className="mt-1.5 h-11">
                  <SelectValue placeholder="Personel seçin" />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name}
                      {e.position ? (
                        <span className="ml-2 text-xs text-muted-foreground">{e.position}</span>
                      ) : null}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label className="text-xs text-muted-foreground">Sebep</Label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {TICKET_DISCOUNT_REASONS.map((r) => (
                <button
                  key={r.code}
                  type="button"
                  onClick={() => setReasonCode(r.code === reasonCode ? null : r.code)}
                  className={cn(
                    "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                    reasonCode === r.code
                      ? "border-kobipo-blue bg-kobipo-blue/10 text-kobipo-blue dark:border-primary dark:bg-primary/15 dark:text-primary"
                      : "hover:bg-muted",
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <Label className="mt-2 block text-xs text-muted-foreground">Açıklama</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Örn. Ahmet Bey — sürekli müşteri, söz verildi"
              className="mt-1.5"
            />
          </div>

          <div className="space-y-1 rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Yeni toplam</span>
              <span className="font-bold tabular-nums">
                {currency(Math.max(0, gross - discount))}
                <span className="ml-2 text-xs font-normal text-kobipo-green">
                  −{currency(discount)}
                </span>
              </span>
            </div>
            {/* Kaydedilecek not, uygulanmadan ÖNCE aynen gösterilir: kasiyer
                hesabın altında ne yazacağını burada görür. */}
            {employeeLabel && (
              <div className="text-xs text-muted-foreground">
                {[employeeLabel, TICKET_DISCOUNT_REASONS.find((r) => r.code === reasonCode)?.label, reason.trim()]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            )}
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
              disabled={!canApply}
              onClick={() =>
                onApply({
                  type,
                  value: parsed,
                  reasonCode,
                  reason: reason.trim() || null,
                  employeeId,
                })
              }
            >
              Uygula
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
