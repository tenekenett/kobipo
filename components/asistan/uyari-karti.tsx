"use client"

import { useState } from "react"
import { AlertTriangle, ChevronDown, Info, ShieldAlert } from "lucide-react"
import { CompanyLink } from "@/components/dashboard/company-link"
import { cn } from "@/lib/utils"
import type { Sinyal, SinyalOnem } from "@/lib/asistan/tipler"

/**
 * Tek bir uyarı sinyalinin kartı.
 *
 * Rakamlar SUNUCUDAN GELDİĞİ GİBİ basılır — burada hiçbir hesap, yuvarlama ya da
 * biçimlendirme yok. Biçim `lib/asistan/sinyaller.ts` içinde, `lib/format.ts`in
 * ortak yardımcılarıyla verildi; ikinci bir biçimlendirme katmanı, aynı tutarın
 * kartta ve sohbette farklı görünmesi demek olurdu.
 */

const ONEM_STILI: Record<
  SinyalOnem,
  { ikon: typeof Info; kutu: string; rozet: string; etiket: string }
> = {
  kritik: {
    ikon: ShieldAlert,
    kutu: "border-red-200 bg-red-50/70 dark:border-red-900/50 dark:bg-red-950/25",
    rozet: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    etiket: "Acil",
  },
  uyari: {
    ikon: AlertTriangle,
    kutu: "border-amber-200 bg-amber-50/70 dark:border-amber-900/50 dark:bg-amber-950/25",
    rozet: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    etiket: "Dikkat",
  },
  bilgi: {
    ikon: Info,
    kutu: "border-blue-200 bg-blue-50/70 dark:border-blue-900/50 dark:bg-blue-950/25",
    rozet: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    etiket: "Bilgi",
  },
}

export function UyariKarti({ sinyal }: { sinyal: Sinyal }) {
  const [acik, setAcik] = useState(sinyal.onem === "kritik")
  const stil = ONEM_STILI[sinyal.onem]
  const Ikon = stil.ikon
  const gizli = sinyal.toplam - sinyal.satirlar.length

  return (
    <div className={cn("rounded-lg border", stil.kutu)}>
      <button
        type="button"
        onClick={() => setAcik((o) => !o)}
        className="flex w-full items-start gap-2.5 p-3 text-left"
        aria-expanded={acik}
      >
        <Ikon className="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-sm font-semibold">{sinyal.baslik}</span>
            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", stil.rozet)}>
              {stil.etiket}
            </span>
          </span>
          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
            {sinyal.ozet}
          </span>
        </span>
        <ChevronDown
          className={cn("mt-0.5 h-4 w-4 shrink-0 opacity-50 transition-transform", acik && "rotate-180")}
        />
      </button>

      {acik && (
        <ul className="border-t border-black/5 px-3 py-2 dark:border-white/10">
          {sinyal.satirlar.map((satir, i) => (
            <li key={`${satir.baslik}-${i}`} className="py-1.5 text-xs">
              {satir.href ? (
                <CompanyLink
                  href={satir.href}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {satir.baslik}
                </CompanyLink>
              ) : (
                <span className="font-medium">{satir.baslik}</span>
              )}
              <span className="mt-0.5 block text-muted-foreground">{satir.detay}</span>
            </li>
          ))}
          {gizli > 0 && (
            <li className="py-1.5 text-xs text-muted-foreground">
              +{gizli} tane daha — asistana &quot;hepsini listele&quot; diye sorabilirsin.
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
