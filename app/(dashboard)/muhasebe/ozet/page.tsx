"use client"

import { useCallback, useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { AlertTriangle, ArrowRight, CheckCircle2, Circle, Info, Loader2 } from "lucide-react"
import { CompanyLink } from "@/components/dashboard/company-link"
import { cn } from "@/lib/utils"
import {
  DurumBekleniyor,
  Kart,
  KurulumGerekli,
  SayfaBasligi,
  Uyari,
  gunMetni,
  muhasebeIstegi,
  tl,
  useMuhasebeDurumu,
} from "@/components/muhasebe/ortak"
import { MUHASEBE_SOZLUGU } from "@/components/muhasebe/ekran-aciklamasi"
import type { MuhasebeOzeti, OzetRakamlari } from "@/lib/muhasebe/ozet.server"
import type { AdimDurumu } from "@/lib/muhasebe/ozet"

/**
 * Muhasebe Özeti — modülün giriş ekranı. Muhasebeci olmayan kullanıcıya "ne yapmam
 * gerekiyor?" sorusunun cevabını sırayla verir (adımlar: lib/muhasebe/ozet.ts), bu
 * yılın rakamlarını hem resmî (onaylı) hem ön izleme (taslaklar dahil) olarak gösterir
 * ve terimleri düz dille açıklar.
 */

const SIMGE: Record<AdimDurumu, { simge: typeof Circle; sinif: string }> = {
  tamam: { simge: CheckCircle2, sinif: "text-kobipo-green-dark dark:text-emerald-400" },
  yapilacak: { simge: Circle, sinif: "text-kobipo-blue" },
  uyari: { simge: AlertTriangle, sinif: "text-amber-600 dark:text-amber-400" },
  bilgi: { simge: Info, sinif: "text-kobipo-gray" },
}

export default function MuhasebeOzetiPage() {
  const companyId = useSearchParams().get("company")
  const { durum, hata: durumHata } = useMuhasebeDurumu(companyId)
  const [ozet, setOzet] = useState<MuhasebeOzeti | null>(null)
  const [hata, setHata] = useState<string | null>(null)

  const yukle = useCallback(async () => {
    if (!companyId) return
    try {
      setOzet(await muhasebeIstegi<MuhasebeOzeti>(`/api/muhasebe/ozet?companyId=${encodeURIComponent(companyId)}`))
      setHata(null)
    } catch (e) {
      setHata(e instanceof Error ? e.message : String(e))
    }
  }, [companyId])

  useEffect(() => {
    if (durum?.kurulu) void yukle()
  }, [durum?.kurulu, yukle])

  if (!companyId) return <p className="p-6 text-sm text-kobipo-gray">Firma seçiniz.</p>
  if (!durum) return <DurumBekleniyor hata={durumHata} />

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <SayfaBasligi
        baslik="Muhasebe Özeti"
        aciklama="Kobipo belgelerinizden (fatura, tahsilat, ödeme, bordro, çek…) muhasebe kayıtlarını kendisi hazırlar. Sizin ya da muhasebecinizin işi, eksik bilgiyi tamamlayıp onaylamaktır. Aşağıdaki liste sırada ne olduğunu gösterir."
      />
      {!durum.kurulu ? (
        <KurulumGerekli durum={durum} />
      ) : (
        <>
          {hata && <Uyari ton="kirmizi">{hata}</Uyari>}
          {!ozet && !hata && (
            <p className="flex items-center gap-2 text-sm text-kobipo-gray">
              <Loader2 className="h-4 w-4 animate-spin" /> Hazırlanıyor…
            </p>
          )}
          {ozet && (
            <>
              <Kart className="space-y-1">
                <h2 className="mb-2 font-bold text-kobipo-navy dark:text-foreground">Yapılacaklar</h2>
                <ol className="divide-y divide-kobipo-border/60">
                  {ozet.adimlar.map((a) => {
                    const S = SIMGE[a.durum]
                    return (
                      <li key={a.anahtar} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:gap-3">
                        <S.simge className={cn("mt-0.5 h-5 w-5 shrink-0", S.sinif)} aria-hidden />
                        <div className="min-w-0 flex-1">
                          <p className={cn("font-semibold", a.durum === "tamam" ? "text-kobipo-gray" : "text-kobipo-navy dark:text-foreground")}>
                            {a.baslik}
                          </p>
                          <p className="text-sm text-kobipo-gray">{a.aciklama}</p>
                        </div>
                        {a.href && a.eylem && (
                          <CompanyLink
                            href={a.href}
                            className={cn(
                              "inline-flex shrink-0 items-center gap-1.5 self-start rounded-xl px-3 py-2 text-sm font-semibold",
                              a.durum === "yapilacak"
                                ? "bg-kobipo-blue text-white hover:bg-kobipo-blue/90"
                                : "border border-kobipo-border text-kobipo-navy hover:bg-kobipo-pale dark:text-foreground dark:hover:bg-muted",
                            )}
                          >
                            {a.eylem} <ArrowRight className="h-4 w-4" aria-hidden />
                          </CompanyLink>
                        )}
                      </li>
                    )
                  })}
                </ol>
              </Kart>

              <Kart className="space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-bold text-kobipo-navy dark:text-foreground">
                    Bu yıl · {gunMetni(ozet.donem.bas)} – {gunMetni(ozet.donem.bit)}
                  </h2>
                  <CompanyLink href="/muhasebe/mali-tablolar" className="text-sm font-semibold text-kobipo-blue hover:underline">
                    Bilanço ve gelir tablosu
                  </CompanyLink>
                </div>
                <Rakamlar onayli={ozet.rakamlar.onayli} taslak={ozet.rakamlar.taslakDahil} bekleyen={ozet.sayilar.emin + ozet.sayilar.gozden} />
              </Kart>

              <Kart className="space-y-3">
                <h2 className="font-bold text-kobipo-navy dark:text-foreground">Terimler</h2>
                <p className="text-sm text-kobipo-gray">Muhasebe ekranlarında geçen kelimelerin kısa açıklaması.</p>
                <dl className="grid gap-3 sm:grid-cols-2">
                  {MUHASEBE_SOZLUGU.map((t) => (
                    <div key={t.terim} className="rounded-xl bg-kobipo-offwhite px-3 py-2.5 dark:bg-muted/40">
                      <dt className="font-semibold text-kobipo-navy dark:text-foreground">
                        {t.href ? (
                          <CompanyLink href={t.href} className="hover:underline">
                            {t.terim}
                          </CompanyLink>
                        ) : (
                          t.terim
                        )}
                      </dt>
                      <dd className="mt-0.5 text-sm text-kobipo-gray">{t.anlam}</dd>
                    </div>
                  ))}
                </dl>
              </Kart>
            </>
          )}
        </>
      )}
    </div>
  )
}

