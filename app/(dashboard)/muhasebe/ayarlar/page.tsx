"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { BookCheck, CalendarDays, CheckCircle2, ListTree, Loader2, RefreshCw } from "lucide-react"
import { CompanyLink } from "@/components/dashboard/company-link"
import { WriteAction, ReadOnlyBanner } from "@/components/dashboard/write-guard"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { toast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import {
  Kart,
  SayfaBasligi,
  Uyari,
  gunMetni,
  hataBildir,
  muhasebeIstegi,
  useMuhasebeDurumu,
} from "@/components/muhasebe/ortak"
import { MutabakatIlerlemesi, ozetMetni, useMutabakat } from "@/components/muhasebe/mutabakat"
import { DonemKapanisi } from "@/components/muhasebe/donem-kapanisi"

/**
 * Muhasebe Ayarları — kurulum (başlangıç tarihi → Tekdüzen planı → açılış fişi →
 * geçmiş belgelerin taslak fişleri), durum ve dönem kapanışı.
 * Kurallar: lib/muhasebe/kurulum.server.ts, plan docs/muhasebe/MOTOR-PLAN.md §2.2.
 */
export default function MuhasebeAyarlariPage() {
  const companyId = useSearchParams().get("company")
  const { durum, hata, yenile } = useMuhasebeDurumu(companyId)
  const mutabakat = useMutabakat(companyId)
  const { confirm } = useConfirm()
  const [tarih, setTarih] = useState(() => `${new Date().getFullYear()}-01-01`)
  const [kuruluyor, setKuruluyor] = useState(false)

  if (!companyId) return <p className="p-6 text-sm text-kobipo-gray">Firma seçiniz.</p>

  const kur = async (yeniTarih: string, degisiklik: boolean) => {
    if (degisiklik) {
      const ok = await confirm({
        title: "Başlangıç tarihi değişsin mi?",
        description:
          "Yeni tarihten önceki taslak fişler kaldırılır, açılış fişi yeni tarihteki bakiyelerle yeniden kurulur. Onaylı fiş varken tarih değiştirilemez.",
        confirmLabel: "Değiştir",
      })
      if (!ok) return
    }
    setKuruluyor(true)
    try {
      await muhasebeIstegi("/api/muhasebe/ayarlar", {
        method: "PUT",
        body: JSON.stringify({ companyId, startDate: yeniTarih }),
      })
      await yenile()
      const ozet = await mutabakat.calistir({ acilis: true })
      await yenile()
      toast({ title: degisiklik ? "Başlangıç tarihi değişti" : "Muhasebe kuruldu", description: ozet ? ozetMetni(ozet) : undefined })
    } catch (e) {
      hataBildir(e, "Kurulum yapılamadı")
    } finally {
      setKuruluyor(false)
    }
  }

  const yenidenTara = async () => {
    const ozet = await mutabakat.calistir({ acilis: true })
    await yenile()
    if (ozet) toast({ title: "Belgeler tarandı", description: ozetMetni(ozet) })
  }

  const mesgul = kuruluyor || mutabakat.calisiyor

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <SayfaBasligi
        baslik="Muhasebe Ayarları"
        aciklama="Belgelerinizden kendiliğinden yevmiye fişi üretilir; siz eksik hesabı seçip onaylarsınız. Defter firmanın (tüzel kişinin) defteridir — şubelerin belgeleri ana firmanın defterine yazılır."
      />
      <ReadOnlyBanner />
      {hata && <Uyari ton="kirmizi">{hata}</Uyari>}
      {mutabakat.hata && <Uyari ton="kirmizi">{mutabakat.hata}</Uyari>}
      <MutabakatIlerlemesi calisiyor={mutabakat.calisiyor} ilerleme={mutabakat.ilerleme} />

      {!durum ? (
        <Kart>
          <p className="flex items-center gap-2 text-sm text-kobipo-gray">
            <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
          </p>
        </Kart>
      ) : !durum.kurulu ? (
        <Kart className="space-y-4">
          <div className="flex items-center gap-2.5">
            <span className="rounded-xl bg-kobipo-pale p-2 text-kobipo-blue">
              <CalendarDays className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <h2 className="font-bold text-kobipo-navy dark:text-foreground">Kurulum</h2>
              <p className="text-sm text-kobipo-gray">Defter hangi tarihten itibaren tutulsun?</p>
            </div>
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-kobipo-navy dark:text-foreground">
            <li>Tekdüzen hesap planı firmaya yazılır; kasa, banka ve kart hesaplarınızın alt hesapları açılır.</li>
            <li>
              Seçtiğiniz tarihteki cari, kasa/banka, portföydeki çek/senet ve personel bakiyelerinden <strong>açılış fişi</strong>{" "}
              hazırlanır. Kobipo&apos;da tutulmayan kalemler (stok, demirbaş, sermaye) tek bir fark satırında durur;
              muhasebeciniz dağıtır.
            </li>
            <li>O tarihten bugüne her belgenin <strong>taslak fişi</strong> üretilir. Hiçbir fiş siz onaylamadan deftere işlenmez.</li>
          </ol>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="baslangic">Başlangıç tarihi</Label>
              <Input id="baslangic" type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} className="w-44" />
            </div>
            <WriteAction>
              <Button onClick={() => kur(tarih, false)} disabled={mesgul || !tarih}>
                {mesgul ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <BookCheck className="mr-2 h-4 w-4" />}
                Muhasebeyi kur
              </Button>
            </WriteAction>
          </div>
          <p className="text-xs text-kobipo-gray">
            Genelde mali yılın başı (1 Ocak) seçilir. Onaylı fiş olmadığı sürece tarih sonradan değiştirilebilir.
          </p>
        </Kart>
      ) : (
        <>
          <Kart className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="rounded-xl bg-emerald-50 p-2 text-kobipo-green-dark dark:bg-emerald-950/40 dark:text-emerald-400">
                  <CheckCircle2 className="h-5 w-5" aria-hidden />
                </span>
                <div>
                  <h2 className="font-bold text-kobipo-navy dark:text-foreground">Defter kurulu</h2>
                  <p className="text-sm text-kobipo-gray">
                    {durum.defter.ad}
                    {durum.defter.sirketSayisi > 1 && ` · ${durum.defter.sirketSayisi - 1} şubenin belgeleri dahil`}
                  </p>
                </div>
              </div>
              <WriteAction>
                <Button variant="outline" onClick={yenidenTara} disabled={mesgul}>
                  <RefreshCw className={`mr-2 h-4 w-4 ${mutabakat.calisiyor ? "animate-spin" : ""}`} />
                  Belgeleri yeniden tara
                </Button>
              </WriteAction>
            </div>
            <dl className="grid gap-3 sm:grid-cols-4">
              <Bilgi etiket="Başlangıç" deger={gunMetni(durum.ayar?.baslangic)} />
              <Bilgi etiket="Hesap planı" deger={`${durum.hesapSayisi} hesap`} />
              <Bilgi etiket="Taslak fiş" deger={String(durum.fisler.taslak)} />
              <Bilgi etiket="Onaylı fiş" deger={String(durum.fisler.onayli)} />
            </dl>
            {durum.ayar?.kilitliSonGun && (
              <Uyari ton="mavi">
                {gunMetni(durum.ayar.kilitliSonGun)} ve öncesi kapanmış (kilitli) dönemdir: bu tarihlerdeki fişler değiştirilemez,
                o tarihlere yeni fiş açılmaz.
              </Uyari>
            )}
            {mutabakat.ozet && (mutabakat.ozet.kurYok.length > 0 || mutabakat.ozet.kilitli.length > 0) && (
              <Uyari>
                {mutabakat.ozet.kurYok.length > 0 && (
                  <p>{mutabakat.ozet.kurYok.length} dövizli belgenin kuru girilmemiş — TL karşılığı bilinmeden fişi kurulamadı. Belgeye kur girin.</p>
                )}
                {mutabakat.ozet.kilitli.length > 0 && (
                  <p>{mutabakat.ozet.kilitli.length} kayıt kapanmış döneme düşüyor; fişi açılmadı.</p>
                )}
              </Uyari>
            )}
            <div className="flex flex-wrap gap-2 text-sm">
              <CompanyLink href="/muhasebe/fisler" className="rounded-xl bg-kobipo-blue px-3 py-2 font-semibold text-white hover:bg-kobipo-blue/90">
                Fişlere git
              </CompanyLink>
              <CompanyLink href="/muhasebe/hesap-plani" className="inline-flex items-center gap-1.5 rounded-xl border border-kobipo-border px-3 py-2 font-semibold text-kobipo-navy hover:bg-kobipo-pale dark:text-foreground dark:hover:bg-muted">
                <ListTree className="h-4 w-4" /> Hesap planı
              </CompanyLink>
            </div>
          </Kart>

          <Kart className="space-y-3">
            <h2 className="font-bold text-kobipo-navy dark:text-foreground">Açılış fişi</h2>
            {durum.acilis ? (
              <>
                <p className="text-sm text-kobipo-gray">
                  {gunMetni(durum.ayar?.baslangic)} tarihindeki bakiyeler. Fark satırı (sermaye, stok, demirbaş…) dağıtılıp fiş
                  onaylanmadan açılış bakiyeleri mizana girmez.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className={`rounded-lg px-2 py-1 text-xs font-semibold ${
                      durum.acilis.durum === "POSTED"
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200"
                        : "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
                    }`}
                  >
                    {durum.acilis.durum === "POSTED" ? "Onaylı" : "Taslak"}
                  </span>
                  {durum.acilis.degisti && (
                    <span className="rounded-lg bg-red-100 px-2 py-1 text-xs font-semibold text-red-800 dark:bg-red-950/50 dark:text-red-200">
                      Başlangıçtan önceki bir kayıt sonradan değişti
                    </span>
                  )}
                  <CompanyLink href={`/muhasebe/fisler/${durum.acilis.id}`} className="text-sm font-semibold text-kobipo-blue hover:underline">
                    {durum.acilis.no} — aç
                  </CompanyLink>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-kobipo-gray">
                  {gunMetni(durum.ayar?.baslangic)} tarihinde Kobipo&apos;da bakiye yok, bu yüzden açılış fişi açılmadı.
                  Kobipo&apos;da tutulmayan açılış kalemleriniz (sermaye, demirbaş, stok, kredi…) varsa açılış fişini elle girin.
                </p>
                <WriteAction>
                  <CompanyLink href="/muhasebe/fisler/acilis" className="text-sm font-semibold text-kobipo-blue hover:underline">
                    Açılış fişini elle gir
                  </CompanyLink>
                </WriteAction>
              </>
            )}
          </Kart>

          <Kart className="space-y-3">
            <h2 className="font-bold text-kobipo-navy dark:text-foreground">Başlangıç tarihi</h2>
            <p className="text-sm text-kobipo-gray">
              Onaylı fiş varken değiştirilemez. Değişince yeni tarihten önceki taslaklar kaldırılır ve açılış fişi yeniden kurulur.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <Input
                type="date"
                defaultValue={durum.ayar?.baslangic}
                onChange={(e) => setTarih(e.target.value)}
                className="w-44"
                aria-label="Yeni başlangıç tarihi"
              />
              <WriteAction>
                <Button
                  variant="outline"
                  onClick={() => kur(tarih, true)}
                  disabled={mesgul || durum.fisler.onayli > 0 || !tarih || tarih === durum.ayar?.baslangic}
                >
                  Tarihi değiştir
                </Button>
              </WriteAction>
            </div>
          </Kart>

          <DonemKapanisi companyId={companyId} durum={durum} onDegisti={yenile} />
        </>
      )}
    </div>
  )
}

function Bilgi({ etiket, deger }: { etiket: string; deger: string }) {
  return (
    <div className="rounded-xl bg-kobipo-offwhite px-3 py-2 dark:bg-muted/40">
      <dt className="text-xs font-semibold uppercase tracking-wide text-kobipo-gray">{etiket}</dt>
      <dd className="mt-0.5 text-base font-semibold text-kobipo-navy dark:text-foreground">{deger}</dd>
    </div>
  )
}
