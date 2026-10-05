"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  GraduationCap,
  Loader2,
  Pencil,
  RotateCcw,
  RefreshCw,
  Save,
  Trash2,
} from "lucide-react"
import { CompanyLink } from "@/components/dashboard/company-link"
import { ReadOnlyBanner, WriteAction, useCanEditHere } from "@/components/dashboard/write-guard"
import { withCompanyHref } from "@/lib/company/href"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { cn } from "@/lib/utils"
import {
  FIS_TURU,
  HESAP_KAYNAGI,
  KAYNAK_TURU,
  KurulumGerekli,
  Kart,
  Uyari,
  gunMetni,
  hataBildir,
  muhasebeIstegi,
  tutar,
  tutarSifirli,
  useMuhasebeDurumu,
  DurumBekleniyor,
  type MuhasebeDurumu,
} from "@/components/muhasebe/ortak"
import { HesapSecici, useYaprakHesaplar } from "@/components/muhasebe/hesap-secici"
import {
  DengeSatiri,
  ElleSatirEditoru,
  elleToplamlar,
  tutarOku,
  yeniSatir,
  type ElleSatirTaslagi,
} from "@/components/muhasebe/elle-satir-editoru"

/**
 * Tek fiş — odak görünümü (plan §2.6). Taslakta her satırın hesabı seçilir (seçim
 * hemen kaydedilir), "Onayla ve sıradaki" aynı sekmedeki sonraki fişe geçer. Elle
 * fişte ve açılış fişinin fark satırında satır eklenir/düzenlenir.
 * `/muhasebe/fisler/yeni` yeni elle fiş açar; `/muhasebe/fisler/acilis` başlangıçta
 * bakiye olmadığı için hiç açılmamış açılış fişini elle satırlarıyla açar.
 */

type FisSatiri = {
  id: string
  taraf: "B" | "A"
  tutar: number
  rol: string
  aciklama: string | null
  oneriKodu: string
  kaynak: string
  ogrenir: boolean
  hesap: { id: string; kod: string; ad: string; uygun: boolean } | null
}

type FisDetay = {
  fis: {
    id: string
    voucherNo: string
    tarih: string
    aciklama: string | null
    tur: string
    durum: string
    emin: boolean
    kaynakTipi: string
    kaynakId: string | null
    degisti: boolean
    onayTarihi: string | null
    onaylayan: string | null
    kilitli: boolean
    elle: boolean
    acilis: boolean
  }
  satirlar: FisSatiri[]
  kaynak: { tip: string; ad: string; no: string | null; path: string | null; sirketId: string } | null
  komsu: { onceki: string | null; sonraki: string | null; sira: number; toplam: number } | null
  engel: string | null
}

export default function FisDetayPage() {
  const { id } = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const sekme = searchParams.get("sekme")
  const { durum, hata: durumHata } = useMuhasebeDurumu(companyId)

  if (!companyId) return <p className="p-6 text-sm text-kobipo-gray">Firma seçiniz.</p>
  if (durum && !durum.kurulu) return <KurulumGerekli durum={durum} />
  if (!durum) return <DurumBekleniyor hata={durumHata} />
  if (id === "yeni") return <ElleFisFormu companyId={companyId} />
  if (id === "acilis") return <AcilisElleFormu companyId={companyId} durum={durum} />
  return <FisOdak key={id} id={id} companyId={companyId} sekme={sekme} />
}

function listeHref(companyId: string, sekme: string | null) {
  return withCompanyHref(`/muhasebe/fisler${sekme && sekme !== "emin" ? `?sekme=${sekme}` : ""}`, companyId)
}

