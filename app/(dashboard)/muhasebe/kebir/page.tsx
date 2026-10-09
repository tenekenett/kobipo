"use client"

import { useEffect, useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Loader2 } from "lucide-react"
import { CompanyLink } from "@/components/dashboard/company-link"
import { SearchSelect } from "@/components/ui/search-select"
import {
  KurulumGerekli,
  SayfaBasligi,
  Uyari,
  gunMetni,
  muhasebeIstegi,
  tutar,
  tutarSifirli,
  useMuhasebeDurumu,
  type PlanHesabi,
  DurumBekleniyor,
} from "@/components/muhasebe/ortak"
import { DonemSecici, useDonem } from "@/components/muhasebe/donem-secici"
import { ExportButton } from "@/components/export/export-button"
import { EkranAciklamasi } from "@/components/muhasebe/ekran-aciklamasi"

/**
 * Kebir (hesap dökümü) — bir hesabın ve alt hesaplarının onaylı hareketleri,
 * devir ve yürüyen bakiyeyle (borç − alacak). Mizandan satıra tıklayınca açılır.
 */

type Satir = { fisId: string; voucherNo: string; tarih: string; aciklama: string | null; hesapKodu: string; borc: number; alacak: number; bakiye: number }
type Yanit = { hesap: { kod: string; ad: string }; devir: number; satirlar: Satir[]; borc: number; alacak: number }

const bakiyeMetni = (n: number) => (n === 0 ? "0,00" : `${tutarSifirli(Math.abs(n))} ${n > 0 ? "B" : "A"}`)

