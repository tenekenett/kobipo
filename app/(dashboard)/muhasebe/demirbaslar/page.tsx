"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { ChevronDown, Loader2, Pencil, Plus, Trash2 } from "lucide-react"
import { ReadOnlyBanner, WriteAction } from "@/components/dashboard/write-guard"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { toast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { cn } from "@/lib/utils"
import {
  DurumBekleniyor,
  Kart,
  KurulumGerekli,
  SayfaBasligi,
  Uyari,
  gunMetni,
  hataBildir,
  muhasebeIstegi,
  tutarSifirli,
  useMuhasebeDurumu,
} from "@/components/muhasebe/ortak"
import { EkranAciklamasi } from "@/components/muhasebe/ekran-aciklamasi"
import { tutarOku } from "@/components/muhasebe/elle-satir-editoru"

/**
 * Demirbaşlar — amortismanın kaynağı (kural: lib/muhasebe/amortisman.ts). Her demirbaş
 * için defterin her yılına 31 Aralık tarihli taslak amortisman fişi doğar; Fişler'de
 * onaylanır. Başlangıçtan önce alınanlar açılış fişine maliyeti ve birikmiş
 * amortismanıyla girer.
 */

type Demirbas = {
  id: string
  ad: string
  hesapKodu: string
  alisTarihi: string
  maliyet: number
  omur: number
  yontem: "NORMAL" | "AZALAN"
  oncekiAmortisman: number
  cikisTarihi: string | null
  notlar: string | null
  birikmis: number
  netDeger: number
  tablo: Array<{ yil: number; tutar: number; birikmis: number }>
  oncekiOneri: number
}

const HESAPLAR = [
  { kod: "255", ad: "255 Demirbaşlar (bilgisayar, mobilya, cihaz)" },
  { kod: "254", ad: "254 Taşıtlar" },
  { kod: "253", ad: "253 Tesis, makine ve cihazlar" },
  { kod: "252", ad: "252 Binalar" },
  { kod: "264", ad: "264 Özel maliyetler (kiralık yere yapılan tadilat)" },
  { kod: "260", ad: "260 Haklar (yazılım lisansı, marka)" },
]

type Form = {
  id: string | null
  ad: string
  hesapKodu: string
  alisTarihi: string
  maliyet: string
  omur: string
  yontem: "NORMAL" | "AZALAN"
  oncekiAmortisman: string
  cikisTarihi: string
  notlar: string
}

const bosForm = (): Form => ({
  id: null,
  ad: "",
  hesapKodu: "255",
  alisTarihi: new Date().toISOString().slice(0, 10),
  maliyet: "",
  omur: "5",
  yontem: "NORMAL",
  oncekiAmortisman: "",
  cikisTarihi: "",
  notlar: "",
})

export default function DemirbaslarPage() {
  const companyId = useSearchParams().get("company")
  const { durum, hata: durumHata } = useMuhasebeDurumu(companyId)
  const { confirm } = useConfirm()
  const [veri, setVeri] = useState<{ baslangic: string; demirbaslar: Demirbas[] } | null>(null)
  const [hata, setHata] = useState<string | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [mesgul, setMesgul] = useState(false)
  const [acik, setAcik] = useState<string | null>(null)

  const yukle = useCallback(async () => {
    if (!companyId) return
    try {
      setVeri(await muhasebeIstegi(`/api/muhasebe/demirbaslar?companyId=${encodeURIComponent(companyId)}`))
      setHata(null)
    } catch (e) {
      setHata(e instanceof Error ? e.message : String(e))
    }
  }, [companyId])

  useEffect(() => {
    if (durum?.kurulu) void yukle()
  }, [durum?.kurulu, yukle])

  const toplam = useMemo(() => {
    const l = veri?.demirbaslar ?? []
    return {
      maliyet: l.reduce((a, d) => a + d.maliyet, 0),
      birikmis: l.reduce((a, d) => a + d.birikmis, 0),
      net: l.reduce((a, d) => a + d.netDeger, 0),
    }
  }, [veri])

  if (!companyId) return <p className="p-6 text-sm text-kobipo-gray">Firma seçiniz.</p>
  if (durum && !durum.kurulu) return <KurulumGerekli durum={durum} />
  if (!durum) return <DurumBekleniyor hata={durumHata} />

  const baslangicOncesi = form && veri ? form.alisTarihi < veri.baslangic : false

  const kaydet = async () => {
    if (!form) return
    setMesgul(true)
    try {
      const govde = {
        companyId,
        id: form.id,
        ad: form.ad,
        hesapKodu: form.hesapKodu,
        alisTarihi: form.alisTarihi,
        maliyet: tutarOku(form.maliyet),
        omur: Number(form.omur),
        yontem: form.yontem,
        oncekiAmortisman: baslangicOncesi ? tutarOku(form.oncekiAmortisman || "0") : 0,
        cikisTarihi: form.cikisTarihi || null,
        notlar: form.notlar,
      }
      await muhasebeIstegi("/api/muhasebe/demirbaslar", { method: form.id ? "PUT" : "POST", body: JSON.stringify(govde) })
      toast({ title: form.id ? "Demirbaş güncellendi" : "Demirbaş eklendi", description: "Amortisman fişleri Fişler ekranında taslak olarak hazır." })
      setForm(null)
      await yukle()
    } catch (e) {
      hataBildir(e, "Kaydedilemedi")
    } finally {
      setMesgul(false)
    }
  }

  const sil = async (d: Demirbas) => {
    const ok = await confirm({
      title: `${d.ad} silinsin mi?`,
      description: "Taslak amortisman fişleri kalkar; onaylanmış olanlar 'Belge değişti' sekmesine düşer.",
      confirmLabel: "Sil",
      variant: "destructive",
    })
    if (!ok) return
    try {
      await muhasebeIstegi(`/api/muhasebe/demirbaslar?companyId=${encodeURIComponent(companyId)}&id=${encodeURIComponent(d.id)}`, { method: "DELETE" })
      toast({ title: "Demirbaş silindi" })
      await yukle()
    } catch (e) {
      hataBildir(e, "Silinemedi")
    }
  }

  const duzenle = (d: Demirbas) =>
    setForm({
      id: d.id,
      ad: d.ad,
      hesapKodu: d.hesapKodu,
      alisTarihi: d.alisTarihi,
      maliyet: String(d.maliyet),
      omur: String(d.omur),
      yontem: d.yontem,
      oncekiAmortisman: String(d.oncekiAmortisman),
      cikisTarihi: d.cikisTarihi ?? "",
      notlar: d.notlar ?? "",
    })

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <SayfaBasligi
        baslik="Demirbaşlar"
        aciklama="Birden fazla yıl kullanılan varlıklarınız (bilgisayar, mobilya, araç, makine) ve yıllık amortismanları."
        sag={
          <WriteAction>
            <Button onClick={() => setForm(bosForm())}>
              <Plus className="mr-2 h-4 w-4" /> Demirbaş ekle
            </Button>
          </WriteAction>
        }
      />
      <EkranAciklamasi anahtar="demirbaslar">
        <p>
          Uzun süre kullanılan bir varlık alındığı yıl tümüyle gider yazılmaz; maliyeti <strong>faydalı ömrüne</strong> bölünerek her yıl bir
          kısmı gider olur. Buna <strong>amortisman</strong> denir. Örneğin 4 yıl ömürlü 30.000 TL&apos;lik bilgisayarın her yıl 7.500 TL&apos;si
          gider yazılır.
        </p>
        <p>
          Buraya eklediğiniz her demirbaş için Kobipo her yılın 31 Aralık&apos;ına bir amortisman fişi hazırlar (Fişler ekranında taslak).
          Faydalı ömürler Maliye&apos;nin amortisman listesinden gelir; emin değilseniz muhasebecinize sorun. Demirbaşın alış faturası ayrıca
          Fişler&apos;de &quot;Gider / hizmet alışı&quot; olarak gelir; hesabını 255 Demirbaşlar olarak seçin.
        </p>
      </EkranAciklamasi>
      <ReadOnlyBanner />
      {hata && <Uyari ton="kirmizi">{hata}</Uyari>}
      {!veri && !hata && (
        <p className="flex items-center gap-2 text-sm text-kobipo-gray">
          <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
        </p>
      )}

      {veri && veri.demirbaslar.length === 0 && (
        <Kart>
          <p className="text-sm text-kobipo-gray">Henüz demirbaş eklenmedi.</p>
        </Kart>
      )}

      {veri && veri.demirbaslar.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-kobipo-border/90 bg-card shadow-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-kobipo-offwhite text-left text-xs font-semibold uppercase tracking-wide text-kobipo-gray dark:bg-muted/40">
              <tr>
                <th className="px-3 py-2.5">Demirbaş</th>
                <th className="px-3 py-2.5">Alış</th>
                <th className="px-3 py-2.5 text-right">Maliyet</th>
                <th className="px-3 py-2.5 text-right">Birikmiş amortisman</th>
                <th className="px-3 py-2.5 text-right">Net değer</th>
                <th className="w-24 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {veri.demirbaslar.map((d) => (
                <FragmentSatir
                  key={d.id}
                  d={d}
                  acik={acik === d.id}
                  onAc={() => setAcik((a) => (a === d.id ? null : d.id))}
                  onDuzenle={() => duzenle(d)}
                  onSil={() => void sil(d)}
                />
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-kobipo-border font-bold tabular-nums text-kobipo-navy dark:text-foreground">
                <td className="px-3 py-2" colSpan={2}>
                  Toplam
                </td>
                <td className="px-3 py-2 text-right">{tutarSifirli(toplam.maliyet)}</td>
                <td className="px-3 py-2 text-right">{tutarSifirli(toplam.birikmis)}</td>
                <td className="px-3 py-2 text-right">{tutarSifirli(toplam.net)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <Dialog open={form !== null} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{form?.id ? "Demirbaşı düzenle" : "Demirbaş ekle"}</DialogTitle>
            <DialogDescription>Amortisman her yılın sonunda bu bilgilerle hesaplanır.</DialogDescription>
          </DialogHeader>
          {form && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Ad</Label>
                <Input value={form.ad} onChange={(e) => setForm({ ...form, ad: e.target.value })} placeholder="Örn. Dizüstü bilgisayar" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>Türü (hesap)</Label>
                <select
                  value={form.hesapKodu}
                  onChange={(e) => setForm({ ...form, hesapKodu: e.target.value })}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {HESAPLAR.map((h) => (
                    <option key={h.kod} value={h.kod}>
                      {h.ad}
                    </option>
                  ))}
                  {!HESAPLAR.some((h) => h.kod === form.hesapKodu) && <option value={form.hesapKodu}>{form.hesapKodu}</option>}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Alış tarihi</Label>
                <Input type="date" value={form.alisTarihi} onChange={(e) => setForm({ ...form, alisTarihi: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Maliyet (KDV hariç, ₺)</Label>
                <Input inputMode="decimal" value={form.maliyet} onChange={(e) => setForm({ ...form, maliyet: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Faydalı ömür (yıl)</Label>
                <Input type="number" min={1} max={50} value={form.omur} onChange={(e) => setForm({ ...form, omur: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Yöntem</Label>
                <select
                  value={form.yontem}
                  onChange={(e) => setForm({ ...form, yontem: e.target.value === "AZALAN" ? "AZALAN" : "NORMAL" })}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="NORMAL">Normal (her yıl eşit)</option>
                  <option value="AZALAN">Azalan bakiyeler (ilk yıllar fazla)</option>
                </select>
              </div>
              {baslangicOncesi && (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>Defter başlangıcına kadar ayrılmış amortisman (₺)</Label>
                  <Input
                    inputMode="decimal"
                    value={form.oncekiAmortisman}
                    onChange={(e) => setForm({ ...form, oncekiAmortisman: e.target.value })}
                    placeholder="Önceki muhasebe kayıtlarınızdaki birikmiş amortisman"
                  />
                  <p className="text-xs text-kobipo-gray">
                    Demirbaş muhasebe başlangıcından ({gunMetni(veri?.baslangic)}) önce alınmış: maliyeti ve bu tutar açılış fişine girer.
                  </p>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Elden çıkarma tarihi</Label>
                <Input type="date" value={form.cikisTarihi} onChange={(e) => setForm({ ...form, cikisTarihi: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Not</Label>
                <Input value={form.notlar} onChange={(e) => setForm({ ...form, notlar: e.target.value })} placeholder="İsteğe bağlı" />
              </div>
              <p className="text-xs text-kobipo-gray sm:col-span-2">
                Satılan ya da hurdaya çıkarılan demirbaşın o yıldan sonra amortismanı ayrılmaz. Satışın kendisi (satış faturası, kâr/zarar) muhasebecinizce
                fişlenir.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)} disabled={mesgul}>
              Vazgeç
            </Button>
            <Button onClick={kaydet} disabled={mesgul || !form?.ad || !form?.maliyet}>
              {mesgul && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function FragmentSatir({
  d,
  acik,
  onAc,
  onDuzenle,
  onSil,
}: {
  d: Demirbas
  acik: boolean
  onAc: () => void
  onDuzenle: () => void
  onSil: () => void
}) {
  return (
    <>
      <tr className="cursor-pointer border-t border-kobipo-border/60 hover:bg-kobipo-pale/50 dark:hover:bg-muted/30" onClick={onAc}>
        <td className="px-3 py-2.5">
          <span className="flex items-center gap-1.5 font-medium text-kobipo-navy dark:text-foreground">
            <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", acik && "rotate-180")} />
            {d.ad}
          </span>
          <span className="ml-5 text-xs text-kobipo-gray">
            {d.hesapKodu} · {d.omur} yıl · {d.yontem === "AZALAN" ? "azalan bakiyeler" : "normal"}
            {d.cikisTarihi && ` · elden çıktı ${gunMetni(d.cikisTarihi)}`}
          </span>
        </td>
        <td className="whitespace-nowrap px-3 py-2.5">{gunMetni(d.alisTarihi)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums">{tutarSifirli(d.maliyet)}</td>
        <td className="px-3 py-2.5 text-right tabular-nums">{tutarSifirli(d.birikmis)}</td>
        <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{tutarSifirli(d.netDeger)}</td>
        <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
          <WriteAction>
            <div className="flex justify-end gap-1">
              <Button size="icon" variant="ghost" onClick={onDuzenle} aria-label="Düzenle">
                <Pencil className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" onClick={onSil} aria-label="Sil">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </WriteAction>
        </td>
      </tr>
      {acik && (
        <tr className="bg-kobipo-offwhite/60 dark:bg-muted/20">
          <td colSpan={6} className="px-6 py-3">
            {d.tablo.length === 0 ? (
              <p className="text-sm text-kobipo-gray">Defter döneminde ayrılacak amortisman yok.</p>
            ) : (
              <table className="text-sm">
                <thead className="text-left text-xs font-semibold uppercase tracking-wide text-kobipo-gray">
                  <tr>
                    <th className="pr-6">Yıl</th>
                    <th className="pr-6 text-right">Amortisman</th>
                    <th className="text-right">Birikmiş</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {d.tablo.map((s) => (
                    <tr key={s.yil}>
                      <td className="pr-6">{s.yil}</td>
                      <td className="pr-6 text-right">{tutarSifirli(s.tutar)}</td>
                      <td className="text-right">{tutarSifirli(s.birikmis)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
