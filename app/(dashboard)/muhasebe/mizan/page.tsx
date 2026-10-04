"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"
import { withCompanyHref } from "@/lib/company/href"
import { cn } from "@/lib/utils"
import {
  KurulumGerekli,
  SayfaBasligi,
  Uyari,
  muhasebeIstegi,
  tutar,
  tutarSifirli,
  useMuhasebeDurumu,
} from "@/components/muhasebe/ortak"
import { DonemSecici, useDonem } from "@/components/muhasebe/donem-secici"

/**
 * Mizan — hesap başına devir, dönem, toplam ve bakiye (plan §2.6). Yalnız onaylı
 * fişler; "taslaklar dahil" ön izleme içindir. Satıra tıklayınca kebir açılır.
 * Kural: lib/muhasebe/mizan.ts (alt hesap → sınıf toplaması, borç = alacak denetimi).
 */

type MizanSatiri = {
  kod: string
  ad: string
  duzey: number
  devirBorc: number
  devirAlacak: number
  donemBorc: number
  donemAlacak: number
  toplamBorc: number
  toplamAlacak: number
  bakiyeBorc: number
  bakiyeAlacak: number
  tersBakiye: boolean
}
type Toplam = Omit<MizanSatiri, "kod" | "ad" | "duzey" | "tersBakiye">

const DUZEYLER = [
  { k: "3", ad: "Defteri kebir" },
  { k: "detay", ad: "Alt hesaplarla" },
  { k: "1", ad: "Sınıf" },
  { k: "2", ad: "Grup" },
] as const

