"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react"
import { CompanyLink } from "@/components/dashboard/company-link"
import { ReadOnlyBanner, WriteAction } from "@/components/dashboard/write-guard"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { trMatcher } from "@/lib/text/tr-fold"
import { cn } from "@/lib/utils"
import {
  KurulumGerekli,
  SayfaBasligi,
  Uyari,
  hataBildir,
  muhasebeIstegi,
  useMuhasebeDurumu,
  type PlanHesabi,
} from "@/components/muhasebe/ortak"

/**
 * Hesap Planı — Tekdüzen planı + firmanın alt hesapları (plan §2.4).
 * Cari/kasa/personel alt hesapları fiş üretiminde kendiliğinden açılır (120.01.0001…);
 * kullanıcı istediği hesabın altına kendi alt hesabını açar (ör. 770.01 Kira).
 * Fişe yalnız YAPRAK hesap yazılır; fişte kullanılmış hesap silinmez, pasife alınır.
 */

const SINIFLAR = [
  { k: "1", ad: "1 Dönen Varlıklar" },
  { k: "2", ad: "2 Duran Varlıklar" },
  { k: "3", ad: "3 KV Yabancı Kaynaklar" },
  { k: "4", ad: "4 UV Yabancı Kaynaklar" },
  { k: "5", ad: "5 Öz Kaynaklar" },
  { k: "6", ad: "6 Gelir Tablosu" },
  { k: "7", ad: "7 Maliyet" },
]

const BAGLI_AD: Record<string, string> = { musteri: "müşteri", tedarikci: "tedarikçi", personel: "personel", finans: "kasa/banka" }

type Hesap = PlanHesabi & { tur: string }

