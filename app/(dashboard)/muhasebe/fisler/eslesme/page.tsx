"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowLeft, CheckCheck, Link2, Loader2, RefreshCw } from "lucide-react"
import { CompanyLink } from "@/components/dashboard/company-link"
import { EkranAciklamasi } from "@/components/muhasebe/ekran-aciklamasi"
import { ReadOnlyBanner, WriteAction, useCanEditHere } from "@/components/dashboard/write-guard"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { cn } from "@/lib/utils"
import {
  DurumBekleniyor,
  Kart,
  KurulumGerekli,
  SayfaBasligi,
  Uyari,
  hataBildir,
  muhasebeIstegi,
  tutarSifirli,
  useMuhasebeDurumu,
} from "@/components/muhasebe/ortak"
import { HesapSecici, useYaprakHesaplar } from "@/components/muhasebe/hesap-secici"
import { ESLEME_ROL_ADI } from "@/lib/muhasebe/esleme"

/**
 * Toplu hesap eşleme — "Gözden geçir"deki taslak fişlerin hesabı belli olmayan satırları,
 * onaylanınca öğrenilecekleri kurala göre gruplanır (aynı tedarikçinin aynı oranlı
 * alışları, aynı gider kategorisi, bordro gideri…). Her gruba bir hesap seçilir, grup tek
 * seferde eşlenir. Eşleme satırı ELLE SEÇİLMİŞ yapar; kural onayda öğrenilir — ekran
 * eşlemeden sonra "emin"e geçen fişleri onaylamayı önerir. Kural: lib/muhasebe/esleme.ts.
 */

type Grup = {
  anahtar: string
  etiket: string
  rol: string
  aciklama: string
  oneriKodu: string
  ogrenmeAnahtarlari: string[]
  satirSayisi: number
  fisSayisi: number
  tutar: number
  tahminHesap: { id: string; kod: string; ad: string } | null
  ornekFisler: string[]
}
type Liste = { gruplar: Grup[]; fisSayisi: number; satirSayisi: number }
type Sonuc = { satir: number; fis: number; eminFisler: string[] }

