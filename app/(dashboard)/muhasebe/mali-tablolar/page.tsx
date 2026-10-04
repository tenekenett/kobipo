"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  KurulumGerekli,
  Kart,
  SayfaBasligi,
  Uyari,
  gunMetni,
  muhasebeIstegi,
  tutarSifirli,
  useMuhasebeDurumu,
  DurumBekleniyor,
} from "@/components/muhasebe/ortak"
import { DonemSecici, useDonem } from "@/components/muhasebe/donem-secici"
import type { Bilanco, GelirTablosuKalemi, TabloBolumu } from "@/lib/muhasebe/mali-tablolar"

/**
 * Bilanço ve Gelir Tablosu — muhasebe defterinin (onaylı fişler, mizan) Tekdüzen
 * mali tabloları. Kural: lib/muhasebe/mali-tablolar.ts. Raporlar menüsündeki
 * "Finansal Raporlar" kaynak kayıtlardan kurulur; bu sayfa defterden.
 */

type Yanit = { bilanco: Bilanco; gelirTablosu: { kalemler: GelirTablosuKalemi[]; netKar: number } }

const isaretli = (n: number) => (n < 0 ? `(${tutarSifirli(-n)})` : tutarSifirli(n))

export default function MaliTablolarPage() {
  const companyId = useSearchParams().get("company")
  const { bas, bit } = useDonem()
  const { durum, hata: durumHata } = useMuhasebeDurumu(companyId)
  const [veri, setVeri] = useState<Yanit | null>(null)
  const [hata, setHata] = useState<string | null>(null)
  const [yukleniyor, setYukleniyor] = useState(false)

  useEffect(() => {
    if (!companyId || !durum?.kurulu) return
    setYukleniyor(true)
    muhasebeIstegi<Yanit>(`/api/muhasebe/mali-tablolar?${new URLSearchParams({ companyId, bas, bit })}`)
      .then((v) => {
        setVeri(v)
        setHata(null)
      })
      .catch((e) => setHata(e instanceof Error ? e.message : String(e)))
      .finally(() => setYukleniyor(false))
  }, [companyId, durum?.kurulu, bas, bit])

  if (!companyId) return <p className="p-6 text-sm text-kobipo-gray">Firma seçiniz.</p>
  if (durum && !durum.kurulu) return <KurulumGerekli durum={durum} />
  if (!durum) return <DurumBekleniyor hata={durumHata} />

  const b = veri?.bilanco
  const denk = b ? Math.abs(b.aktifToplam - b.pasifToplam) < 0.01 : true

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <SayfaBasligi
        baslik="Bilanço ve Gelir Tablosu"
        aciklama="Onaylanmış fişlerden (mizan) Tekdüzen mali tablolar. Bilanço dönem sonu itibarıyla, gelir tablosu seçilen dönem için."
      />
      <DonemSecici />
      {hata && <Uyari ton="kirmizi">{hata}</Uyari>}
      {yukleniyor && !veri && (
        <p className="flex items-center gap-2 text-sm text-kobipo-gray">
          <Loader2 className="h-4 w-4 animate-spin" /> Hesaplanıyor…
        </p>
      )}
      {b && !denk && (
        <Uyari ton="kirmizi">
          Bilanço denk değil (aktif {tutarSifirli(b.aktifToplam)} ≠ pasif {tutarSifirli(b.pasifToplam)}). Bu bir hatadır; destek ekibine
          bildirin.
        </Uyari>
      )}
      {b && b.kapanmamisSonuc !== 0 && (
        <Uyari ton="mavi">
          Dönem kapanışı yapılmadı: gelir ve gider hesaplarının neti ({isaretli(b.kapanmamisSonuc)}) öz kaynaklarda &quot;kapanmamış&quot;
          satırında gösteriliyor. Satılan malın maliyeti yıl sonu stok sayımıyla kapanışta hesaplanır.
        </Uyari>
      )}

      {veri && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Kart className="space-y-3">
            <h2 className="font-bold text-kobipo-navy dark:text-foreground">Bilanço · {gunMetni(bit)}</h2>
            <div className="grid gap-4">
              <BilancoTarafi baslik="Aktif" bolumler={b!.aktif} toplam={b!.aktifToplam} />
              <BilancoTarafi baslik="Pasif" bolumler={b!.pasif} toplam={b!.pasifToplam} />
            </div>
            {b!.yenidenSiniflanan.length > 0 && (
              <p className="text-xs text-kobipo-gray">
                Ters bakiyeli {b!.yenidenSiniflanan.length} cari/personel alt hesabı avans ya da alacak olarak yeniden sınıflandı (340 / 159 /
                135).
              </p>
            )}
          </Kart>
          <Kart className="space-y-3">
            <h2 className="font-bold text-kobipo-navy dark:text-foreground">
              Gelir Tablosu · {gunMetni(bas)} – {gunMetni(bit)}
            </h2>
            <table className="w-full text-sm">
              <tbody>
                {veri.gelirTablosu.kalemler.map((k, i) => (
                  <GelirSatiri key={i} k={k} />
                ))}
              </tbody>
            </table>
          </Kart>
        </div>
      )}
    </div>
  )
}