function FisOdak({ id, companyId, sekme }: { id: string; companyId: string; sekme: string | null }) {
  const router = useRouter()
  const { confirm } = useConfirm()
  const canEdit = useCanEditHere()
  const { hesaplar, yenile: hesaplariYenile } = useYaprakHesaplar(companyId)
  const [veri, setVeri] = useState<FisDetay | null>(null)
  const [hata, setHata] = useState<string | null>(null)
  const [mesgul, setMesgul] = useState(false)
  const [duzenle, setDuzenle] = useState(false)

  const yukle = useCallback(async () => {
    try {
      const sp = new URLSearchParams({ companyId })
      if (sekme) sp.set("sekme", sekme)
      setVeri(await muhasebeIstegi<FisDetay>(`/api/muhasebe/fisler/${id}?${sp}`))
      setHata(null)
    } catch (e) {
      setHata(e instanceof Error ? e.message : String(e))
    }
  }, [id, companyId, sekme])

  useEffect(() => {
    void yukle()
  }, [yukle])

  const git = (hedef: string | null) => {
    if (hedef) router.push(withCompanyHref(`/muhasebe/fisler/${hedef}${sekme ? `?sekme=${sekme}` : ""}`, companyId))
    else router.push(listeHref(companyId, sekme))
  }

  const hesapSec = async (satirId: string, accountId: string | null) => {
    setMesgul(true)
    try {
      await muhasebeIstegi(`/api/muhasebe/fisler/${id}`, {
        method: "PUT",
        body: JSON.stringify({ companyId, satirHesaplari: [{ satirId, accountId }] }),
      })
      await yukle()
    } catch (e) {
      hataBildir(e, "Hesap kaydedilemedi")
    } finally {
      setMesgul(false)
    }
  }

  const islem = async (ad: "onayla" | "geri-al" | "yeniden-uret", sonraki = false) => {
    if (ad === "geri-al") {
      const ok = await confirm({
        title: "Onay geri alınsın mı?",
        description: "Fiş taslağa döner ve defterden (yevmiye, kebir, mizan) çıkar.",
        confirmLabel: "Geri al",
      })
      if (!ok) return
    }
    setMesgul(true)
    try {
      const r = await muhasebeIstegi<{ ogrenilen?: number; yayilan?: number; silindi?: boolean }>(`/api/muhasebe/fisler/${id}`, {
        method: "POST",
        body: JSON.stringify({ companyId, islem: ad }),
      })
      if (ad === "onayla") {
        toast({
          title: `${veri?.fis.voucherNo} onaylandı`,
          description: r.ogrenilen
            ? `${r.ogrenilen} hesap eşleşmesi öğrenildi${r.yayilan ? `; ${r.yayilan} taslak fiş buna göre güncellendi` : ""}.`
            : undefined,
        })
        if (sonraki) return git(veri?.komsu?.sonraki ?? null)
      } else if (ad === "yeniden-uret" && r.silindi) {
        toast({ title: "Fiş kaldırıldı", description: "Belge artık fişe girmiyor (iptal edilmiş ya da silinmiş)." })
        return git(null)
      }
      await yukle()
    } catch (e) {
      hataBildir(e)
    } finally {
      setMesgul(false)
    }
  }

  const sil = async () => {
    const ok = await confirm({ title: "Elle fiş silinsin mi?", variant: "destructive", confirmLabel: "Sil" })
    if (!ok) return
    try {
      await muhasebeIstegi(`/api/muhasebe/fisler/${id}?companyId=${encodeURIComponent(companyId)}`, { method: "DELETE" })
      git(null)
    } catch (e) {
      hataBildir(e, "Silinemedi")
    }
  }

  if (hata && !veri) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <GeriLinki companyId={companyId} sekme={sekme} />
        <Uyari ton="kirmizi">{hata}</Uyari>
      </div>
    )
  }
  if (!veri) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-kobipo-gray">
        <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
      </div>
    )
  }

  const { fis, satirlar, kaynak, komsu, engel } = veri
  if (duzenle && fis.elle) {
    return <ElleFisFormu companyId={companyId} mevcut={veri} onBitti={() => { setDuzenle(false); void yukle() }} />
  }

  const taslak = fis.durum === "DRAFT"
  const hesapDegisir = taslak && !fis.kilitli && canEdit
  const borc = satirlar.filter((s) => s.taraf === "B").reduce((a, s) => a + s.tutar, 0)
  const alacak = satirlar.filter((s) => s.taraf === "A").reduce((a, s) => a + s.tutar, 0)
  const ogrenen = satirlar.some((s) => s.ogrenir && s.kaynak === "USER")

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <GeriLinki companyId={companyId} sekme={sekme} />
        {komsu && (
          <div className="flex items-center gap-2 text-sm text-kobipo-gray">
            <span>
              {komsu.sira > 0 ? `${komsu.sira} / ${komsu.toplam}` : `${komsu.toplam} fiş`}
            </span>
            <Button size="sm" variant="outline" disabled={!komsu.onceki} onClick={() => git(komsu.onceki)} aria-label="Önceki fiş">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" disabled={!komsu.sonraki} onClick={() => git(komsu.sonraki)} aria-label="Sonraki fiş">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
      <ReadOnlyBanner />

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold text-kobipo-navy dark:text-foreground">
            <span className="font-mono">{fis.voucherNo}</span>
            <span className="text-base font-semibold text-kobipo-gray">{FIS_TURU[fis.tur] ?? fis.tur} fişi</span>
          </h1>
          <p className="mt-1 text-sm text-kobipo-gray">
            {gunMetni(fis.tarih)} · {fis.aciklama || "—"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "rounded-lg px-2.5 py-1 text-xs font-semibold",
              taslak
                ? "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
                : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200",
            )}
          >
            {taslak ? "Taslak" : "Onaylı"}
          </span>
          {fis.degisti && (
            <span className="rounded-lg bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-800 dark:bg-red-950/50 dark:text-red-200">
              Belge değişti
            </span>
          )}
          {fis.kilitli && (
            <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              Kapanmış dönem
            </span>
          )}
        </div>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        {/* Kaynak */}
        <Kart className="space-y-3 self-start">
          <p className="text-xs font-semibold uppercase tracking-wide text-kobipo-gray">Kaynak</p>
          <div>
            <p className="font-semibold text-kobipo-navy dark:text-foreground">{kaynak?.ad ?? KAYNAK_TURU[fis.kaynakTipi] ?? fis.kaynakTipi}</p>
            {kaynak?.no && <p className="font-mono text-sm text-kobipo-gray">{kaynak.no}</p>}
          </div>
          {kaynak?.path && (
            <a
              href={withCompanyHref(kaynak.path, kaynak.sirketId)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-kobipo-blue hover:underline"
            >
              Belgeyi aç <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          {!taslak && (
            <p className="text-xs text-kobipo-gray">
              Onay: {fis.onayTarihi ? new Date(fis.onayTarihi).toLocaleString("tr-TR") : "—"}
              {fis.onaylayan ? ` · ${fis.onaylayan}` : ""}
            </p>
          )}
          {taslak && (
            <p className="text-xs text-kobipo-gray">
              Satırlardaki hesabı değiştirirseniz seçiminiz <strong>onayda öğrenilir</strong>: aynı ürün/tedarikçinin sonraki
              belgeleri o hesapla gelir.
            </p>
          )}
        </Kart>

        {/* Satırlar */}
        <Kart className="space-y-3">
          {fis.degisti && (
            <Uyari ton="kirmizi">
              Bu fiş onaylandıktan sonra belgesi değişti. Defterde eski hâli duruyor. <strong>Yeniden üret</strong> fişi belgenin
              bugünkü hâlinden kurar (onayladığınız hesaplar korunur) ve taslağa döndürür.
            </Uyari>
          )}
          {/* Masaüstünde taşma serbest: overflow-x-auto dikeyi de kırpar ve hesap seçicinin
              açılır listesi kutunun içinde kalırdı. Dar ekranda yatay kaydırma gerekir. */}
          <div className="overflow-x-auto md:overflow-visible">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs font-semibold uppercase tracking-wide text-kobipo-gray">
                <tr>
                  <th className="py-2 pr-2">Hesap</th>
                  <th className="py-2 pr-2">Açıklama</th>
                  <th className="py-2 pr-2 text-right">Borç (₺)</th>
                  <th className="py-2 text-right">Alacak (₺)</th>
                </tr>
              </thead>
              <tbody>
                {satirlar.map((s) => {
                  const rozet = HESAP_KAYNAGI[s.kaynak]
                  const sorunlu = !s.hesap || !s.hesap.uygun
                  return (
                    <tr key={s.id} className="border-t border-kobipo-border/60 align-top">
                      <td className="w-[46%] py-2 pr-2">
                        {hesapDegisir ? (
                          <HesapSecici
                            companyId={companyId}
                            hesaplar={hesaplar}
                            deger={s.hesap?.uygun ? s.hesap.id : null}
                            oneriKodu={s.oneriKodu || s.hesap?.kod?.split(".")[0]}
                            onSec={(hid) => hesapSec(s.id, hid)}
                            onHesapAcildi={hesaplariYenile}
                            disabled={mesgul}
                            hatali={sorunlu}
                          />
                        ) : (
                          <span className={cn("text-kobipo-navy dark:text-foreground", sorunlu && "text-red-700 dark:text-red-300")}>
                            {s.hesap ? (
                              <>
                                <span className="font-mono">{s.hesap.kod}</span> {s.hesap.ad}
                              </>
                            ) : (
                              `Hesap seçilmedi (öneri ${s.oneriKodu || "—"})`
                            )}
                          </span>
                        )}
                        <div className="mt-1 flex flex-wrap gap-1">
                          {rozet && <span className={cn("rounded px-1.5 py-0.5 text-[11px]", rozet.sinif)}>{rozet.ad}</span>}
                          {s.hesap && !s.hesap.uygun && (
                            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] text-red-800 dark:bg-red-950/50 dark:text-red-200">
                              alt hesabı olan / pasif hesap — alt hesap seçin
                            </span>
                          )}
                          {s.ogrenir && taslak && (
                            <span className="inline-flex items-center gap-1 rounded bg-kobipo-offwhite px-1.5 py-0.5 text-[11px] text-kobipo-gray dark:bg-muted">
                              <GraduationCap className="h-3 w-3" /> öğrenilir
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 pr-2 text-kobipo-gray">{s.aciklama || "—"}</td>
                      <td className="whitespace-nowrap py-2 pr-2 text-right tabular-nums text-kobipo-navy dark:text-foreground">
                        {s.taraf === "B" ? tutar(s.tutar) : ""}
                      </td>
                      <td className="whitespace-nowrap py-2 text-right tabular-nums text-kobipo-navy dark:text-foreground">
                        {s.taraf === "A" ? tutar(s.tutar) : ""}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-kobipo-border font-semibold text-kobipo-navy dark:text-foreground">
                  <td className="py-2" colSpan={2}>
                    Toplam
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">{tutarSifirli(borc)}</td>
                  <td className="py-2 text-right tabular-nums">{tutarSifirli(alacak)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {fis.acilis && taslak && !fis.kilitli && (
            <AcilisFarkiEditoru companyId={companyId} veri={veri} hesaplar={hesaplar} onHesapAcildi={hesaplariYenile} onKaydedildi={yukle} />
          )}

          {taslak && engel && <Uyari>{engel}</Uyari>}
          {taslak && !engel && ogrenen && (
            <Uyari ton="mavi">Elle seçtiğiniz hesaplar onaylayınca öğrenilecek ve bekleyen benzer taslaklara uygulanacak.</Uyari>
          )}

          <div className="flex flex-wrap justify-end gap-2 border-t border-kobipo-border/60 pt-3">
            {taslak && fis.elle && (
              <>
                <WriteAction>
                  <Button variant="ghost" onClick={sil} disabled={mesgul || fis.kilitli}>
                    <Trash2 className="mr-2 h-4 w-4" /> Sil
                  </Button>
                </WriteAction>
                <WriteAction>
                  <Button variant="outline" onClick={() => setDuzenle(true)} disabled={mesgul || fis.kilitli}>
                    <Pencil className="mr-2 h-4 w-4" /> Düzenle
                  </Button>
                </WriteAction>
              </>
            )}
            {!taslak && fis.degisti && (
              <WriteAction>
                <Button variant="outline" onClick={() => islem("yeniden-uret")} disabled={mesgul || fis.kilitli}>
                  <RefreshCw className="mr-2 h-4 w-4" /> Yeniden üret
                </Button>
              </WriteAction>
            )}
            {!taslak && (
              <WriteAction>
                <Button variant="outline" onClick={() => islem("geri-al")} disabled={mesgul || fis.kilitli}>
                  <RotateCcw className="mr-2 h-4 w-4" /> Onayı geri al
                </Button>
              </WriteAction>
            )}
            {taslak && (
              <>
                <WriteAction>
                  <Button variant="outline" onClick={() => islem("onayla")} disabled={mesgul || Boolean(engel)}>
                    <Check className="mr-2 h-4 w-4" /> Onayla
                  </Button>
                </WriteAction>
                {komsu && (
                  <WriteAction>
                    <Button onClick={() => islem("onayla", true)} disabled={mesgul || Boolean(engel)}>
                      {mesgul ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                      Onayla ve sıradaki
                    </Button>
                  </WriteAction>
                )}
              </>
            )}
          </div>
        </Kart>
      </div>
    </div>
  )
}

function GeriLinki({ sekme }: { companyId?: string; sekme: string | null }) {
  return (
    <CompanyLink
      href={`/muhasebe/fisler${sekme && sekme !== "emin" ? `?sekme=${sekme}` : ""}`}
      className="inline-flex items-center gap-1.5 text-sm font-semibold text-kobipo-blue hover:underline"
    >
      <ArrowLeft className="h-4 w-4" /> Fişler
    </CompanyLink>
  )
}

/** Açılış fişinin fark satırını elle satırlarla dağıtmak (153 stok, 255 demirbaş, 500 sermaye…). */
function AcilisFarkiEditoru({
  companyId,
  veri,
  hesaplar,
  onHesapAcildi,
  onKaydedildi,
}: {
  companyId: string
  veri: FisDetay
  hesaplar: ReturnType<typeof useYaprakHesaplar>["hesaplar"]
  onHesapAcildi: () => Promise<void>
  onKaydedildi: () => Promise<void>
}) {
  const router = useRouter()
  const ilk = useMemo(
    () =>
      veri.satirlar
        .filter((s) => s.rol === "MANUEL")
        .map((s) => ({
          ...yeniSatir(s.taraf === "B" ? "DEBIT" : "CREDIT", String(s.tutar).replace(".", ",")),
          accountId: s.hesap?.id ?? null,
          description: s.aciklama ?? "",
        })),
    [veri],
  )
  const [satirlar, setSatirlar] = useState<ElleSatirTaslagi[]>(ilk)
  const [kaydediliyor, setKaydediliyor] = useState(false)
  useEffect(() => setSatirlar(ilk), [ilk])
  const fark = veri.satirlar.find((s) => s.rol === "ACILIS_FARK")

  const kaydet = async () => {
    setKaydediliyor(true)
    try {
      const r = await muhasebeIstegi<{ silindi?: boolean }>(`/api/muhasebe/fisler/${veri.fis.id}`, {
        method: "PUT",
        body: JSON.stringify({
          companyId,
          elleSatirlar: satirlar
            .filter((s) => s.amount.trim())
            .map((s) => ({ side: s.side, amount: tutarOku(s.amount), accountId: s.accountId, description: s.description })),
        }),
      })
      if (r.silindi) {
        // Başlangıçta bakiye yok ve son elle satır da silindi: satırsız açılış fişi tutulmaz.
        toast({ title: "Açılış fişi kaldırıldı", description: "Satırı kalmadı; gerekirse Muhasebe Ayarları'ndan yeniden açabilirsiniz." })
        router.replace(withCompanyHref("/muhasebe/ayarlar", companyId))
        return
      }
      toast({ title: "Açılış satırları kaydedildi" })
      await onKaydedildi()
    } catch (e) {
      hataBildir(e, "Kaydedilemedi")
    } finally {
      setKaydediliyor(false)
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-dashed border-kobipo-border p-3">
      <div>
        <p className="font-semibold text-kobipo-navy dark:text-foreground">Farkı dağıt</p>
        <p className="text-sm text-kobipo-gray">
          Kobipo&apos;da tutulmayan açılış kalemlerini (stok 153, demirbaş 255, birikmiş amortisman 257, sermaye 500, kredi
          300…) satır olarak ekleyin. Fark satırı her kayıtta yeniden hesaplanır; sıfırlanınca kalkar. İsterseniz fark satırına
          doğrudan bir hesap da seçebilirsiniz.
          {fark && <> Kalan fark: <strong>{tutarSifirli(fark.tutar)}</strong> ({fark.taraf === "A" ? "alacak" : "borç"}).</>}
        </p>
      </div>
      <ElleSatirEditoru
        companyId={companyId}
        hesaplar={hesaplar}
        satirlar={satirlar}
        onDegis={setSatirlar}
        onHesapAcildi={onHesapAcildi}
        disabled={kaydediliyor}
      />
      <div className="flex justify-end">
        <WriteAction>
          <Button onClick={kaydet} disabled={kaydediliyor}>
            {kaydediliyor ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Satırları kaydet
          </Button>
        </WriteAction>
      </div>
    </div>
  )
}

/**
 * Başlangıçta Kobipo'da bakiye yoksa açılış fişi kendiliğinden açılmaz (satırsız taslak
 * kapanışı kilitlerdi). Müşavirin Kobipo'da tutulmayan açılış kalemleri için fiş burada,
 * ilk satırlarıyla birlikte açılır. Fiş zaten varsa ona yönlenir — boş form mevcut elle
 * satırların üstüne yazılmasın.
 */
function AcilisElleFormu({ companyId, durum }: { companyId: string; durum: MuhasebeDurumu }) {
  const router = useRouter()
  const { hesaplar, yenile } = useYaprakHesaplar(companyId)
  const [satirlar, setSatirlar] = useState<ElleSatirTaslagi[]>(() => [yeniSatir("DEBIT"), yeniSatir("CREDIT")])
  const [kaydediliyor, setKaydediliyor] = useState(false)
  const { borc, alacak } = elleToplamlar(satirlar)
  const mevcutId = durum.acilis?.id ?? null
  useEffect(() => {
    if (mevcutId) router.replace(withCompanyHref(`/muhasebe/fisler/${mevcutId}`, companyId))
  }, [mevcutId, companyId, router])

  const kaydet = async () => {
    setKaydediliyor(true)
    try {
      const r = await muhasebeIstegi<{ id: string }>("/api/muhasebe/fisler", {
        method: "POST",
        body: JSON.stringify({
          companyId,
          acilis: true,
          elleSatirlar: satirlar
            .filter((s) => s.amount.trim())
            .map((s) => ({ side: s.side, amount: tutarOku(s.amount), accountId: s.accountId, description: s.description })),
        }),
      })
      toast({ title: "Açılış fişi açıldı", description: "Taslak olarak kaydedildi; onaylayınca açılış bakiyeleri mizana girer." })
      router.replace(withCompanyHref(`/muhasebe/fisler/${r.id}`, companyId))
    } catch (e) {
      hataBildir(e, "Açılış fişi açılamadı")
    } finally {
      setKaydediliyor(false)
    }
  }

  if (mevcutId) return <DurumBekleniyor hata={null} />
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <CompanyLink
        href="/muhasebe/ayarlar"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-kobipo-blue hover:underline"
      >
        <ArrowLeft className="h-4 w-4" /> Muhasebe ayarları
      </CompanyLink>
      <ReadOnlyBanner />
      <h1 className="text-2xl font-bold text-kobipo-navy dark:text-foreground">Açılış fişi</h1>
      <p className="text-sm text-kobipo-gray">
        {gunMetni(durum.ayar?.baslangic)} tarihinde Kobipo&apos;da bakiye yok, bu yüzden açılış fişi kendiliğinden açılmadı.
        Kobipo&apos;da tutulmayan açılış kalemlerini (stok 153, demirbaş 255, birikmiş amortisman 257, sermaye 500, kredi
        300…) girin; fiş bu satırlarla taslak olarak açılır. Borç ve alacak eşit değilse farkı ayrı bir satır olarak eklenir.
      </p>
      <Kart className="space-y-4">
        <ElleSatirEditoru companyId={companyId} hesaplar={hesaplar} satirlar={satirlar} onDegis={setSatirlar} onHesapAcildi={yenile} disabled={kaydediliyor} />
        <DengeSatiri borc={borc} alacak={alacak} />
        <div className="flex justify-end">
          <WriteAction>
            <Button onClick={kaydet} disabled={kaydediliyor || borc + alacak === 0}>
              {kaydediliyor ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Açılış fişini aç
            </Button>
          </WriteAction>
        </div>
      </Kart>
    </div>
  )
}

/** Yeni elle fiş ya da mevcut elle fişin düzenlenmesi. */
function ElleFisFormu({ companyId, mevcut, onBitti }: { companyId: string; mevcut?: FisDetay; onBitti?: () => void }) {
  const router = useRouter()
  const { hesaplar, yenile } = useYaprakHesaplar(companyId)
  const [tarih, setTarih] = useState(mevcut?.fis.tarih ?? new Date().toISOString().slice(0, 10))
  const [aciklama, setAciklama] = useState(mevcut?.fis.aciklama ?? "")
  const [satirlar, setSatirlar] = useState<ElleSatirTaslagi[]>(() =>
    mevcut
      ? mevcut.satirlar.map((s) => ({
          ...yeniSatir(s.taraf === "B" ? "DEBIT" : "CREDIT", String(s.tutar).replace(".", ",")),
          accountId: s.hesap?.id ?? null,
          description: s.aciklama ?? "",
        }))
      : [yeniSatir("DEBIT"), yeniSatir("CREDIT")],
  )
  const [kaydediliyor, setKaydediliyor] = useState(false)
  const { borc, alacak } = elleToplamlar(satirlar)

  const kaydet = async () => {
    setKaydediliyor(true)
    try {
      const govde = {
        companyId,
        tarih,
        aciklama,
        satirlar: satirlar.map((s) => ({
          side: s.side,
          amount: tutarOku(s.amount),
          accountId: s.accountId,
          description: s.description,
        })),
      }
      if (mevcut) {
        await muhasebeIstegi(`/api/muhasebe/fisler/${mevcut.fis.id}`, { method: "PUT", body: JSON.stringify(govde) })
        toast({ title: "Fiş kaydedildi" })
        onBitti?.()
      } else {
        const r = await muhasebeIstegi<{ id: string }>("/api/muhasebe/fisler", { method: "POST", body: JSON.stringify(govde) })
        toast({ title: "Elle fiş açıldı", description: "Taslak olarak kaydedildi; onaylayınca deftere işlenir." })
        router.replace(withCompanyHref(`/muhasebe/fisler/${r.id}?sekme=tum`, companyId))
      }
    } catch (e) {
      hataBildir(e, "Fiş kaydedilemedi")
    } finally {
      setKaydediliyor(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <GeriLinki companyId={companyId} sekme={mevcut ? "tum" : null} />
      <ReadOnlyBanner />
      <h1 className="text-2xl font-bold text-kobipo-navy dark:text-foreground">
        {mevcut ? `${mevcut.fis.voucherNo} — düzenle` : "Yeni elle fiş"}
      </h1>
      <p className="text-sm text-kobipo-gray">
        Belgesi olmayan kayıtlar için: amortisman, sermaye, stok devri, düzeltme. Fiş taslak olarak kaydedilir, onaylayınca
        deftere işlenir.
      </p>
      <Kart className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[11rem_minmax(0,1fr)]">
          <div className="space-y-1.5">
            <Label htmlFor="fis-tarih">Tarih</Label>
            <Input id="fis-tarih" type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fis-aciklama">Açıklama</Label>
            <Input id="fis-aciklama" value={aciklama} onChange={(e) => setAciklama(e.target.value)} placeholder="Ör. Eylül amortismanı" />
          </div>
        </div>
        <ElleSatirEditoru companyId={companyId} hesaplar={hesaplar} satirlar={satirlar} onDegis={setSatirlar} onHesapAcildi={yenile} disabled={kaydediliyor} />
        <DengeSatiri borc={borc} alacak={alacak} />
        <div className="flex justify-end gap-2">
          {mevcut && (
            <Button variant="ghost" onClick={onBitti} disabled={kaydediliyor}>
              Vazgeç
            </Button>
          )}
          <WriteAction>
            <Button onClick={kaydet} disabled={kaydediliyor || borc === 0 || borc !== alacak}>
              {kaydediliyor ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Kaydet
            </Button>
          </WriteAction>
        </div>
      </Kart>
    </div>
  )
}
