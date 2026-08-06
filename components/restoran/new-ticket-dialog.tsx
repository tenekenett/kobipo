"use client"

// Yeni adisyon — masa OPSİYONEL.
//
// Salon planından adisyon açmak masayı zorunlu kılar (masaya dokunursun, açılır).
// Paket/gel-al ve "masayı sonra veririm" halleri oradan geçemiyordu; bu diyalog
// adisyon listesinin girişidir: masa seçilirse masalı, seçilmezse masasız açılır.
//
// Dolu masa listede DURUR ama seçilemez: kaybolsaydı kullanıcı masayı arar,
// bulamaz ve silinmiş sanırdı. Yine de sunucu 409'u ele alınıyor — araya başka
// bir garson girip aynı masayı açtıysa kullanıcı hataya değil, o adisyona düşer.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
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
import { useToast } from "@/components/ui/use-toast"
import { withCompanyHref } from "@/lib/company/href"
import type { PlanTable } from "@/lib/swr/use-restoran"

const NO_TABLE = "__NONE__"

interface NewTicketDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string
  tables: PlanTable[]
  /** Adisyon açıldıktan sonra liste tazelensin (yeni satır hemen görünsün). */
  onCreated: () => void
}

export function NewTicketDialog({
  open,
  onOpenChange,
  companyId,
  tables,
  onCreated,
}: NewTicketDialogProps) {
  const router = useRouter()
  const { toast } = useToast()

  const [tableId, setTableId] = useState(NO_TABLE)
  const [guestCount, setGuestCount] = useState("")
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)

  const reset = () => {
    setTableId(NO_TABLE)
    setGuestCount("")
    setNote("")
  }

  const create = async () => {
    setSaving(true)
    try {
      const res = await fetch("/api/restoran/adisyonlar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          tableId: tableId === NO_TABLE ? null : tableId,
          guestCount: guestCount ? Number(guestCount) : null,
          note: note.trim() || null,
        }),
      })
      const body = await res.json().catch(() => ({}))

      // 409 = masayı bu arada başkası açtı; sunucu mevcut adisyonu döndürüyor.
      if (res.status === 409 && body?.ticket?.id) {
        toast({
          title: "Masada zaten açık adisyon var",
          description: "Mevcut adisyon açılıyor.",
        })
        reset()
        onOpenChange(false)
        onCreated()
        router.push(withCompanyHref(`/restoran/adisyon/${body.ticket.id}`, companyId))
        return
      }
      if (!res.ok) throw new Error(body?.error || "Adisyon açılamadı")

      reset()
      onOpenChange(false)
      onCreated()
      router.push(withCompanyHref(`/restoran/adisyon/${body.id}`, companyId))
    } catch (e: any) {
      toast({ title: "Adisyon açılamadı", description: e.message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const selectable = tables.filter((t) => t.isActive)

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset()
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Yeni adisyon</DialogTitle>
          <DialogDescription>
            Masa seçmek zorunlu değil — seçilmezse adisyon paket / gel-al olarak açılır.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label>Masa (opsiyonel)</Label>
            <Select value={tableId} onValueChange={setTableId}>
              <SelectTrigger className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_TABLE}>Masasız — Paket / Gel-al</SelectItem>
                {selectable.map((t) => (
                  <SelectItem key={t.id} value={t.id} disabled={!!t.openTicket}>
                    {t.name}
                    {t.areaName ? ` · ${t.areaName}` : ""}
                    {t.capacity ? ` · ${t.capacity} kişi` : ""}
                    {t.openTicket ? " · dolu" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Kişi (opsiyonel)</Label>
              <Input
                type="number"
                min={1}
                value={guestCount}
                onChange={(e) => setGuestCount(e.target.value)}
                placeholder="4"
                className="mt-1.5"
              />
            </div>
            <div>
              <Label>Not (opsiyonel)</Label>
              <Input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ahmet Bey · paket"
                className="mt-1.5"
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Vazgeç
          </Button>
          <Button onClick={() => void create()} disabled={saving}>
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Adisyonu aç
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
