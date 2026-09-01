"use client"

import { useCallback, useEffect, useState, type RefObject } from "react"
import {
  computeAnchoredRect,
  type AnchoredMenuOptions,
  type AnchoredRect,
} from "@/lib/ui/anchored-menu"

/**
 * Portal ile basılan açılır listenin konumunu girdiye yapışık tutar ve dışarı
 * tıklamayı yakalar.
 *
 * Neden ortak: aynı konumlandırma ProductCombobox'ın İKİ ayrı kopyasında
 * duruyordu; biri düzeltildi (fatura ekranı), diğeri (`components/ui/…`,
 * irsaliye/sipariş/teklif ekranları) eski dar/kırpılan haliyle kaldı. Ölçüm
 * mantığı `lib/ui/anchored-menu.ts`te ve testli.
 */
export function useAnchoredMenu({
  open,
  anchorRef,
  menuRef,
  containerRef,
  onOutsideClick,
  ...options
}: {
  open: boolean
  /** Listenin yapışacağı öğe (girdi). */
  anchorRef: RefObject<HTMLElement | null>
  /** Portal'daki liste — dışarı tıklama denetimi bunu da hesaba katar. */
  menuRef: RefObject<HTMLElement | null>
  /** Girdiyi saran kap; verilmezse girdinin kendisi kullanılır. */
  containerRef?: RefObject<HTMLElement | null>
  onOutsideClick: () => void
} & AnchoredMenuOptions): AnchoredRect | null {
  const [rect, setRect] = useState<AnchoredRect | null>(null)
  const { minWidth, maxHeight, margin, flipThreshold } = options

  const updateRect = useCallback(() => {
    const el = anchorRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setRect(
      computeAnchoredRect(
        { top: r.top, bottom: r.bottom, left: r.left, width: r.width },
        { width: window.innerWidth, height: window.innerHeight },
        { minWidth, maxHeight, margin, flipThreshold }
      )
    )
  }, [anchorRef, minWidth, maxHeight, margin, flipThreshold])

  useEffect(() => {
    if (!open) return
    updateRect()
    const onMove = () => updateRect()
    // capture: liste, iç scroll'u olan bir kap içindeyken de girdiye yapışık kalsın.
    window.addEventListener("scroll", onMove, true)
    window.addEventListener("resize", onMove)
    return () => {
      window.removeEventListener("scroll", onMove, true)
      window.removeEventListener("resize", onMove)
    }
  }, [open, updateRect])

  useEffect(() => {
    if (!open) return
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node
      const inside = containerRef?.current ?? anchorRef.current
      // Liste portal ile body'de: yalnız kaba bakmak yetmez, tıklama "dışarı" sayılırdı.
      if (!inside?.contains(target) && !menuRef.current?.contains(target)) {
        onOutsideClick()
      }
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open, anchorRef, containerRef, menuRef, onOutsideClick])

  return rect
}
