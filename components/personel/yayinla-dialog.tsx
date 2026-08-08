"use client"

/**
 * Haftalık planı yayınlama penceresi.
 *
 * "Yayınla" iki ayrı şey yapar ve ikisi de kullanıcıya AÇIKÇA söylenir: haftayı
 * kesinleştirir ve (isteğe bağlı) personele e-posta atar. Tek düğmede birleştirip
 * sessizce e-posta göndermek, planı denemek için yayınlayan yöneticiye habersiz
 * on beş e-posta attırırdı.
 */

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { AlertTriangle, Loader2, MailWarning, Send } from "lucide-react"

export function YayinlaDialog({
  open,
  weekLabel,
  shiftCount,
  employeesWithoutEmail,
  isPublished,
  isSaving,
  onClose,
  onPublish,
}: {
  open: boolean
  weekLabel: string
  shiftCount: number
  /** Bu haftada vardiyası olup e-posta adresi girilmemiş personel sayısı. */
  employeesWithoutEmail: number
  isPublished: boolean
  isSaving: boolean
  onClose: () => void
  onPublish: (notify: boolean) => void
}) {
  const [notify, setNotify] = useState(true)

  if (!open) return null

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isPublished ? "Planı yeniden yayınla" : "Planı yayınla"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{weekLabel}</span> haftası
            kesinleştirilecek. Bu hafta için <span className="font-semibold text-foreground">{shiftCount}</span>{" "}
            vardiya planlanmış.
          </p>

          <div className="flex items-center justify-between rounded-lg border border-border/70 px-3 py-2">
            <div className="pr-3">
              <p className="text-sm font-medium">Personele e-posta gönder</p>
              <p className="text-xs text-muted-foreground">
                Herkes yalnız kendi vardiyalarını görür.
              </p>
            </div>
            <Switch checked={notify} onCheckedChange={setNotify} />
          </div>

          {notify && employeesWithoutEmail > 0 && (
            <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
              <MailWarning className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                {employeesWithoutEmail} personelin e-posta adresi girilmemiş; onlara gönderim
                yapılamayacak. Adresleri personel kartından ekleyebilirsiniz.
              </span>
            </p>
          )}

          {isPublished && (
            <p className="flex items-start gap-2 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Bu hafta daha önce yayınlanmıştı. Yeniden yayınlamak plan değişikliklerini
                kesinleştirir; e-posta açıksa personel güncel planı yeniden alır.
              </span>
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Vazgeç
          </Button>
          <Button onClick={() => onPublish(notify)} disabled={isSaving || shiftCount === 0}>
            {isSaving ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-1 h-4 w-4" />
            )}
            {notify ? "Yayınla ve gönder" : "Yayınla"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
