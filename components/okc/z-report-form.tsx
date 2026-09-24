"use client"

// Z raporu giriş / düzeltme penceresi. Plan: docs/okc/ASAMA1-KOBIPO.md A3.
//
// Form Z fişinin sırasını izler: cihaz → Z no → an → toplam → KDV kırılımı →
// ödeme kırılımı. Z'nin KENDİ içindeki tutarlılık (satırlar toplamı = toplam)
// yazarken canlı gösterilir (zInternalChecks): yazım hatası kaydedilmeden görünsün,
// sonra "Kobipo farkı" sanılmasın.

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle } from "lucide-react"
import { WriteAction } from "@/components/dashboard/write-guard"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"
import { parseTrNumber } from "@/lib/format"
import type { OkcDeviceView } from "@/lib/okc/devices"
import {
  Z_DEFAULT_VAT_RATES,
  Z_PAYMENT_LABELS,
  Z_PAYMENT_METHODS,
  zInternalChecks,
  type ZPaymentMethod,
  type ZPaymentLine,
  type ZVatLine,
} from "@/lib/okc/z-report"

export type ZReportEditable = {
  id: string
  device: { id: string }
  zNo: number
  takenAt: string
  ekuNo: string | null
  grossTotal: number
  receiptCount: number | null
  vatLines: ZVatLine[]
  paymentLines: ZPaymentLine[]
  cancelCount: number | null
  cancelTotal: number | null
  note: string | null
}

type VatRow = { rate: number; base: string; vat: string }
type Form = {
  deviceId: string
  zNo: string
  takenAt: string
  ekuNo: string
  grossTotal: string
  receiptCount: string
  vat: VatRow[]
  payments: Record<ZPaymentMethod, string>
  cancelCount: string
  cancelTotal: string
  note: string
}

const moneyText = (n: number | null | undefined) =>
  n == null || n === 0 ? "" : n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** `datetime-local` değeri: yerel saatle "YYYY-MM-DDTHH:mm". */
function toLocalInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function emptyPayments(): Record<ZPaymentMethod, string> {
  return Object.fromEntries(Z_PAYMENT_METHODS.map((m) => [m, ""])) as Record<ZPaymentMethod, string>
}

function initialForm(devices: OkcDeviceView[], existing: ZReportEditable | null): Form {
  if (existing) {
    const rates = [...new Set([...Z_DEFAULT_VAT_RATES, ...existing.vatLines.map((l) => l.rate)])].sort((a, b) => a - b)
    const payments = emptyPayments()
    for (const line of existing.paymentLines) payments[line.method] = moneyText(line.amount)
    return {
      deviceId: existing.device.id,
      zNo: String(existing.zNo),
      takenAt: toLocalInput(new Date(existing.takenAt)),
      ekuNo: existing.ekuNo ?? "",
      grossTotal: moneyText(existing.grossTotal),
      receiptCount: existing.receiptCount == null ? "" : String(existing.receiptCount),
      vat: rates.map((rate) => {
        const line = existing.vatLines.find((l) => l.rate === rate)
        return { rate, base: moneyText(line?.base), vat: moneyText(line?.vat) }
      }),
      payments,
      cancelCount: existing.cancelCount == null ? "" : String(existing.cancelCount),
      cancelTotal: moneyText(existing.cancelTotal),
      note: existing.note ?? "",
    }
  }
  const active = devices.filter((d) => d.isActive)
  const device = active.length === 1 ? active[0] : null
  return {
    deviceId: device?.id ?? "",
    // Sıradaki Z: cihazın son Z'si + 1 (kullanıcı değiştirebilir).
    zNo: device?.lastZ ? String(device.lastZ.zNo + 1) : "",
    takenAt: toLocalInput(new Date()),
    ekuNo: device?.ekuNo ?? "",
    grossTotal: "",
    receiptCount: "",
    vat: Z_DEFAULT_VAT_RATES.map((rate) => ({ rate, base: "", vat: "" })),
    payments: emptyPayments(),
    cancelCount: "",
    cancelTotal: "",
    note: "",
  }
}

