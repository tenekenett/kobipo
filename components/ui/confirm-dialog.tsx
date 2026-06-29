"use client"

import * as React from "react"
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

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: React.ReactNode
  /** Onay butonu metni. Varsayılan: "Onayla". */
  confirmLabel?: string
  /** Vazgeç butonu metni. Varsayılan: "Vazgeç". */
  cancelLabel?: string
  /** "destructive" → kırmızı onay butonu (silme/iptal gibi geri alınamaz işlemler). */
  variant?: "default" | "destructive"
  /** İşlem sürüyor: onay butonunda spinner + butonlar pasif. */
  isProcessing?: boolean
  /** Ek koşul (ör. zorunlu alan boş) sağlanmazsa onayı engelle. */
  confirmDisabled?: boolean
  onConfirm: () => void
  /** Başlığın yanında gösterilecek ikon (opsiyonel). */
  icon?: React.ReactNode
  /** Açıklama ile butonlar arasına yerleşen ek içerik (ör. sebep girişi). */
  children?: React.ReactNode
}

/**
 * Uygulama geneli stillenmiş onay diyaloğu — tarayıcının dümdüz `window.confirm`
 * kutusunun yerine. Silme/iptal gibi geri alınamaz işlemler için `variant="destructive"`
 * kullanın. İsteğe bağlı `children` ile ek alan (ör. iptal sebebi) gömülebilir.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Onayla",
  cancelLabel = "Vazgeç",
  variant = "default",
  isProcessing = false,
  confirmDisabled = false,
  onConfirm,
  icon,
  children,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !isProcessing && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {icon}
            {title}
          </DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        {children}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isProcessing}>
            {cancelLabel}
          </Button>
          <Button
            variant={variant}
            onClick={onConfirm}
            disabled={isProcessing || confirmDisabled}
          >
            {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
