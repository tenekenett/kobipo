"use client"

import { useCallback, useEffect, useState } from "react"
import { Loader2, Lock, Unlock } from "lucide-react"
import { WriteAction } from "@/components/dashboard/write-guard"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { Kart, Uyari, gunMetni, hataBildir, muhasebeIstegi, tutarSifirli, type MuhasebeDurumu } from "@/components/muhasebe/ortak"
import { tutarOku } from "@/components/muhasebe/elle-satir-editoru"

/**
 * Dönem kapanışı — Muhasebe Ayarları'nın son bölümü. Kural lib/muhasebe/kapanis.ts:
 * SMM (sayım tutarıyla), 7/A yansıtma, 690, 590/591, yıl sonu kapanış ve ertesi yıl
 * açılış fişleri; dönem kilitlenir.
 */

type Durum = {
  yil: number
  kapanmis: boolean
  taslak: number
  engeller: string[]
  uyarilar: string[]
  netKar: number
  stok153: number
  fisler: Array<{ anahtar: string; aciklama: string; tarih: string; tutar: number; satirSayisi: number }>
}

export function DonemKapanisi({
  companyId,
  durum,
  onDegisti,
}: {
  companyId: string
  durum: MuhasebeDurumu
  onDegisti: () => Promise<void> | void
}) {
  const { confirm } = useConfirm()
  const baslangicYili = Number((durum.ayar?.baslangic ?? `${new Date().getFullYear()}`).slice(0, 4))
  const buYil = new Date().getFullYear()
  const yillar = Array.from({ length: Math.max(1, buYil - baslangicYili + 1) }, (_, i) => baslangicYili + i)
  const varsayilanYil = durum.ayar?.kilitliSonGun ? Math.min(Number(durum.ayar.kilitliSonGun.slice(0, 4)) + 1, buYil) : baslangicYili
  const [yil, setYil] = useState(varsayilanYil)
  const [stok, setStok] = useState("")
  const [onizleme, setOnizleme] = useState<Durum | null>(null)
  const [mesgul, setMesgul] = useState(false)

  const yukle = useCallback(async () => {
    try {
      const q = new URLSearchParams({ companyId, yil: String(yil) })
      const n = tutarOku(stok)
      if (Number.isFinite(n)) q.set("stok", String(n))
      setOnizleme(await muhasebeIstegi<Durum>(`/api/muhasebe/kapanis?${q}`))
    } catch (e) {
      hataBildir(e, "Kapanış ön izlemesi alınamadı")
    }
  }, [companyId, yil, stok])

  useEffect(() => {
    void yukle()
    // Sayım tutarı yazılırken her tuşta istek atılmasın: yalnız yıl değişince.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, yil])

  const kapat = async () => {
    const ok = await confirm({
      title: `${yil} dönemi kapatılsın mı?`,
      description: `Kapanış fişleri onaylı olarak yazılır ve 31.12.${yil} dahil önceki tarihler kilitlenir: bu tarihlerdeki fişler değiştirilemez, yeni fiş açılmaz. Gerekirse en son kapanan yıl geri alınabilir.`,
      confirmLabel: "Dönemi kapat",
    })
    if (!ok) return
    setMesgul(true)
    try {
      const n = tutarOku(stok)
      const r = await muhasebeIstegi<{ netKar: number; fisSayisi: number }>("/api/muhasebe/kapanis", {
        method: "POST",
        body: JSON.stringify({ companyId, yil, kapanisStoku: Number.isFinite(n) ? n : null }),
      })
      toast({
        title: `${yil} kapandı`,
        description: `${r.fisSayisi} kapanış fişi yazıldı · dönem net ${r.netKar >= 0 ? "kârı" : "zararı"} ₺${tutarSifirli(Math.abs(r.netKar))}`,
      })
      await onDegisti()
      await yukle()
    } catch (e) {
      hataBildir(e, "Dönem kapatılamadı")
    } finally {
      setMesgul(false)
    }
  }

  const geriAl = async () => {
    const ok = await confirm({
      title: `${yil} kapanışı geri alınsın mı?`,
      description: "Kapanış fişleri silinir, dönem kilidi kalkar.",
      confirmLabel: "Geri al",
      variant: "destructive",
    })
    if (!ok) return
    setMesgul(true)
    try {
      await muhasebeIstegi(`/api/muhasebe/kapanis?companyId=${encodeURIComponent(companyId)}&yil=${yil}`, { method: "DELETE" })
      toast({ title: `${yil} kapanışı geri alındı` })
      await onDegisti()
      await yukle()
    } catch (e) {
      hataBildir(e, "Geri alınamadı")
    } finally {
      setMesgul(false)
    }
  }

  return (
    <Kart className="space-y-4">
      <div className="flex items-center gap-2.5">
        <span className="rounded-xl bg-kobipo-pale p-2 text-kobipo-blue">
          <Lock className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <h2 className="font-bold text-kobipo-navy dark:text-foreground">Dönem kapanışı</h2>
          <p className="text-sm text-kobipo-gray">
            Yıl sonu: satılan malın maliyeti, 7/A yansıtma, gelir tablosunun 690&apos;a kapanışı, kâr/zarar devri, kapanış ve açılış
            fişleri.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="kapanis-yil">Yıl</Label>
          <select
            id="kapanis-yil"
            value={yil}
            onChange={(e) => setYil(Number(e.target.value))}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            {yillar.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        {!onizleme?.kapanmis && (
          <div className="space-y-1.5">
            <Label htmlFor="kapanis-stok">Yıl sonu stok sayımı (153, ₺)</Label>
            <Input
              id="kapanis-stok"
              inputMode="decimal"
              value={stok}
              onChange={(e) => setStok(e.target.value)}
              onBlur={() => void yukle()}
              placeholder={onizleme ? `Defterde ${tutarSifirli(onizleme.stok153)}` : "0,00"}
              className="w-56 text-right tabular-nums"
            />
          </div>
        )}
      </div>

      {!onizleme ? (
        <p className="flex items-center gap-2 text-sm text-kobipo-gray">
          <Loader2 className="h-4 w-4 animate-spin" /> Ön izleme hazırlanıyor…
        </p>
      ) : onizleme.kapanmis ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-kobipo-navy dark:text-foreground">
            {yil} kapanmış{durum.ayar?.kilitliSonGun ? ` — ${gunMetni(durum.ayar.kilitliSonGun)} dahil önceki tarihler kilitli.` : "."}
          </p>
          <WriteAction>
            <Button variant="outline" onClick={geriAl} disabled={mesgul}>
              <Unlock className="mr-2 h-4 w-4" /> Kapanışı geri al
            </Button>
          </WriteAction>
        </div>
      ) : (
        <>
          {onizleme.engeller.length > 0 && (
            <Uyari ton="kirmizi">
              {onizleme.engeller.map((e) => (
                <p key={e}>{e}</p>
              ))}
            </Uyari>
          )}
          {onizleme.uyarilar.length > 0 && (
            <Uyari>
              {onizleme.uyarilar.map((e) => (
                <p key={e}>{e}</p>
              ))}
            </Uyari>
          )}
          {onizleme.fisler.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs font-semibold uppercase tracking-wide text-kobipo-gray">
                  <tr>
                    <th className="py-1.5">Kapanış fişi</th>
                    <th className="py-1.5">Tarih</th>
                    <th className="py-1.5 text-right">Satır</th>
                    <th className="py-1.5 text-right">Tutar (₺)</th>
                  </tr>
                </thead>
                <tbody>
                  {onizleme.fisler.map((f) => (
                    <tr key={f.anahtar} className="border-t border-kobipo-border/60">
                      <td className="py-1.5 text-kobipo-navy dark:text-foreground">{f.aciklama}</td>
                      <td className="py-1.5 text-kobipo-gray">{gunMetni(f.tarih)}</td>
                      <td className="py-1.5 text-right tabular-nums text-kobipo-gray">{f.satirSayisi}</td>
                      <td className="py-1.5 text-right tabular-nums">{tutarSifirli(f.tutar)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold text-kobipo-navy dark:text-foreground">
              Dönem net {onizleme.netKar >= 0 ? "kârı" : "zararı"}: ₺{tutarSifirli(Math.abs(onizleme.netKar))}
            </p>
            <WriteAction>
              <Button onClick={kapat} disabled={mesgul || onizleme.engeller.length > 0 || onizleme.fisler.length === 0}>
                {mesgul ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
                Dönemi kapat
              </Button>
            </WriteAction>
          </div>
          <p className="text-xs text-kobipo-gray">
            Kâr dağıtımı (590 → 570 / 540) genel kurul kararıdır, ertesi yıl elle fişle girilir. Dönem vergi karşılığını (691 / 370)
            kapanıştan önce elle fiş olarak girerseniz 590&apos;a vergi sonrası kâr geçer.
          </p>
        </>
      )}
    </Kart>
  )
}