export default function TopluEslemePage() {
  const companyId = useSearchParams().get("company")
  const { durum, hata: durumHata } = useMuhasebeDurumu(companyId)
  const canEdit = useCanEditHere()
  const { confirm } = useConfirm()
  const { hesaplar, yenile: hesaplariYenile } = useYaprakHesaplar(companyId)
  const [liste, setListe] = useState<Liste | null>(null)
  const [hata, setHata] = useState<string | null>(null)
  const [yukleniyor, setYukleniyor] = useState(false)
  const [secim, setSecim] = useState<Record<string, string>>({})
  const [uygulaniyor, setUygulaniyor] = useState(false)
  const [onaylaniyor, setOnaylaniyor] = useState(false)
  const [sonuc, setSonuc] = useState<Sonuc | null>(null)

  const yukle = useCallback(async () => {
    if (!companyId) return
    setYukleniyor(true)
    try {
      setListe(await muhasebeIstegi<Liste>(`/api/muhasebe/fisler/eslesme?companyId=${encodeURIComponent(companyId)}`))
      setHata(null)
    } catch (e) {
      setHata(e instanceof Error ? e.message : String(e))
    } finally {
      setYukleniyor(false)
    }
  }, [companyId])

  useEffect(() => {
    if (durum?.kurulu) void yukle()
  }, [durum?.kurulu, yukle])

  // Liste yenilenince artık olmayan grupların seçimi düşer.
  useEffect(() => {
    if (!liste) return
    const var_ = new Set(liste.gruplar.map((g) => g.anahtar))
    setSecim((s) => Object.fromEntries(Object.entries(s).filter(([k]) => var_.has(k))))
  }, [liste])

  const secilen = useMemo(() => (liste?.gruplar ?? []).filter((g) => secim[g.anahtar]), [liste, secim])
  const secilenFis = secilen.reduce((a, g) => a + g.fisSayisi, 0)

  const uygula = async () => {
    if (!companyId || secilen.length === 0) return
    setUygulaniyor(true)
    try {
      const r = await muhasebeIstegi<Sonuc>("/api/muhasebe/fisler/eslesme", {
        method: "POST",
        body: JSON.stringify({ companyId, atamalar: secilen.map((g) => ({ anahtar: g.anahtar, accountId: secim[g.anahtar] })) }),
      })
      setSonuc(r)
      setSecim({})
      toast({
        title: `${r.satir} satır eşlendi (${r.fis} fiş)`,
        description: r.eminFisler.length ? `${r.eminFisler.length} fiş artık onaya hazır.` : "Fişlerde hâlâ hesabı seçilmemiş başka satırlar var.",
      })
      await yukle()
    } catch (e) {
      hataBildir(e, "Eşleme yapılamadı")
    } finally {
      setUygulaniyor(false)
    }
  }

  const onayla = async (ids: string[]) => {
    const ok = await confirm({
      title: `${ids.length} fiş onaylansın mı?`,
      description:
        "Onaylanan fiş deftere (yevmiye, kebir, mizan) işlenir ve seçtiğiniz hesaplar öğrenilir: sonraki benzer belgeler kendiliğinden bu hesaplara düşer. Gerekirse onay geri alınabilir.",
      confirmLabel: "Onayla",
    })
    if (!ok) return
    setOnaylaniyor(true)
    try {
      let onaylanan = 0
      let atlanan = 0
      for (let i = 0; i < ids.length; i += 500) {
        const r = await muhasebeIstegi<{ onaylanan: number; atlanan: unknown[] }>("/api/muhasebe/fisler/toplu-onay", {
          method: "POST",
          body: JSON.stringify({ companyId, ids: ids.slice(i, i + 500) }),
        })
        onaylanan += r.onaylanan
        atlanan += r.atlanan.length
      }
      toast({
        title: `${onaylanan} fiş onaylandı`,
        description: atlanan ? `${atlanan} fiş atlandı (onaya engel bir sorun var).` : "Seçtiğiniz hesaplar öğrenildi.",
      })
      setSonuc(null)
      await yukle()
    } catch (e) {
      hataBildir(e, "Toplu onay yapılamadı")
    } finally {
      setOnaylaniyor(false)
    }
  }

  if (!companyId) return <p className="p-6 text-sm text-kobipo-gray">Firma seçiniz.</p>
  if (durum && !durum.kurulu) return <KurulumGerekli durum={durum} />
  if (!durum) return <DurumBekleniyor hata={durumHata} />

  const mesgul = uygulaniyor || onaylaniyor

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <CompanyLink
        href="/muhasebe/fisler?sekme=gozden"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-kobipo-blue hover:underline"
      >
        <ArrowLeft className="h-4 w-4" /> Fişler
      </CompanyLink>
      <SayfaBasligi
        baslik="Toplu hesap eşleme"
        aciklama="Hesabı belli olmayan satırlar türlerine göre gruplandı (aynı tedarikçinin alışları, aynı gider kategorisi, bordro gideri…). Her gruba bir hesap seçin; gruptaki bütün fişler tek seferde eşlenir."
        sag={
          <Button variant="outline" onClick={() => void yukle()} disabled={yukleniyor || mesgul}>
            <RefreshCw className={cn("mr-2 h-4 w-4", yukleniyor && "animate-spin")} />
            Yenile
          </Button>
        }
      />
      <EkranAciklamasi anahtar="eslesme">
        <p>
          Kobipo her belgeden bir muhasebe kaydı hazırlar ama bazı satırların <strong>hangi hesaba</strong> yazılacağını bilemez: bir alış
          faturası kırtasiye gideri mi, demirbaş mı, satılacak mal mı? Bu ekranda aynı türden satırlar tek grupta toplanır; gruba bir hesap
          seçmeniz o gruptaki bütün fişlere yazılır.
        </p>
        <p>
          Seçiminiz fişleri <strong>onayladığınızda öğrenilir</strong>: aynı tedarikçiden gelen sonraki faturalar kendiliğinden o hesaba düşer.
          Emin değilseniz grubu boş bırakın; muhasebecinize sorabilirsiniz.
        </p>
      </EkranAciklamasi>
      <ReadOnlyBanner />
      {hata && <Uyari ton="kirmizi">{hata}</Uyari>}

      {sonuc && (
        <Uyari ton="mavi">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span>
              {sonuc.satir} satır {sonuc.fis} fişte eşlendi.{" "}
              {sonuc.eminFisler.length > 0
                ? `${sonuc.eminFisler.length} fiş artık onaya hazır; onaylayınca seçimleriniz öğrenilir.`
                : "Bu fişlerde hesabı seçilmemiş başka satırlar da var — onları da eşleyin ya da fişi açın."}
            </span>
            {sonuc.eminFisler.length > 0 && (
              <WriteAction>
                <Button size="sm" onClick={() => void onayla(sonuc.eminFisler)} disabled={mesgul}>
                  {onaylaniyor ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCheck className="mr-2 h-4 w-4" />}
                  {sonuc.eminFisler.length} fişi onayla
                </Button>
              </WriteAction>
            )}
          </span>
        </Uyari>
      )}

      {!liste ? (
        <DurumBekleniyor hata={null} />
      ) : liste.gruplar.length === 0 ? (
        <Kart>
          <p className="text-sm text-kobipo-gray">
            Eşleme bekleyen satır yok. Gözden geçir&apos;de kalan fişler varsa sebebi hesap seçimi dışında bir şeydir
            (alt hesap, açılış farkı, dengesizlik) — fişi açıp bakın.
          </p>
        </Kart>
      ) : (
        <Kart className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-kobipo-gray">
              <strong className="text-kobipo-navy dark:text-foreground">{liste.gruplar.length}</strong> grup ·{" "}
              {liste.fisSayisi} fişte {liste.satirSayisi} satır bekliyor
              {secilen.length > 0 && (
                <>
                  {" "}
                  · seçilen <strong className="text-kobipo-navy dark:text-foreground">{secilen.length}</strong> grup, {secilenFis} fiş
                </>
              )}
            </p>
            <WriteAction>
              <Button onClick={() => void uygula()} disabled={mesgul || secilen.length === 0}>
                {uygulaniyor ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}
                Seçilenleri eşle
              </Button>
            </WriteAction>
          </div>

          <div className="hidden border-b border-kobipo-border/60 pb-2 text-xs font-semibold uppercase tracking-wide text-kobipo-gray md:grid md:grid-cols-[minmax(0,1fr)_6.5rem_8rem_minmax(15rem,19rem)] md:gap-3">
            <span>Grup</span>
            <span>Fiş</span>
            <span className="text-right">Tutar</span>
            <span>Hesap</span>
          </div>
          <ul className="divide-y divide-kobipo-border/60">
            {liste.gruplar.map((g) => (
              <li
                key={g.anahtar}
                className={cn(
                  "grid gap-2 py-3 md:grid-cols-[minmax(0,1fr)_6.5rem_8rem_minmax(15rem,19rem)] md:items-center md:gap-3",
                  secim[g.anahtar] && "bg-kobipo-pale/40 dark:bg-muted/40",
                )}
              >
                <div className="min-w-0">
                  <p className="break-words font-semibold text-kobipo-navy dark:text-foreground">{g.etiket}</p>
                  <p className="text-xs text-kobipo-gray">
                    {ESLEME_ROL_ADI[g.rol] ?? g.rol} · önerilen {g.oneriKodu || "—"} ·{" "}
                    {g.tahminHesap ? `şu an tahmin: ${g.tahminHesap.kod} ${g.tahminHesap.ad}` : "hesap seçilmemiş"}
                    {g.ornekFisler[0] && (
                      <>
                        {" · "}
                        <CompanyLink href={`/muhasebe/fisler/${g.ornekFisler[0]}?sekme=gozden`} className="text-kobipo-blue hover:underline">
                          örnek fiş
                        </CompanyLink>
                      </>
                    )}
                  </p>
                  {g.ogrenmeAnahtarlari.length === 0 && (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Bu seçim öğrenilmez, yalnız bu fişlere yazılır — sonraki benzer kayıtlar yine gözden geçire düşer.
                    </p>
                  )}
                </div>
                <div className="text-sm text-kobipo-navy dark:text-foreground">
                  {g.fisSayisi} fiş <span className="text-xs text-kobipo-gray">({g.satirSayisi} satır)</span>
                </div>
                <div className="text-sm tabular-nums md:text-right">{tutarSifirli(g.tutar)}</div>
                <div className="min-w-0">
                  <HesapSecici
                    companyId={companyId}
                    hesaplar={hesaplar}
                    deger={secim[g.anahtar] ?? null}
                    oneriKodu={g.oneriKodu || null}
                    onSec={(id) =>
                      setSecim((s) => {
                        const yeni = { ...s }
                        if (id) yeni[g.anahtar] = id
                        else delete yeni[g.anahtar]
                        return yeni
                      })
                    }
                    onHesapAcildi={hesaplariYenile}
                    disabled={!canEdit || mesgul}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Kart>
      )}
    </div>
  )
}
