"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { ReadOnlyBanner } from "@/components/dashboard/write-guard"
import { cn } from "@/lib/utils"
import { DurumBekleniyor, KurulumGerekli, SayfaBasligi, useMuhasebeDurumu } from "@/components/muhasebe/ortak"
import { SmmHesabi } from "@/components/muhasebe/smm-hesabi"
import { KdvMahsubu } from "@/components/muhasebe/kdv-mahsubu"

/**
 * Ay Sonu İşlemleri — defterden türeyen aylık fişler: satılan malın maliyeti
 * (lib/muhasebe/stok-maliyeti.ts) ve KDV mahsubu (lib/muhasebe/kdv-mahsup.ts). İkisi de
 * aylar sırayla yapılır, onaylı yazılır, yalnız en son ay geri alınır. Sekme URL'de
 * (`?sekme=kdv`) — özetteki adım doğrudan ilgili sekmeye bağlanır.
 */

const SEKMELER = [
  { k: "maliyet", ad: "Satılan malın maliyeti" },
  { k: "kdv", ad: "KDV mahsubu" },
] as const

export default function AySonuPage() {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const companyId = sp.get("company")
  const sekme = sp.get("sekme") === "kdv" ? "kdv" : "maliyet"
  const { durum, hata } = useMuhasebeDurumu(companyId)

  if (!companyId) return <p className="p-6 text-sm text-kobipo-gray">Firma seçiniz.</p>
  if (durum && !durum.kurulu) return <KurulumGerekli durum={durum} />
  if (!durum) return <DurumBekleniyor hata={hata} />

  const sec = (k: string) => {
    const q = new URLSearchParams(sp.toString())
    if (k === "maliyet") q.delete("sekme")
    else q.set("sekme", k)
    router.replace(`${pathname}?${q}`, { scroll: false })
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <SayfaBasligi
        baslik="Ay Sonu İşlemleri"
        aciklama="Her ay bittikten sonra yapılan iki kayıt: satılan malın maliyeti ve KDV mahsubu. Önce o ayın fişlerini onaylayın, sonra sırayla buradan yazın."
      />
      <ReadOnlyBanner />
      <div className="flex flex-wrap gap-1.5 rounded-2xl border border-kobipo-border/90 bg-card p-1.5 shadow-card">
        {SEKMELER.map((s) => (
          <button
            key={s.k}
            type="button"
            onClick={() => sec(s.k)}
            className={cn(
              "rounded-xl px-3 py-2 text-sm font-semibold transition-colors",
              sekme === s.k ? "bg-kobipo-blue text-white" : "text-kobipo-navy hover:bg-kobipo-pale dark:text-foreground dark:hover:bg-muted",
            )}
          >
            {s.ad}
          </button>
        ))}
      </div>
      {sekme === "kdv" ? <KdvMahsubu companyId={companyId} /> : <SmmHesabi companyId={companyId} />}
    </div>
  )
}