const n = (text: string) => parseTrNumber(text) ?? 0

export function ZReportFormDialog({
  open,
  onOpenChange,
  companyId,
  devices,
  existing,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string
  devices: OkcDeviceView[]
  existing: ZReportEditable | null
  onSaved: (id: string) => void
}) {
  const { toast } = useToast()
  const [form, setForm] = useState<Form>(() => initialForm(devices, existing))
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (open) setForm(initialForm(devices, existing))
  }, [open, devices, existing])

  const selectable = devices.filter((d) => d.isActive || d.id === existing?.device.id)

  const onDeviceChange = (deviceId: string) => {
    const device = devices.find((d) => d.id === deviceId)
    setForm((f) => ({
      ...f,
      deviceId,
      ekuNo: device?.ekuNo ?? f.ekuNo,
      zNo: existing ? f.zNo : device?.lastZ ? String(device.lastZ.zNo + 1) : f.zNo,
    }))
  }

  const issues = useMemo(
    () =>
      zInternalChecks({
        grossTotal: n(form.grossTotal),
        vatLines: form.vat.filter((l) => n(l.base) || n(l.vat)).map((l) => ({ rate: l.rate, base: n(l.base), vat: n(l.vat) })),
        paymentLines: Z_PAYMENT_METHODS.filter((m) => n(form.payments[m])).map((m) => ({ method: m, amount: n(form.payments[m]) })),
      }),
    [form],
  )

  const setVat = (index: number, patch: Partial<VatRow>) =>
    setForm((f) => ({ ...f, vat: f.vat.map((row, i) => (i === index ? { ...row, ...patch } : row)) }))

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const body = {
        companyId,
        deviceId: form.deviceId,
        zNo: Number(form.zNo),
        takenAt: form.takenAt ? new Date(form.takenAt).toISOString() : "",
        ekuNo: form.ekuNo,
        grossTotal: form.grossTotal,
        receiptCount: form.receiptCount === "" ? null : Number(form.receiptCount),
        vatLines: form.vat.map((l) => ({ rate: l.rate, base: l.base, vat: l.vat })),
        paymentLines: Z_PAYMENT_METHODS.map((m) => ({ method: m, amount: form.payments[m] })),
        cancelCount: form.cancelCount === "" ? null : Number(form.cancelCount),
        cancelTotal: form.cancelTotal,
        note: form.note,
      }
      const res = await fetch(existing ? `/api/okc/z-raporlari/${existing.id}` : "/api/okc/z-raporlari", {
        method: existing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Kaydedilemedi")
      toast({ title: "Kaydedildi", description: `Z ${form.zNo} kaydedildi` })
      onOpenChange(false)
      onSaved(data.id)
    } catch (e) {
      toast({ title: "Hata", description: e instanceof Error ? e.message : "Bilinmeyen hata", variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{existing ? `Z ${existing.zNo} — düzelt` : "Z raporu gir"}</DialogTitle>
          <DialogDescription>
            Rakamları yazarkasadan aldığınız Z fişinden girin. Boş bıraktığınız KDV ve ödeme satırları karşılaştırılmaz.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-2 sm:col-span-2">
              <Label>Yazarkasa *</Label>
              <Select value={form.deviceId} onValueChange={onDeviceChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Seçin" />
                </SelectTrigger>
                <SelectContent>
                  {selectable.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name} · {d.serialNo}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="z-no">Z no *</Label>
              <Input
                id="z-no"
                inputMode="numeric"
                className="font-mono"
                value={form.zNo}
                onChange={(e) => setForm({ ...form, zNo: e.target.value.replace(/\D/g, "") })}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="z-at">Z'nin alındığı tarih ve saat *</Label>
              <Input
                id="z-at"
                type="datetime-local"
                value={form.takenAt}
                onChange={(e) => setForm({ ...form, takenAt: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="z-eku">EKÜ no</Label>
              <Input
                id="z-eku"
                className="font-mono"
                value={form.ekuNo}
                onChange={(e) => setForm({ ...form, ekuNo: e.target.value })}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="z-total">Toplam satış (KDV dahil) *</Label>
              <Input
                id="z-total"
                inputMode="decimal"
                className="font-mono text-lg"
                placeholder="0,00"
                value={form.grossTotal}
                onChange={(e) => setForm({ ...form, grossTotal: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="z-count">Fiş adedi</Label>
              <Input
                id="z-count"
                inputMode="numeric"
                value={form.receiptCount}
                onChange={(e) => setForm({ ...form, receiptCount: e.target.value.replace(/\D/g, "") })}
              />
            </div>
          </div>

          <fieldset className="grid gap-2 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">KDV kırılımı</legend>
            <div className="grid grid-cols-[4rem_1fr_1fr] gap-2 text-xs text-muted-foreground">
              <span>Oran</span>
              <span>Matrah</span>
              <span>KDV</span>
            </div>
            {form.vat.map((row, index) => {
              const suggested = n(row.base) ? moneyText(Math.round(n(row.base) * row.rate) / 100) : "0,00"
              return (
                <div key={row.rate} className="grid grid-cols-[4rem_1fr_1fr] items-center gap-2">
                  <span className="font-mono text-sm">%{row.rate}</span>
                  <Input
                    inputMode="decimal"
                    className="font-mono"
                    placeholder="0,00"
                    value={row.base}
                    onChange={(e) => setVat(index, { base: e.target.value })}
                  />
                  <Input
                    inputMode="decimal"
                    className="font-mono"
                    placeholder={suggested}
                    value={row.vat}
                    onChange={(e) => setVat(index, { vat: e.target.value })}
                  />
                </div>
              )
            })}
          </fieldset>

          <fieldset className="grid gap-2 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">Ödeme kırılımı</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {Z_PAYMENT_METHODS.map((method) => (
                <div key={method} className="grid grid-cols-[7rem_1fr] items-center gap-2">
                  <Label className="text-sm font-normal">{Z_PAYMENT_LABELS[method]}</Label>
                  <Input
                    inputMode="decimal"
                    className="font-mono"
                    placeholder="0,00"
                    value={form.payments[method]}
                    onChange={(e) => setForm({ ...form, payments: { ...form.payments, [method]: e.target.value } })}
                  />
                </div>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="z-cancel-count">İptal fiş adedi</Label>
              <Input
                id="z-cancel-count"
                inputMode="numeric"
                value={form.cancelCount}
                onChange={(e) => setForm({ ...form, cancelCount: e.target.value.replace(/\D/g, "") })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="z-cancel-total">İptal tutarı</Label>
              <Input
                id="z-cancel-total"
                inputMode="decimal"
                className="font-mono"
                placeholder="0,00"
                value={form.cancelTotal}
                onChange={(e) => setForm({ ...form, cancelTotal: e.target.value })}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="z-note">Not</Label>
            <Textarea
              id="z-note"
              rows={2}
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </div>

          {issues.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
              <p className="flex items-center gap-2 font-medium">
                <AlertTriangle className="h-4 w-4" />
                Z fişindeki rakamlar kendi içinde tutmuyor — yazım hatası olabilir
              </p>
              <ul className="mt-1 list-disc pl-6">
                {issues.map((issue) => (
                  <li key={issue.message}>{issue.message}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Vazgeç
          </Button>
          <WriteAction>
            <Button onClick={handleSave} disabled={isSaving || !form.deviceId}>
              {isSaving ? "Kaydediliyor…" : "Kaydet ve karşılaştır"}
            </Button>
          </WriteAction>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
