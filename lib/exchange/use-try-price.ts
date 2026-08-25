"use client"

// Tezgâh ekranlarının ortak döviz kuralının TEK tanımı.
//
// Ürün kartındaki fiyat USD/EUR olabilir; hızlı satış, hızlı alış, kahveci satışı
// ve adisyon ise fişi DAİMA TRY keser. Çevrim yapılmazsa 100 $'lık ürün 100 ₺'ye
// satılır — şikâyetin aslı buydu. Dört ekran aynı kuralı ayrı ayrı yazsaydı biri
// kur hatasını farklı karşıladığı an aynı ürün iki tezgâhta iki fiyata giderdi
// (use-table-opener.ts'in ortak olma gerekçesinin aynısı).

import { useCallback } from "react"
import { useToast } from "@/components/ui/use-toast"
import { formatMoney } from "@/lib/format"
import { useTcmbRates } from "./use-rates"

export function useTryPrice() {
  const { toast } = useToast()
  const { rates, convert } = useTcmbRates()

  /**
   * `amount`ı ürünün para biriminden TRY'ye çevirir ve kullanıcıya söyler.
   *
   * KUR ALINAMAZSA 0 döner: fiyat boş kalır, kasiyer elle girmek zorundadır.
   * Teklif ekranı (components/teklif/quote-lines.tsx) bilinçli olarak farklı
   * davranır — orada fiyat çevrilmeden eklenir ve uyarılır. Fark kasıtlı: teklifi
   * hazırlayan rakamı görüp düzeltir, tezgâhtaki kasiyer uyarıyı kaçırırsa mal
   * 1 $ = 1 ₺'den gider.
   */
  const toTRY = useCallback(
    (amount: number, currency: string | null | undefined, productName: string): number => {
      const cur = (currency || "TRY").toUpperCase()
      if (cur === "TRY" || !amount) return amount
      const tl = convert(amount, cur, "TRY")
      if (tl == null) {
        toast({
          title: "Kur alınamadı",
          description: `${productName} fiyatı ${cur} cinsinden; güncel kur alınamadığı için fiyat boş bırakıldı, elle girin.`,
          variant: "destructive",
        })
        return 0
      }
      toast({
        title: "Döviz çevrildi",
        description: `${productName}: ${formatMoney(amount, cur)} → ${formatMoney(Math.round(tl * 100) / 100, "TRY")}`,
      })
      // 6 hane: UBL birim fiyat hassasiyeti (bkz. StockMovement.unitPrice).
      return Math.round(tl * 1e6) / 1e6
    },
    [convert, toast],
  )

  return { toTRY, convert, rates }
}
