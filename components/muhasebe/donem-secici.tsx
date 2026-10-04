"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/**
 * Defter ekranlarının dönem seçicisi. Dönem URL'de durur (`bas`, `bit`; `?company=`
 * korunur) — mizandan kebire geçerken aynı dönem taşınır.
 */

const iso = (d: Date) => d.toISOString().slice(0, 10)

/** İstanbul takvimiyle bugün (00:00 UTC olarak). */
function bugun(): Date {
  const t = new Date(Date.now() + 3 * 3_600_000)
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()))
}

export function hazirDonemler() {
  const b = bugun()
  const y = b.getUTCFullYear()
  const m = b.getUTCMonth()
  return [
    { ad: "Bu ay", bas: iso(new Date(Date.UTC(y, m, 1))), bit: iso(new Date(Date.UTC(y, m + 1, 0))) },
    { ad: "Geçen ay", bas: iso(new Date(Date.UTC(y, m - 1, 1))), bit: iso(new Date(Date.UTC(y, m, 0))) },
    { ad: "Bu yıl", bas: `${y}-01-01`, bit: `${y}-12-31` },
    { ad: "Geçen yıl", bas: `${y - 1}-01-01`, bit: `${y - 1}-12-31` },
  ]
}

/** URL'deki dönem; yoksa içinde bulunulan yıl. */
export function useDonem(): { bas: string; bit: string } {
  const sp = useSearchParams()
  const varsayilan = hazirDonemler()[2]
  return { bas: sp.get("bas") || varsayilan.bas, bit: sp.get("bit") || varsayilan.bit }
}

export function DonemSecici() {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const { bas, bit } = useDonem()
  const ayarla = (b: string, e: string) => {
    const q = new URLSearchParams(sp.toString())
    q.set("bas", b)
    q.set("bit", e)
    q.delete("sayfa")
    router.replace(`${pathname}?${q}`, { scroll: false })
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex flex-wrap gap-1">
        {hazirDonemler().map((d) => (
          <button
            key={d.ad}
            type="button"
            onClick={() => ayarla(d.bas, d.bit)}
            className={cn(
              "rounded-lg px-2.5 py-1.5 text-xs font-semibold",
              d.bas === bas && d.bit === bit
                ? "bg-kobipo-blue text-white"
                : "bg-kobipo-offwhite text-kobipo-navy hover:bg-kobipo-pale dark:bg-muted/40 dark:text-foreground",
            )}
          >
            {d.ad}
          </button>
        ))}
      </div>
      <Input type="date" value={bas} onChange={(e) => e.target.value && ayarla(e.target.value, bit)} className="w-40" aria-label="Başlangıç" />
      <span className="text-kobipo-gray">–</span>
      <Input type="date" value={bit} onChange={(e) => e.target.value && ayarla(bas, e.target.value)} className="w-40" aria-label="Bitiş" />
    </div>
  )
}