function BilancoTarafi({ baslik, bolumler, toplam }: { baslik: string; bolumler: TabloBolumu[]; toplam: number }) {
  return (
    <div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-kobipo-border text-left text-xs font-semibold uppercase tracking-wide text-kobipo-gray">
            <th className="py-1.5">{baslik}</th>
            <th className="py-1.5 text-right">₺</th>
          </tr>
        </thead>
        <tbody>
          {bolumler.map((bol) => (
            <BolumSatirlari key={bol.kod} bol={bol} />
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-kobipo-border font-bold text-kobipo-navy dark:text-foreground">
            <td className="py-2">{baslik} toplamı</td>
            <td className="py-2 text-right tabular-nums">{isaretli(toplam)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function BolumSatirlari({ bol }: { bol: TabloBolumu }) {
  if (bol.gruplar.length === 0) return null
  return (
    <>
      <tr className="bg-kobipo-offwhite font-semibold text-kobipo-navy dark:bg-muted/40 dark:text-foreground">
        <td className="px-1 py-1.5">
          {bol.kod}. {bol.ad}
        </td>
        <td className="px-1 py-1.5 text-right tabular-nums">{isaretli(bol.tutar)}</td>
      </tr>
      {bol.gruplar.map((g) => (
        <GrupSatirlari key={g.kod} g={g} />
      ))}
    </>
  )
}

function GrupSatirlari({ g }: { g: TabloBolumu["gruplar"][number] }) {
  return (
    <>
      <tr className="text-kobipo-navy dark:text-foreground">
        <td className="py-1 pl-3 font-medium">{g.ad}</td>
        <td className="py-1 text-right font-medium tabular-nums">{isaretli(g.tutar)}</td>
      </tr>
      {g.satirlar.map((s) => (
        <tr key={s.kod + s.ad} className="text-kobipo-gray">
          <td className="py-0.5 pl-7">
            {s.kod !== "—" && <span className="font-mono text-xs">{s.kod} </span>}
            {s.ad}
          </td>
          <td className="py-0.5 text-right tabular-nums">{isaretli(s.tutar)}</td>
        </tr>
      ))}
    </>
  )
}

function GelirSatiri({ k }: { k: GelirTablosuKalemi }) {
  return (
    <>
      <tr
        className={cn(
          "border-t border-kobipo-border/60",
          k.ara ? "bg-kobipo-offwhite font-bold text-kobipo-navy dark:bg-muted/40 dark:text-foreground" : "text-kobipo-navy dark:text-foreground",
        )}
      >
        <td className="px-1 py-1.5">
          {k.kod && <span className="mr-1.5 text-kobipo-gray">{k.kod}.</span>}
          {k.ad}
        </td>
        <td className="px-1 py-1.5 text-right tabular-nums">{isaretli(k.tutar)}</td>
      </tr>
      {k.satirlar?.map((s) => (
        <tr key={s.kod} className="text-kobipo-gray">
          <td className="py-0.5 pl-7">
            <span className="font-mono text-xs">{s.kod}</span> {s.ad}
          </td>
          <td className="py-0.5 text-right tabular-nums">{isaretli(s.tutar)}</td>
        </tr>
      ))}
    </>
  )
}
