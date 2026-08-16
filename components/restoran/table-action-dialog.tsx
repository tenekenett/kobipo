"use client"

// Belirsiz durumdaki masaya dokunulunca çıkan seçim diyaloğu — salon planı ve
// masa listesi ORTAK kullanır (bkz. lib/restoran/use-table-opener.ts).
//
// "Belirsiz" iki durumdur: masa temizlenmedi ya da yaklaşan rezervasyonu var.
// İkisi de adisyon açmayı ENGELLEMEZ, yalnız hangisinin kastedildiğini sorar —
// rezerve masaya gelen geçen müşteriyi sessizce oturtmak rezervasyonu yakardı.

import { Plus, Sparkles, Users } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { elapsedLabel } from "@/components/restoran/floor-plan-canvas"
import type { PlanTable } from "@/lib/swr/use-restoran"

export function TableActionDialog({
  table,
  now,
  onClose,
  onOpenTicket,
  onMarkCleaned,
  onMarkNoShow,
}: {
  /** Açık diyaloğun masası; null ise diyalog kapalı. */
  table: PlanTable | null
  /** Dışarıdan gelen "şimdi" — süre etiketi saniyede bir yeniden hesaplanmasın. */
  now: number
  onClose: () => void
  onOpenTicket: (table: PlanTable, reservationId?: string) => void
  onMarkCleaned: (table: PlanTable) => void
  onMarkNoShow: (table: PlanTable) => void
}) {
  return (
    <Dialog open={table !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{table?.name}</DialogTitle>
          <DialogDescription>
            {table?.reservation
              ? `${table.reservation.guestName} adına ${new Date(
                  table.reservation.reservedAt,
                ).toLocaleTimeString("tr-TR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })} rezervasyonu var${
                  table.reservation.guestCount ? ` (${table.reservation.guestCount} kişi)` : ""
                }.`
              : table?.cleaningSince
                ? `Hesap ${elapsedLabel(table.cleaningSince, now)} önce kapandı, masa henüz temizlenmedi.`
                : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {table?.reservation && (
            <Button
              className="w-full justify-start"
              onClick={() => {
                onClose()
                onOpenTicket(table, table.reservation!.id)
              }}
            >
              <Users className="mr-2 h-4 w-4" />
              Rezervasyonu oturt ve adisyon aç
            </Button>
          )}
          {table?.cleaningSince && (
            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => {
                onClose()
                onMarkCleaned(table)
              }}
            >
              <Sparkles className="mr-2 h-4 w-4" />
              Masa temizlendi
            </Button>
          )}
          <Button
            variant={table?.reservation ? "outline" : "default"}
            className="w-full justify-start"
            onClick={() => {
              if (!table) return
              onClose()
              onOpenTicket(table)
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            {table?.reservation ? "Rezervasyonsuz adisyon aç" : "Yeni adisyon aç"}
          </Button>
          {table?.reservation && (
            <Button
              variant="ghost"
              className="w-full justify-start text-muted-foreground"
              onClick={() => {
                onClose()
                onMarkNoShow(table)
              }}
            >
              Misafir gelmedi
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
