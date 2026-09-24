"use client"

// Fiş detayındaki "Yazarkasa" alanı: fişin ÖKC kimliğini gösterir, isteğe bağlı
// elle düzenletir. Plan: docs/okc/ASAMA1-KOBIPO.md A3 (K2).
//
// Cihazdan gelen kimlik (source = DEVICE) salt okunur. Şubede hiç yazarkasa
// tanımlı değilse düzenleme düğmesi yerine tanım ekranına yönlendirilir.

import { useEffect, useState } from "react"
import { Pencil } from "lucide-react"
import { WriteAction } from "@/components/dashboard/write-guard"
import { CompanyLink } from "@/components/dashboard/company-link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import type { OkcDeviceView } from "@/lib/okc/devices"

export type ReceiptOkc = {
  deviceId: string | null
  deviceName: string | null
  receiptNo: number | null
  zNo: number | null
  source: string | null
}

const NONE = "__none__"

export function describeReceiptOkc(okc: ReceiptOkc): string | null {
  const parts = [
    okc.deviceName,
    okc.receiptNo != null ? `ÖKC fiş ${okc.receiptNo}` : null,
    okc.zNo != null ? `Z ${okc.zNo}` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(" · ") : null
}

export function ReceiptOkcEditor({
  companyId,
  receiptId,
  value,
  disabled,
  onChange,
}: {
  companyId: string
  receiptId: string
  value: ReceiptOkc
  /** İptal edilmiş fiş: yalnız gösterilir. */
  disabled?: boolean
  onChange: (next: ReceiptOkc) => void
}) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [devices, setDevices] = useState<OkcDeviceView[] | null>(null)
  const [form, setForm] = useState({ deviceId: NONE, receiptNo: "", zNo: "" })
  const [isSaving, setIsSaving] = useState(false)

  // Pencere her açılışta kayıtlı değerle başlar.
  useEffect(() => {
    if (!open) return
    setForm({
      deviceId: value.deviceId ?? NONE,
      receiptNo: value.receiptNo == null ? "" : String(value.receiptNo),
      zNo: value.zNo == null ? "" : String(value.zNo),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Cihaz listesi ilk açılışta bir kez gelir.
  useEffect(() => {
    if (!open || devices !== null) return
    fetch(`/api/okc/devices?companyId=${encodeURIComponent(companyId)}`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : []))
      .then((list: OkcDeviceView[]) => {
        setDevices(list)
        // Tek aktif cihaz varsa ve henüz seçim yoksa o seçili gelsin.
        const active = list.filter((d) => d.isActive)
        if (active.length === 1) {
          setForm((f) => (f.deviceId === NONE ? { ...f, deviceId: active[0].id } : f))
        }
      })
      .catch(() => setDevices([]))
  }, [open, companyId, devices])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const res = await fetch(`/api/fisler/${encodeURIComponent(receiptId)}/okc`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          deviceId: form.deviceId === NONE ? null : form.deviceId,
          receiptNo: form.receiptNo,
          zNo: form.zNo,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "Kaydedilemedi")
      onChange(data)
      setOpen(false)
      toast({ title: "Kaydedildi", description: "Yazarkasa bilgisi güncellendi" })
    } catch (e) {
      toast({ title: "Hata", description: e instanceof Error ? e.message : "Bilinmeyen hata", variant: "destructive" })
    } finally {
      setIsSaving(false)
    }
  }

  const text = describeReceiptOkc(value)
  const fromDevice = value.source === "DEVICE"

  return (
    <div>
      <p className="text-muted-foreground">Yazarkasa</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <p className="font-medium">{text ?? <span className="font-normal text-muted-foreground">Girilmedi</span>}</p>
        {fromDevice && <span className="text-xs text-muted-foreground">(cihazdan)</span>}
        {!fromDevice && !disabled && (
          <WriteAction>
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setOpen(true)}>
              <Pencil className="mr-1 h-3.5 w-3.5" />
              {text ? "Düzenle" : "Ekle"}
            </Button>
          </WriteAction>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Yazarkasa bilgisi</DialogTitle>
            <DialogDescription>
              Bu satışın yazarkasadan basılan fişindeki numaralar. Girmek zorunlu değil; girilirse Z raporu
              karşılaştırmasında fiş doğrudan o Z'ye sayılır.
            </DialogDescription>
          </DialogHeader>
          {devices !== null && devices.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">
              Bu şubede tanımlı yazarkasa yok.{" "}
              <CompanyLink href="/ayarlar/yazarkasa" className="font-medium text-primary underline-offset-4 hover:underline">
                Yazarkasa ekleyin
              </CompanyLink>
              .
            </p>
          ) : (
            <div className="grid gap-3 py-2">
              <div className="grid gap-2">
                <Label>Yazarkasa</Label>
                <Select value={form.deviceId} onValueChange={(deviceId) => setForm({ ...form, deviceId })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Seçilmedi</SelectItem>
                    {(devices ?? []).map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.name} · {d.serialNo}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="okc-receipt-no">ÖKC fiş no</Label>
                  <Input
                    id="okc-receipt-no"
                    inputMode="numeric"
                    className="font-mono"
                    value={form.receiptNo}
                    onChange={(e) => setForm({ ...form, receiptNo: e.target.value.replace(/\D/g, "") })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="okc-z-no">Z no</Label>
                  <Input
                    id="okc-z-no"
                    inputMode="numeric"
                    className="font-mono"
                    value={form.zNo}
                    onChange={(e) => setForm({ ...form, zNo: e.target.value.replace(/\D/g, "") })}
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isSaving}>
              Vazgeç
            </Button>
            <WriteAction>
              <Button onClick={handleSave} disabled={isSaving || devices === null || devices.length === 0}>
                {isSaving ? "Kaydediliyor…" : "Kaydet"}
              </Button>
            </WriteAction>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
