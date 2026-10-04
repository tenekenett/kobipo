"use client"

import { useCallback, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { muhasebeIstegi } from "@/components/muhasebe/ortak"

/**
 * Mutabakat döngüsü — belge ile fişi karşılaştırıp eksik/eskimiş fişleri üretir.
 * Sunucu her istekte en çok `limit` eylem uygular (sunucusuz süre sınırı); bu kanca
 * `kalan` sıfırlanana kadar tekrarlar ve ilerlemeyi tutar.
 */

export type SenkronOzeti = {
  acilan: number
  yenilenen: number
  silinen: number
  isaretlenen: number
  kalan: number
  kurYok: Array<{ tip: string; id: string; sebep: string }>
  kilitli: Array<{ tip: string; id: string }>
}

export function useMutabakat(companyId: string | null) {
  const [calisiyor, setCalisiyor] = useState(false)
  const [ilerleme, setIlerleme] = useState<{ yapilan: number; kalan: number } | null>(null)
  const [ozet, setOzet] = useState<SenkronOzeti | null>(null)
  const [hata, setHata] = useState<string | null>(null)
  const kilit = useRef(false)

  const calistir = useCallback(
    async (opts: { acilis?: boolean } = {}): Promise<SenkronOzeti | null> => {
      if (!companyId || kilit.current) return null
      kilit.current = true
      setCalisiyor(true)
      setHata(null)
      const toplam: SenkronOzeti = { acilan: 0, yenilenen: 0, silinen: 0, isaretlenen: 0, kalan: 0, kurYok: [], kilitli: [] }
      try {
        let ilk = true
        for (let tur = 0; tur < 200; tur++) {
          const r = await muhasebeIstegi<SenkronOzeti>("/api/muhasebe/mutabakat", {
            method: "POST",
            body: JSON.stringify({ companyId, acilis: ilk && opts.acilis === true, limit: 150 }),
          })
          ilk = false
          toplam.acilan += r.acilan
          toplam.yenilenen += r.yenilenen
          toplam.silinen += r.silinen
          toplam.isaretlenen += r.isaretlenen
          toplam.kurYok = r.kurYok
          toplam.kilitli = r.kilitli
          toplam.kalan = r.kalan
          setIlerleme({ yapilan: toplam.acilan + toplam.yenilenen + toplam.silinen + toplam.isaretlenen, kalan: r.kalan })
          // İlerleme yoksa (her eylem çakıştı/atlandı) sonsuz döngüye girme.
          if (r.kalan === 0 || r.acilan + r.yenilenen + r.silinen + r.isaretlenen === 0) break
        }
        setOzet(toplam)
        return toplam
      } catch (e) {
        setHata(e instanceof Error ? e.message : String(e))
        return null
      } finally {
        kilit.current = false
        setCalisiyor(false)
      }
    },
    [companyId],
  )

  return { calistir, calisiyor, ilerleme, ozet, hata }
}

export function MutabakatIlerlemesi({
  calisiyor,
  ilerleme,
}: {
  calisiyor: boolean
  ilerleme: { yapilan: number; kalan: number } | null
}) {
  if (!calisiyor) return null
  const toplam = (ilerleme?.yapilan ?? 0) + (ilerleme?.kalan ?? 0)
  const yuzde = toplam > 0 ? Math.round(((ilerleme?.yapilan ?? 0) / toplam) * 100) : 0
  return (
    <div className="flex items-center gap-3 rounded-xl bg-kobipo-offwhite px-3 py-2 text-sm text-kobipo-navy dark:bg-muted/40 dark:text-foreground">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      <span>
        Belgeler fişlerle eşleştiriliyor
        {toplam > 0 ? ` — ${ilerleme?.yapilan} / ${toplam}` : "…"}
      </span>
      {toplam > 0 && (
        <span className="h-1.5 w-32 overflow-hidden rounded-full bg-kobipo-border">
          <span className="block h-full bg-kobipo-blue transition-all" style={{ width: `${yuzde}%` }} />
        </span>
      )}
    </div>
  )
}

/** Mutabakat özetinin tek cümlesi. */
export function ozetMetni(o: SenkronOzeti): string {
  const parca: string[] = []
  if (o.acilan) parca.push(`${o.acilan} yeni taslak fiş`)
  if (o.yenilenen) parca.push(`${o.yenilenen} fiş belgesiyle güncellendi`)
  if (o.silinen) parca.push(`${o.silinen} taslak kaldırıldı (belge iptal/silindi)`)
  if (o.isaretlenen) parca.push(`${o.isaretlenen} onaylı fişin belgesi değişti`)
  return parca.length ? parca.join(" · ") : "Fişler belgelerle eşleşiyor."
}