function Rakamlar({ onayli, taslak, bekleyen }: { onayli: OzetRakamlari; taslak: OzetRakamlari; bekleyen: number }) {
  const kutular: Array<{ ad: string; aciklama: string; k: keyof OzetRakamlari }> = [
    { ad: "Net satışlar", aciklama: "İadeler düşülmüş satışlar (KDV hariç)", k: "netSatis" },
    { ad: "Giderler", aciklama: "Satılan malın maliyeti dahil bütün giderler", k: "giderler" },
    { ad: "Kâr / zarar", aciklama: "Net satışlar − giderler", k: "sonuc" },
    { ad: "Kasa ve banka", aciklama: "Bugünkü hazır değerler", k: "hazirDegerler" },
    { ad: "Müşterilerden alacak", aciklama: "Ticari alacaklar (120, 121)", k: "alacaklar" },
    { ad: "Tedarikçilere borç", aciklama: "Ticari borçlar (320, 321)", k: "borclar" },
  ]
  const fark = kutular.some((x) => Math.abs(onayli[x.k] - taslak[x.k]) >= 0.01)
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {kutular.map((x) => (
          <div key={x.k} className="rounded-xl border border-kobipo-border/70 px-3 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-kobipo-gray">{x.ad}</p>
            <p
              className={cn(
                "mt-0.5 text-lg font-bold tabular-nums",
                x.k === "sonuc" && onayli.sonuc < 0 ? "text-red-700 dark:text-red-300" : "text-kobipo-navy dark:text-foreground",
              )}
            >
              {tl(onayli[x.k])}
            </p>
            {Math.abs(onayli[x.k] - taslak[x.k]) >= 0.01 && (
              <p className="text-xs text-kobipo-gray">
                Onay bekleyenlerle: <span className="font-semibold tabular-nums">{tl(taslak[x.k])}</span>
              </p>
            )}
            <p className="mt-1 text-xs text-kobipo-gray">{x.aciklama}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-kobipo-gray">
        Büyük rakamlar yalnız onaylanmış fişlerdendir (resmî defter).
        {fark && bekleyen > 0 && ` ${bekleyen} fiş henüz onaylanmadığı için "onay bekleyenlerle" satırı farklı.`} Satılan malın maliyeti yıl
        sonu stok sayımıyla hesaplandığından yıl içinde kâr olduğundan yüksek görünebilir.
      </p>
    </>
  )
}