export default function HesapPlaniPage() {
  const companyId = useSearchParams().get("company")
  const { durum } = useMuhasebeDurumu(companyId)
  const { prompt, confirm } = useConfirm()
  const [hesaplar, setHesaplar] = useState<Hesap[] | null>(null)
  const [hata, setHata] = useState<string | null>(null)
  const [sinif, setSinif] = useState("1")
  const [arama, setArama] = useState("")
  const [yalnizKullanilan, setYalnizKullanilan] = useState(false)

  const yukle = useCallback(async () => {
    if (!companyId) return
    try {
      const r = await muhasebeIstegi<{ hesaplar: Hesap[] }>(`/api/muhasebe/hesap-plani?companyId=${encodeURIComponent(companyId)}`)
      setHesaplar(r.hesaplar)
      setHata(null)
    } catch (e) {
      setHata(e instanceof Error ? e.message : String(e))
    }
  }, [companyId])

  useEffect(() => {
    if (durum?.kurulu) void yukle()
  }, [durum?.kurulu, yukle])

  const gorunen = useMemo(() => {
    const eslesir = trMatcher(arama)
    const liste = hesaplar ?? []
    if (arama.trim()) return liste.filter((h) => eslesir(h.kod, h.ad))
    return liste.filter((h) => h.kod.startsWith(sinif) && (!yalnizKullanilan || h.kullanim > 0 || h.duzey <= 2 || !h.yaprak))
  }, [hesaplar, arama, sinif, yalnizKullanilan])

  if (!companyId) return <p className="p-6 text-sm text-kobipo-gray">Firma seçiniz.</p>
  if (durum && !durum.kurulu) return <KurulumGerekli durum={durum} />

  const altHesapAc = async (ust: Hesap) => {
    const ad = await prompt({
      title: `${ust.kod} ${ust.ad} — alt hesap`,
      description:
        ust.yaprak && ust.kullanim > 0
          ? "Bu hesaba yazılmış fiş satırları var. Taslak satırlar yeni alt hesaba geçmek için yeniden hesap seçimi ister."
          : "Kod sıradaki numarayla verilir.",
      label: "Hesap adı",
      minLength: 2,
      confirmLabel: "Aç",
    })
    if (ad === null) return
    try {
      const r = await muhasebeIstegi<{ hesap: { kod: string } }>("/api/muhasebe/hesap-plani", {
        method: "POST",
        body: JSON.stringify({ companyId, ustKod: ust.kod, ad: ad.trim() }),
      })
      toast({ title: `${r.hesap.kod} açıldı` })
      await yukle()
    } catch (e) {
      hataBildir(e, "Alt hesap açılamadı")
    }
  }

  const adDegistir = async (h: Hesap) => {
    const ad = await prompt({ title: `${h.kod} — ad değiştir`, label: "Hesap adı", defaultValue: h.ad, minLength: 2, confirmLabel: "Kaydet" })
    if (ad === null || ad.trim() === h.ad) return
    try {
      await muhasebeIstegi("/api/muhasebe/hesap-plani", { method: "PATCH", body: JSON.stringify({ companyId, id: h.id, ad: ad.trim() }) })
      await yukle()
    } catch (e) {
      hataBildir(e)
    }
  }

  const aktiflik = async (h: Hesap, aktif: boolean) => {
    try {
      await muhasebeIstegi("/api/muhasebe/hesap-plani", { method: "PATCH", body: JSON.stringify({ companyId, id: h.id, aktif }) })
      await yukle()
    } catch (e) {
      hataBildir(e)
    }
  }

  const sil = async (h: Hesap) => {
    if (!(await confirm({ title: `${h.kod} ${h.ad} silinsin mi?`, variant: "destructive", confirmLabel: "Sil" }))) return
    try {
      await muhasebeIstegi(`/api/muhasebe/hesap-plani?companyId=${encodeURIComponent(companyId)}&id=${h.id}`, { method: "DELETE" })
      await yukle()
    } catch (e) {
      hataBildir(e, "Silinemedi")
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <SayfaBasligi
        baslik="Hesap Planı"
        aciklama="Tekdüzen hesap planı ve alt hesaplarınız. Cari, kasa/banka ve personel alt hesapları fişler üretilirken kendiliğinden açılır."
      />
      <ReadOnlyBanner />
      {hata && <Uyari ton="kirmizi">{hata}</Uyari>}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-kobipo-gray" />
          <Input value={arama} onChange={(e) => setArama(e.target.value)} placeholder="Kod ya da ad ara (tüm sınıflarda)" className="pl-9" />
        </div>
        <label className="flex items-center gap-2 text-sm text-kobipo-navy dark:text-foreground">
          <Switch checked={yalnizKullanilan} onCheckedChange={setYalnizKullanilan} />
          Yalnız kullanılanlar
        </label>
      </div>
      {!arama.trim() && (
        <div className="flex flex-wrap gap-1.5 overflow-x-auto">
          {SINIFLAR.map((s) => (
            <button
              key={s.k}
              type="button"
              onClick={() => setSinif(s.k)}
              className={cn(
                "rounded-xl px-3 py-1.5 text-sm font-semibold",
                sinif === s.k ? "bg-kobipo-blue text-white" : "bg-kobipo-offwhite text-kobipo-navy hover:bg-kobipo-pale dark:bg-muted/40 dark:text-foreground",
              )}
            >
              {s.ad}
            </button>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-kobipo-border/90 bg-card shadow-card">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-kobipo-offwhite text-left text-xs font-semibold uppercase tracking-wide text-kobipo-gray dark:bg-muted/40">
            <tr>
              <th className="px-3 py-2">Hesap</th>
              <th className="px-3 py-2">Fiş satırı</th>
              <th className="px-3 py-2">Aktif</th>
              <th className="px-3 py-2 text-right">İşlem</th>
            </tr>
          </thead>
          <tbody>
            {!hesaplar ? (
              <tr>
                <td colSpan={4} className="py-10 text-center">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin text-kobipo-gray" />
                </td>
              </tr>
            ) : gorunen.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-10 text-center text-kobipo-gray">
                  Hesap yok.
                </td>
              </tr>
            ) : (
              gorunen.map((h) => (
                <tr key={h.id} className={cn("border-t border-kobipo-border/60", !h.aktif && "opacity-60", h.duzey <= 2 && "bg-kobipo-offwhite/60 dark:bg-muted/20")}>
                  <td className="px-3 py-1.5" style={{ paddingLeft: `${0.75 + Math.max(0, h.duzey - 1) * 0.9}rem` }}>
                    <span className={cn("font-mono", h.duzey <= 2 ? "font-bold" : "")}>{h.kod}</span>{" "}
                    <span className={cn("text-kobipo-navy dark:text-foreground", h.duzey <= 2 && "font-semibold")}>{h.ad}</span>
                    {h.bagli && (
                      <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-[11px] text-sky-800 dark:bg-sky-950/50 dark:text-sky-200">
                        {BAGLI_AD[h.bagli] ?? h.bagli}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 tabular-nums text-kobipo-gray">
                    {h.kullanim > 0 ? (
                      <CompanyLink href={`/muhasebe/kebir?hesap=${encodeURIComponent(h.kod)}`} className="text-kobipo-blue hover:underline">
                        {h.kullanim}
                      </CompanyLink>
                    ) : (
                      ""
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    {h.duzey >= 3 && (
                      <WriteAction fallback={<span className="text-xs text-kobipo-gray">{h.aktif ? "Aktif" : "Pasif"}</span>}>
                        <Switch checked={h.aktif} onCheckedChange={(v) => aktiflik(h, v)} aria-label="Aktif" />
                      </WriteAction>
                    )}
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex justify-end gap-1">
                      {h.duzey >= 3 && (
                        <WriteAction>
                          <Button size="sm" variant="ghost" onClick={() => altHesapAc(h)} title="Alt hesap aç">
                            <Plus className="h-4 w-4" />
                          </Button>
                        </WriteAction>
                      )}
                      {h.duzey >= 3 && (
                        <WriteAction>
                          <Button size="sm" variant="ghost" onClick={() => adDegistir(h)} title="Adı değiştir">
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </WriteAction>
                      )}
                      {h.kod.includes(".") && h.yaprak && h.kullanim === 0 && !h.bagli && (
                        <WriteAction>
                          <Button size="sm" variant="ghost" onClick={() => sil(h)} title="Sil">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </WriteAction>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
