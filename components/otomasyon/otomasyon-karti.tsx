"use client"

import { Phone, ShieldAlert, AlertTriangle, Info } from "lucide-react"
import { CompanyLink } from "@/components/dashboard/company-link"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Kart, KartOnem } from "@/lib/otomasyon/tipler"

/**
 * Tek bir otomasyon kartı.
 *
 * RAKAMLAR SUNUCUDAN GELDİĞİ GİBİ BASILIR — burada hiçbir hesap, yuvarlama ya da
 * biçimlendirme yok. Metin `lib/otomasyon/kartlar.ts` içinde kuruldu; ikinci bir
 * biçimlendirme katmanı, aynı miktarın kartta ve stok ekranında farklı
 * görünmesi demek olurdu (`components/asistan/uyari-karti.tsx` ile aynı kural).
 *
 * Kartın uyarı sinyalinden farkı GÖVDESİNDE değil, ALTINDA: gerekçe, son tarih,
 * kimi arayacağın ve tek tıkla aksiyon. Bu dördü çıkarsa kart yine bir uyarı
 * listesine döner.
 */

const ONEM_STILI: Record<
  KartOnem,
  { ikon: typeof Info; kutu: string; rozet: string; etiket: string }
> = {
  kritik: {
    ikon: ShieldAlert,
    kutu: "border-red-200 bg-red-50/70 dark:border-red-900/50 dark:bg-red-950/25",
    rozet: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    etiket: "Acil",
  },
  yuksek: {
    ikon: AlertTriangle,
    kutu: "border-amber-200 bg-amber-50/70 dark:border-amber-900/50 dark:bg-amber-950/25",
    rozet: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
    etiket: "Öncelikli",
  },
  orta: {
    ikon: Info,
    kutu: "border-blue-200 bg-blue-50/70 dark:border-blue-900/50 dark:bg-blue-950/25",
    rozet: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    etiket: "Dikkat",
  },
  dusuk: {
    ikon: Info,
    kutu: "border-border bg-muted/40",
    rozet: "bg-muted text-muted-foreground",
    etiket: "Bilgi",
  },
}

export function OtomasyonKarti({
  kart,
  onAksiyon,
  onYokSay,
  bekliyor,
  yokSayilabilir = true,
}: {
  kart: Kart
  onAksiyon: (aksiyonAnahtari: string) => void
  onYokSay: () => void
  bekliyor?: boolean
  /** Salt-okunur yetkide false: susturma firma genelini etkiler. */
  yokSayilabilir?: boolean
}) {
  const stil = ONEM_STILI[kart.onem]
  const Ikon = stil.ikon

  return (
    <div className={cn("rounded-lg border p-3", stil.kutu)}>
      <div className="flex items-start gap-2.5">
        <Ikon className="mt-0.5 h-4 w-4 shrink-0 opacity-70" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{kart.baslik}</span>
            <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", stil.rozet)}>
              {stil.etiket}
            </span>
          </div>

          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{kart.gerekce}</p>

          {kart.sonTarih && (
            <p className="mt-1 text-xs font-medium">{kart.sonTarih}</p>
          )}

          {kart.karsiTaraf && (
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md bg-background/60 px-2 py-1.5 text-xs">
              {kart.karsiTaraf.href ? (
                <CompanyLink
                  href={kart.karsiTaraf.href}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  {kart.karsiTaraf.ad}
                </CompanyLink>
              ) : (
                <span className="font-medium">{kart.karsiTaraf.ad}</span>
              )}
              {kart.karsiTaraf.yetkili && (
                <span className="text-muted-foreground">{kart.karsiTaraf.yetkili}</span>
              )}
              {kart.karsiTaraf.telefon && (
                // tel: bağlantısı — telefondan tek dokunuşla arama. Panel içi
                // gezinme olmadığı için CompanyLink DEĞİL, düz <a>.
                <a
                  href={`tel:${kart.karsiTaraf.telefon.replace(/\s/g, "")}`}
                  className="ml-auto inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"
                >
                  <Phone className="h-3 w-3" />
                  {kart.karsiTaraf.telefon}
                </a>
              )}
            </div>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {kart.aksiyonlar.map((a) =>
              a.href ? (
                <Button
                  key={a.anahtar}
                  asChild
                  size="sm"
                  variant={a.birincil ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => onAksiyon(a.anahtar)}
                >
                  <CompanyLink href={a.href}>{a.etiket}</CompanyLink>
                </Button>
              ) : (
                <Button
                  key={a.anahtar}
                  size="sm"
                  variant={a.birincil ? "default" : "outline"}
                  className="h-7 text-xs"
                  onClick={() => onAksiyon(a.anahtar)}
                >
                  {a.etiket}
                </Button>
              )
            )}
            {yokSayilabilir && (
              <button
                type="button"
                onClick={onYokSay}
                disabled={bekliyor}
                className="ml-auto text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
              >
                Yok say
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
