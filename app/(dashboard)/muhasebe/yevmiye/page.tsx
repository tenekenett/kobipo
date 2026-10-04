"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react"
import { CompanyLink } from "@/components/dashboard/company-link"
import { Button } from "@/components/ui/button"
import {
  FIS_TURU,
  KurulumGerekli,
  SayfaBasligi,
  Uyari,
  gunMetni,
  muhasebeIstegi,
  tutar,
  tutarSifirli,
  useMuhasebeDurumu,
} from "@/components/muhasebe/ortak"
import { DonemSecici, useDonem } from "@/components/muhasebe/donem-secici"

/**
 * Yevmiye defteri — onaylanmış fişler tarih sırasıyla. Madde numarası yılın tamamında
 * tarih sırasıdır (lib/muhasebe/defter-sorgu.server.ts → yevmiye); dönem süzülse de değişmez.
 */

type Madde = {
  maddeNo: number
  id: string
  voucherNo: string
  tarih: string
  tur: string
  aciklama: string | null
  satirlar: Array<{ kod: string; ad: string; aciklama: string | null; borc: number; alacak: number }>
}
type Yanit = { maddeler: Madde[]; toplam: number; borc: number; alacak: number; sayfa: number; sayfaBoyu: number }

export default function YevmiyePage() {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const companyId = sp.get("company")
  const { bas, bit } = useDonem()
  const sayfa = Math.max(1, Number(sp.get("sayfa")) || 1)
  const { durum } = useMuhasebeDurumu(companyId)
  const [veri, setVeri] = useState<Yanit | null>(null)
  const [hata, setHata] = useState<string | null>(null)

  useEffect(() => {
    if (!companyId || !durum?.kurulu) return
    const q = new URLSearchParams({ companyId, bas, bit, sayfa: String(sayfa) })
    muhasebeIstegi<Yanit>(`/api/muhasebe/yevmiye?${q}`)
      .then((v) => {
        setVeri(v)
        setHata(null)
      })
      .catch((e) => setHata(e instanceof Error ? e.message : String(e)))
  }, [companyId, durum?.kurulu, bas, bit, sayfa])

  if (!companyId) return <p className="p-6 text-sm text-kobipo-gray">Firma seçiniz.</p>
  if (durum && !durum.kurulu) return <KurulumGerekli durum={durum} />

  const sayfaSayisi = veri ? Math.max(1, Math.ceil(veri.toplam / veri.sayfaBoyu)) : 1
  const sayfaya = (n: number) => {
    const q = new URLSearchParams(sp.toString())
    q.set("sayfa", String(n))
    router.replace(`${pathname}?${q}`, { scroll: true })
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <SayfaBasligi
        baslik="Yevmiye Defteri"
        aciklama="Onaylanmış fişler tarih sırasıyla. Taslak fişler deftere girmez — Fişler ekranından onaylanır."
      />
      <DonemSecici />
      {hata && <Uyari ton="kirmizi">{hata}</Uyari>}
      {veri && (
        <div className="flex flex-wrap gap-4 rounded-2xl bg-kobipo-offwhite px-4 py-3 text-sm tabular-nums text-kobipo-navy dark:bg-muted/40 dark:text-foreground">
          <span>{veri.toplam} madde</span>
          <span>Borç toplamı ₺{tutarSifirli(veri.borc)}</span>
          <span>Alacak toplamı ₺{tutarSifirli(veri.alacak)}</span>
        </div>
      )}
      {!veri && !hata && (
        <p className="flex items-center gap-2 text-sm text-kobipo-gray">
          <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
        </p>
      )}
      {veri?.maddeler.length === 0 && (
        <p className="rounded-2xl border border-kobipo-border/90 bg-card p-8 text-center text-sm text-kobipo-gray">
          Bu dönemde onaylı fiş yok.
        </p>
      )}
      <div className="space-y-3">
        {veri?.maddeler.map((m) => (
          <article key={m.id} className="overflow-hidden rounded-2xl border border-kobipo-border/90 bg-card shadow-card">
            <header className="flex flex-wrap items-center justify-between gap-2 bg-kobipo-offwhite px-4 py-2 text-sm dark:bg-muted/40">
              <span className="font-semibold text-kobipo-navy dark:text-foreground">
                Madde {m.maddeNo} · {gunMetni(m.tarih)} · {FIS_TURU[m.tur] ?? m.tur}
              </span>
              <CompanyLink href={`/muhasebe/fisler/${m.id}?sekme=onayli`} className="font-mono text-xs text-kobipo-blue hover:underline">
                {m.voucherNo}
              </CompanyLink>
            </header>
            <table className="w-full text-sm">
              <tbody>
                {m.satirlar.map((s, i) => (
                  <tr key={i} className="border-t border-kobipo-border/50">
                    <td className={`px-4 py-1.5 ${s.alacak ? "pl-12" : ""}`}>
                      <span className="font-mono text-kobipo-navy dark:text-foreground">{s.kod}</span>{" "}
                      <span className="text-kobipo-navy dark:text-foreground">{s.ad}</span>
                      {s.aciklama && <span className="ml-2 text-xs text-kobipo-gray">{s.aciklama}</span>}
                    </td>
                    <td className="w-36 whitespace-nowrap px-4 py-1.5 text-right tabular-nums">{tutar(s.borc)}</td>
                    <td className="w-36 whitespace-nowrap px-4 py-1.5 text-right tabular-nums">{tutar(s.alacak)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {m.aciklama && <p className="border-t border-kobipo-border/50 px-4 py-1.5 text-xs italic text-kobipo-gray">{m.aciklama}</p>}
          </article>
        ))}
      </div>
      {veri && sayfaSayisi > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm text-kobipo-gray">
          <span>
            Sayfa {sayfa}/{sayfaSayisi}
          </span>
          <Button size="sm" variant="outline" disabled={sayfa <= 1} onClick={() => sayfaya(sayfa - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" disabled={sayfa >= sayfaSayisi} onClick={() => sayfaya(sayfa + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}