export default function KebirPage() {
  const sp = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const companyId = sp.get("company")
  const hesap = sp.get("hesap") ?? ""
  const { bas, bit } = useDonem()
  const { durum, hata: durumHata } = useMuhasebeDurumu(companyId)
  const [hesaplar, setHesaplar] = useState<PlanHesabi[]>([])
  const [veri, setVeri] = useState<Yanit | null>(null)
  const [hata, setHata] = useState<string | null>(null)
  const [yukleniyor, setYukleniyor] = useState(false)

  useEffect(() => {
    if (!companyId || !durum?.kurulu) return
    muhasebeIstegi<{ hesaplar: PlanHesabi[] }>(`/api/muhasebe/hesap-plani?companyId=${encodeURIComponent(companyId)}`)
      .then((r) => setHesaplar(r.hesaplar))
      .catch(() => {})
  }, [companyId, durum?.kurulu])

  useEffect(() => {
    if (!companyId || !durum?.kurulu || !hesap) return
    setYukleniyor(true)
    muhasebeIstegi<Yanit>(`/api/muhasebe/kebir?${new URLSearchParams({ companyId, hesap, bas, bit })}`)
      .then((v) => {
        setVeri(v)
        setHata(null)
      })
      .catch((e) => {
        setVeri(null)
        setHata(e instanceof Error ? e.message : String(e))
      })
      .finally(() => setYukleniyor(false))
  }, [companyId, durum?.kurulu, hesap, bas, bit])

  // Seçici: kullanılan (en az bir satırı olan) ya da kebir düzeyindeki hesaplar.
  const secenekler = useMemo(
    () =>
      hesaplar
        .filter((h) => h.duzey >= 3 && (h.duzey === 3 || h.kullanim > 0 || !h.yaprak))
        .map((h) => ({ id: h.kod, name: `${h.kod}  ${h.ad}` })),
    [hesaplar],
  )

  if (!companyId) return <p className="p-6 text-sm text-kobipo-gray">Firma seçiniz.</p>
  if (durum && !durum.kurulu) return <KurulumGerekli durum={durum} />
  if (!durum) return <DurumBekleniyor hata={durumHata} />

  const hesapSec = (kod: string) => {
    const q = new URLSearchParams(sp.toString())
    if (kod) q.set("hesap", kod)
    else q.delete("hesap")
    router.replace(`${pathname}?${q}`, { scroll: false })
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <SayfaBasligi baslik="Kebir Defteri" aciklama="Hesap dökümü: devir, onaylı hareketler ve yürüyen bakiye. Alt hesapların hareketleri de dahildir." />
      <EkranAciklamasi anahtar="kebir">
        <p>
          Kebir, <strong>tek bir hesabın dökümüdür</strong> — banka ekstresi gibi okunur. Örneğin 102 seçerseniz bankanızın, 120.01.0003
          seçerseniz bir müşterinizin defterdeki bütün hareketlerini ve her satırdan sonraki bakiyeyi görürsünüz.
        </p>
        <p>Mizanda bir hesabın üstüne tıklamak da sizi buraya getirir.</p>
      </EkranAciklamasi>
      <div className="flex flex-wrap items-center gap-3">
        <div className="w-full max-w-md">
          <SearchSelect options={secenekler} value={hesap} onChange={hesapSec} placeholder="Hesap seçin (kod ya da ad)" emptyText="Eşleşen hesap yok" />
        </div>
        <DonemSecici />
        {hesap && <ExportButton dataset="muhasebe-kebir" companyId={companyId} params={{ hesap, bas, bit }} disabled={!veri} />}
      </div>
      {hata && <Uyari ton="kirmizi">{hata}</Uyari>}
      {!hesap ? (
        <p className="rounded-2xl border border-kobipo-border/90 bg-card p-8 text-center text-sm text-kobipo-gray">
          Dökümünü görmek istediğiniz hesabı seçin.
        </p>
      ) : yukleniyor && !veri ? (
        <p className="flex items-center gap-2 text-sm text-kobipo-gray">
          <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
        </p>
      ) : veri ? (
        <div className="overflow-x-auto rounded-2xl border border-kobipo-border/90 bg-card shadow-card">
          <div className="border-b border-kobipo-border/60 px-4 py-3">
            <p className="font-semibold text-kobipo-navy dark:text-foreground">
              <span className="font-mono">{veri.hesap.kod}</span> {veri.hesap.ad}
            </p>
          </div>
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-kobipo-offwhite text-left text-xs font-semibold uppercase tracking-wide text-kobipo-gray dark:bg-muted/40">
              <tr>
                <th className="px-3 py-2">Tarih</th>
                <th className="px-3 py-2">Fiş</th>
                <th className="px-3 py-2">Açıklama</th>
                <th className="px-3 py-2 text-right">Borç</th>
                <th className="px-3 py-2 text-right">Alacak</th>
                <th className="px-3 py-2 text-right">Bakiye</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-kobipo-border/60 bg-kobipo-offwhite/50 dark:bg-muted/20">
                <td className="px-3 py-2 text-kobipo-gray" colSpan={5}>
                  Devir ({gunMetni(bas)} öncesi)
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums">{bakiyeMetni(veri.devir)}</td>
              </tr>
              {veri.satirlar.map((s, i) => (
                <tr key={`${s.fisId}-${i}`} className="border-t border-kobipo-border/60">
                  <td className="whitespace-nowrap px-3 py-2">{gunMetni(s.tarih)}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <CompanyLink href={`/muhasebe/fisler/${s.fisId}?sekme=onayli`} className="font-mono text-xs text-kobipo-blue hover:underline">
                      {s.voucherNo}
                    </CompanyLink>
                  </td>
                  <td className="px-3 py-2 text-kobipo-navy dark:text-foreground">
                    {s.aciklama || "—"}
                    {s.hesapKodu !== veri.hesap.kod && <span className="ml-2 font-mono text-xs text-kobipo-gray">{s.hesapKodu}</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{tutar(s.borc)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{tutar(s.alacak)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{bakiyeMetni(s.bakiye)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-kobipo-border font-semibold tabular-nums text-kobipo-navy dark:text-foreground">
                <td className="px-3 py-2" colSpan={3}>
                  Dönem toplamı
                </td>
                <td className="px-3 py-2 text-right">{tutarSifirli(veri.borc)}</td>
                <td className="px-3 py-2 text-right">{tutarSifirli(veri.alacak)}</td>
                <td className="px-3 py-2 text-right">
                  {bakiyeMetni(veri.satirlar.length ? veri.satirlar[veri.satirlar.length - 1].bakiye : veri.devir)}
                </td>
              </tr>
            </tfoot>
          </table>
          {veri.satirlar.length >= 5000 && (
            <p className="px-4 py-2 text-xs text-amber-700">İlk 5.000 hareket gösteriliyor; dönemi daraltın.</p>
          )}
        </div>
      ) : null}
    </div>
  )
}