export default function MizanPage() {
  const sp = useSearchParams()
  const router = useRouter()
  const companyId = sp.get("company")
  const { bas, bit } = useDonem()
  const { durum } = useMuhasebeDurumu(companyId)
  const [duzey, setDuzey] = useState<(typeof DUZEYLER)[number]["k"]>("3")
  const [taslak, setTaslak] = useState(false)
  const [veri, setVeri] = useState<{ satirlar: MizanSatiri[]; toplamlar: Record<string, Toplam> } | null>(null)
  const [hata, setHata] = useState<string | null>(null)
  const [yukleniyor, setYukleniyor] = useState(false)

  useEffect(() => {
    if (!companyId || !durum?.kurulu) return
    setYukleniyor(true)
    const q = new URLSearchParams({ companyId, bas, bit, ...(taslak ? { taslak: "1" } : {}) })
    muhasebeIstegi<{ satirlar: MizanSatiri[]; toplamlar: Record<string, Toplam> }>(`/api/muhasebe/mizan?${q}`)
      .then((v) => {
        setVeri(v)
        setHata(null)
      })
      .catch((e) => setHata(e instanceof Error ? e.message : String(e)))
      .finally(() => setYukleniyor(false))
  }, [companyId, durum?.kurulu, bas, bit, taslak])

  const satirlar = useMemo(() => {
    const t = veri?.satirlar ?? []
    if (duzey === "detay") return t.filter((s) => s.duzey >= 3)
    return t.filter((s) => s.duzey === Number(duzey))
  }, [veri, duzey])

  if (!companyId) return <p className="p-6 text-sm text-kobipo-gray">Firma seçiniz.</p>
  if (durum && !durum.kurulu) return <KurulumGerekli durum={durum} />

  // Dip toplam gösterilen düzeyden (aynı düzeyin satırları çakışmaz); borç = alacak denetimi
  // her zaman defteri kebir düzeyinden — sunucunun hesapladığı.
  const r2 = (n: number) => Math.round(n * 100) / 100
  const toplam: Toplam | null =
    duzey === "detay" || satirlar.length === 0
      ? null
      : (["devirBorc", "devirAlacak", "donemBorc", "donemAlacak", "toplamBorc", "toplamAlacak", "bakiyeBorc", "bakiyeAlacak"] as const).reduce(
          (acc, k) => ({ ...acc, [k]: r2(satirlar.reduce((a, x) => a + x[k], 0)) }),
          {} as Toplam,
        )
  const kebirToplam = veri?.toplamlar["3"]
  const dengeli = kebirToplam ? kebirToplam.toplamBorc === kebirToplam.toplamAlacak : true

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <SayfaBasligi
        baslik="Mizan"
        aciklama="Onaylanmış fişlerden hesap başına devir, dönem hareketi ve bakiye. Hesaba tıklayınca kebir (hesap dökümü) açılır."
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DonemSecici />
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-xl bg-kobipo-offwhite p-1 dark:bg-muted/40">
            {DUZEYLER.map((d) => (
              <button
                key={d.k}
                type="button"
                onClick={() => setDuzey(d.k)}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-xs font-semibold",
                  duzey === d.k ? "bg-card text-kobipo-navy shadow-sm dark:text-foreground" : "text-kobipo-gray",
                )}
              >
                {d.ad}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-kobipo-navy dark:text-foreground">
            <input type="checkbox" checked={taslak} onChange={(e) => setTaslak(e.target.checked)} />
            Taslaklar dahil
          </label>
        </div>
      </div>
      {hata && <Uyari ton="kirmizi">{hata}</Uyari>}
      {taslak && <Uyari ton="mavi">Ön izleme: onaylanmamış taslak fişler de toplama giriyor. Resmî mizan yalnız onaylı fişlerdir.</Uyari>}
      {kebirToplam && !dengeli && (
        <Uyari ton="kirmizi">
          Borç toplamı alacak toplamına eşit değil ({tutarSifirli(kebirToplam.toplamBorc)} ≠ {tutarSifirli(kebirToplam.toplamAlacak)}). Bu bir
          hatadır; lütfen destek ekibine bildirin.
        </Uyari>
      )}

      <div className="overflow-x-auto rounded-2xl border border-kobipo-border/90 bg-card shadow-card">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="bg-kobipo-offwhite text-xs font-semibold uppercase tracking-wide text-kobipo-gray dark:bg-muted/40">
            <tr>
              <th rowSpan={2} className="px-3 py-2 text-left">Hesap</th>
              <th colSpan={2} className="border-l border-kobipo-border/60 px-3 py-1.5 text-center">Devir</th>
              <th colSpan={2} className="border-l border-kobipo-border/60 px-3 py-1.5 text-center">Dönem</th>
              <th colSpan={2} className="border-l border-kobipo-border/60 px-3 py-1.5 text-center">Toplam</th>
              <th colSpan={2} className="border-l border-kobipo-border/60 px-3 py-1.5 text-center">Bakiye</th>
            </tr>
            <tr>
              {["Borç", "Alacak", "Borç", "Alacak", "Borç", "Alacak", "Borç", "Alacak"].map((b, i) => (
                <th key={i} className={cn("px-3 py-1.5 text-right", i % 2 === 0 && "border-l border-kobipo-border/60")}>
                  {b}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {yukleniyor && !veri ? (
              <tr>
                <td colSpan={9} className="py-10 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-kobipo-gray" />
                </td>
              </tr>
            ) : satirlar.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-10 text-center text-kobipo-gray">
                  Bu dönemde onaylı fiş yok. Fişler ekranından taslakları onaylayın.
                </td>
              </tr>
            ) : (
              satirlar.map((s) => (
                <tr
                  key={s.kod}
                  onClick={() =>
                    router.push(withCompanyHref(`/muhasebe/kebir?hesap=${encodeURIComponent(s.kod)}&bas=${bas}&bit=${bit}`, companyId))
                  }
                  className={cn(
                    "cursor-pointer border-t border-kobipo-border/60 tabular-nums hover:bg-kobipo-pale/50 dark:hover:bg-muted/30",
                    duzey === "detay" && s.duzey === 3 && "bg-kobipo-offwhite/60 font-semibold dark:bg-muted/20",
                  )}
                >
                  <td className="px-3 py-2" style={{ paddingLeft: duzey === "detay" ? `${0.75 + (s.duzey - 3) * 1}rem` : undefined }}>
                    <span className="font-mono text-kobipo-navy dark:text-foreground">{s.kod}</span>{" "}
                    <span className="text-kobipo-navy dark:text-foreground">{s.ad}</span>
                  </td>
                  <td className="border-l border-kobipo-border/40 px-3 py-2 text-right">{tutar(s.devirBorc)}</td>
                  <td className="px-3 py-2 text-right">{tutar(s.devirAlacak)}</td>
                  <td className="border-l border-kobipo-border/40 px-3 py-2 text-right">{tutar(s.donemBorc)}</td>
                  <td className="px-3 py-2 text-right">{tutar(s.donemAlacak)}</td>
                  <td className="border-l border-kobipo-border/40 px-3 py-2 text-right">{tutar(s.toplamBorc)}</td>
                  <td className="px-3 py-2 text-right">{tutar(s.toplamAlacak)}</td>
                  <td className={cn("border-l border-kobipo-border/40 px-3 py-2 text-right font-semibold", s.tersBakiye && s.bakiyeBorc && "text-red-700 dark:text-red-300")}>
                    {tutar(s.bakiyeBorc)}
                  </td>
                  <td className={cn("px-3 py-2 text-right font-semibold", s.tersBakiye && s.bakiyeAlacak && "text-red-700 dark:text-red-300")}>
                    {tutar(s.bakiyeAlacak)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {toplam && (
            <tfoot>
              <tr className="border-t-2 border-kobipo-border font-bold tabular-nums text-kobipo-navy dark:text-foreground">
                <td className="px-3 py-2">Toplam</td>
                <td className="border-l border-kobipo-border/40 px-3 py-2 text-right">{tutarSifirli(toplam.devirBorc)}</td>
                <td className="px-3 py-2 text-right">{tutarSifirli(toplam.devirAlacak)}</td>
                <td className="border-l border-kobipo-border/40 px-3 py-2 text-right">{tutarSifirli(toplam.donemBorc)}</td>
                <td className="px-3 py-2 text-right">{tutarSifirli(toplam.donemAlacak)}</td>
                <td className="border-l border-kobipo-border/40 px-3 py-2 text-right">{tutarSifirli(toplam.toplamBorc)}</td>
                <td className="px-3 py-2 text-right">{tutarSifirli(toplam.toplamAlacak)}</td>
                <td className="border-l border-kobipo-border/40 px-3 py-2 text-right">{tutarSifirli(toplam.bakiyeBorc)}</td>
                <td className="px-3 py-2 text-right">{tutarSifirli(toplam.bakiyeAlacak)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <p className="text-xs text-kobipo-gray">
        Kırmızı bakiye hesabın normal yönünün tersindedir (ör. kasada alacak bakiyesi, müşteride avans). Hata olmayabilir ama
        gözden geçirilmeli.
      </p>
    </div>
  )
}
