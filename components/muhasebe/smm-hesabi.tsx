"use client"

import { useCallback, useEffect, useState } from "react"
import { CheckCircle2, Loader2, RotateCcw } from "lucide-react"
import { CompanyLink } from "@/components/dashboard/company-link"
import { WriteAction } from "@/components/dashboard/write-guard"
import { Button } from "@/components/ui/button"
import { toast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { cn } from "@/lib/utils"
import { Kart, Uyari, hataBildir, muhasebeIstegi, tl, tutarSifirli } from "@/components/muhasebe/ortak"
import { EkranAciklamasi } from "@/components/muhasebe/ekran-aciklamasi"
import { ayAdi } from "@/lib/muhasebe/ozet"
import type { SmmAyi, SmmOnizleme } from "@/lib/muhasebe/stok-maliyeti.server"

/**
 * Satılan malın maliyeti sekmesi (Ay Sonu İşlemleri) — kural lib/muhasebe/stok-maliyeti.ts.
 * Her ay sonunda Kobipo'nun stok kayıtlarından stok değeri bulunur; defterdeki 153 ile
 * farkı o ayın maliyetidir (B 621 · A 153). Faturasız stok girişi maliyetten düşülmez,
 * ayrı satırla 397'ye yazılır (B 153 · A 397). KDV mahsubuyla aynı düzen: aylar sırayla,
 * fiş onaylı yazılır, yalnız en son ay geri alınır.
 */

type Yanit = { stokTakibi: boolean; aylar: SmmAyi[]; ay: string | null; onizleme: SmmOnizleme | null }

export function SmmHesabi({ companyId, onDegisti }: { companyId: string; onDegisti?: () => void }) {
  const { confirm } = useConfirm()
  const [veri, setVeri] = useState<Yanit | null>(null)
  const [ay, setAy] = useState<string | null>(null)
  const [secim, setSecim] = useState<{ maliyet: string; stok: string; fazla: string }>({ maliyet: "", stok: "", fazla: "" })
  const [hata, setHata] = useState<string | null>(null)
  const [mesgul, setMesgul] = useState(false)

  const yukle = useCallback(async () => {
    try {
      const q = new URLSearchParams({ companyId })
      if (ay) q.set("ay", ay)
      if (secim.maliyet) q.set("maliyet", secim.maliyet)
      if (secim.stok) q.set("stok", secim.stok)
      if (secim.fazla) q.set("fazla", secim.fazla)
      setVeri(await muhasebeIstegi<Yanit>(`/api/muhasebe/stok-maliyeti?${q}`))
      setHata(null)
    } catch (e) {
      setHata(e instanceof Error ? e.message : String(e))
    }
  }, [companyId, ay, secim])

  useEffect(() => {
    void yukle()
  }, [yukle])

  const o = veri?.onizleme
  const seciliAy = veri?.ay ?? null
  const sonYapilan = [...(veri?.aylar ?? [])].reverse().find((a) => a.mahsup)?.ay ?? null

  const yap = async () => {
    if (!o || !seciliAy) return
    const ok = await confirm({
      title: `${ayAdi(seciliAy)} satılan malın maliyeti yazılsın mı?`,
      description:
        `Maliyet: ${tl(o.plan.maliyet)}.` +
        (o.plan.faturasizGiris > 0 ? ` Faturasız stok girişi: ${tl(o.plan.faturasizGiris)} (397'ye).` : "") +
        " Fiş onaylı olarak deftere yazılır; gerekirse geri alınabilir.",
      confirmLabel: "Maliyeti yaz",
    })
    if (!ok) return
    setMesgul(true)
    try {
      await muhasebeIstegi("/api/muhasebe/stok-maliyeti", {
        method: "POST",
        body: JSON.stringify({ companyId, ay: seciliAy, islem: "yap", maliyet: o.secim.maliyet, stok: o.secim.stok, fazla: o.secim.fazla }),
      })
      toast({ title: `${ayAdi(seciliAy)} maliyeti yazıldı` })
      setAy(null)
      await yukle()
      onDegisti?.()
    } catch (e) {
      hataBildir(e, "Maliyet yazılamadı")
    } finally {
      setMesgul(false)
    }
  }

  const geriAl = async (hedef: string) => {
    const ok = await confirm({
      title: `${ayAdi(hedef)} maliyet fişi geri alınsın mı?`,
      description: "Fiş silinir; ay yeniden hesaplanmayı bekler.",
      confirmLabel: "Geri al",
    })
    if (!ok) return
    setMesgul(true)
    try {
      await muhasebeIstegi("/api/muhasebe/stok-maliyeti", { method: "POST", body: JSON.stringify({ companyId, ay: hedef, islem: "geri-al" }) })
      toast({ title: "Maliyet fişi geri alındı" })
      setAy(hedef)
      await yukle()
      onDegisti?.()
    } catch (e) {
      hataBildir(e, "Geri alınamadı")
    } finally {
      setMesgul(false)
    }
  }

  return (
    <div className="space-y-4">
      <EkranAciklamasi anahtar="smm" baslik="Satılan malın maliyeti nedir?">
        <p>
          Aldığınız mallar önce <strong>stok</strong> olarak kaydedilir (153 Ticari Mallar); gider değildir. Sattıkça stoktan çıkar ve maliyeti
          gider olur — gelir tablosundaki <strong>satışların maliyeti</strong> budur. Bu hesaplanmazsa brüt kâr satışların tamamı gibi görünür.
        </p>
        <p>
          Kobipo her ay sonunda stok kayıtlarınızdan elinizdeki malın değerini bulur (miktar × ortalama alış fiyatı). Defterdeki stok ile bu değer
          arasındaki fark o ay satılan (ya da fire, ikram olarak çıkan) malın maliyetidir. Yıl sonunda sayım yapılırsa yalnız sayım farkı kalır.
        </p>
        <p>
          Fatura olmadan stoğa giren mal (ürün kartından açılış stoğu, elle stok düzeltmesi) maliyetten düşülmez — düşülseydi kâr olduğundan
          yüksek görünürdü. Ayrı satırla <strong>397 Sayım ve Tesellüm Fazlaları</strong>&apos;na yazılır; muhasebeciniz yıl sonunda nereye
          aktarılacağına karar verir.
        </p>
      </EkranAciklamasi>
      {hata && <Uyari ton="kirmizi">{hata}</Uyari>}
      {!veri && !hata && (
        <p className="flex items-center gap-2 text-sm text-kobipo-gray">
          <Loader2 className="h-4 w-4 animate-spin" /> Hesaplanıyor…
        </p>
      )}
      {veri && !veri.stokTakibi && (
        <Uyari ton="mavi">
          Kobipo&apos;da stok hareketi yok, bu yüzden aylık maliyet hesaplanamıyor. Maliyet yıl sonunda sayım tutarıyla dönem kapanışında
          hesaplanır (Muhasebe Ayarları → Dönem kapanışı).
        </Uyari>
      )}
      {veri && veri.stokTakibi && veri.aylar.length === 0 && (
        <Kart>
          <p className="text-sm text-kobipo-gray">Henüz biten bir ay yok: maliyet ay bittikten sonra hesaplanır.</p>
        </Kart>
      )}

      {veri && veri.stokTakibi && veri.aylar.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-kobipo-border/90 bg-card shadow-card">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-kobipo-offwhite text-left text-xs font-semibold uppercase tracking-wide text-kobipo-gray dark:bg-muted/40">
              <tr>
                <th className="px-3 py-2.5">Ay</th>
                <th className="px-3 py-2.5 text-right">Satılan malın maliyeti</th>
                <th className="px-3 py-2.5">Durum</th>
              </tr>
            </thead>
            <tbody>
              {[...veri.aylar].reverse().map((a) => (
                <tr
                  key={a.ay}
                  onClick={() => a.durum !== "yapildi" && setAy(a.ay)}
                  className={cn(
                    "border-t border-kobipo-border/60",
                    a.durum !== "yapildi" && "cursor-pointer hover:bg-kobipo-pale/50 dark:hover:bg-muted/30",
                    a.ay === seciliAy && "bg-kobipo-pale/60 dark:bg-muted/40",
                  )}
                >
                  <td className="whitespace-nowrap px-3 py-2.5 font-medium text-kobipo-navy dark:text-foreground">{ayAdi(a.ay)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{a.mahsup ? tutarSifirli(a.mahsup.maliyet) : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2.5">
                    {a.mahsup ? (
                      a.mahsup.guncelDegil ? (
                        <span className="rounded-lg bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
                          Güncel değil — geri alıp yeniden yapın
                        </span>
                      ) : (
                        <span className="rounded-lg bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
                          Yazıldı
                        </span>
                      )
                    ) : (
                      <span className="rounded-lg bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-800 dark:bg-sky-950/50 dark:text-sky-200">
                        {a.taslak > 0 ? `Bekliyor · ${a.taslak} taslak alış` : "Bekliyor"}
                      </span>
                    )}
                    {a.mahsup && a.ay === sonYapilan && !a.kilitli && (
                      <WriteAction>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            void geriAl(a.ay)
                          }}
                          disabled={mesgul}
                          className="ml-2 inline-flex items-center gap-1 text-xs font-semibold text-kobipo-blue hover:underline"
                        >
                          <RotateCcw className="h-3 w-3" /> Geri al
                        </button>
                      </WriteAction>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {o && seciliAy && (
        <Kart className="space-y-4">
          <h2 className="font-bold text-kobipo-navy dark:text-foreground">{ayAdi(seciliAy)} satılan malın maliyeti</h2>
          {o.engeller.length > 0 && (
            <Uyari ton="sari">
              {o.engeller.map((e) => (
                <p key={e}>{e}</p>
              ))}
              {o.engeller.some((e) => e.includes("taslak")) && (
                <p className="mt-1">
                  <CompanyLink href="/muhasebe/fisler" className="font-semibold underline">
                    Fişlere git
                  </CompanyLink>
                </p>
              )}
            </Uyari>
          )}
          <dl className={cn("grid gap-3", o.plan.faturasizGiris > 0 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3")}>
            <Bilgi etiket="Defterdeki stok (153)" deger={tl(o.plan.stokHesabi)} />
            {o.plan.faturasizGiris > 0 && <Bilgi etiket="+ Faturasız stok girişi" deger={tl(o.plan.faturasizGiris)} />}
            <Bilgi etiket="− Ay sonu stok değeri" deger={tl(o.plan.stokDegeri)} />
            <Bilgi etiket="= Satılan malın maliyeti" deger={tl(o.plan.maliyet)} vurgu />
          </dl>
          <p className="text-xs text-kobipo-gray">
            Stok değeri {o.stok.urunSayisi} ürünün ay sonu miktarı × ağırlıklı ortalama alış maliyetinden hesaplandı.
          </p>
          {(o.stok.maliyetsiz.length > 0 || o.stok.eksiStok > 0 || o.stok.dovizli > 0) && (
            <Uyari ton="sari">
              {o.stok.maliyetsiz.length > 0 && (
                <p>
                  Alış fiyatı bilinmeyen {o.stok.maliyetsiz.length} ürün stok değerine 0 olarak girdi:{" "}
                  {o.stok.maliyetsiz
                    .slice(0, 5)
                    .map((u) => `${u.ad} (${u.miktar})`)
                    .join(", ")}
                  {o.stok.maliyetsiz.length > 5 ? "…" : ""}. Ürün kartına alış fiyatı girin.
                </p>
              )}
              {o.stok.eksiStok > 0 && <p>{o.stok.eksiStok} ürünün stoğu eksiye düşmüş; değere 0 olarak girdi. Stok girişlerini kontrol edin.</p>}
              {o.stok.dovizli > 0 && <p>{o.stok.dovizli} ürün TL dışı para birimiyle tanımlı; stok değerine girmedi.</p>}
            </Uyari>
          )}
          {o.faturasiz.deger > 0 && (
            <Uyari ton="mavi">
              <p>
                Bu ay fatura olmadan stoğa <strong>{tl(o.faturasiz.deger)}</strong> değerinde mal girdi ({o.faturasiz.urunSayisi} ürün; ürün
                kartından açılış stoğu ya da stok düzeltmesi). Satılan malın maliyetinden düşülmez, 397 Sayım ve Tesellüm Fazlaları&apos;na
                yazılır. Geç girilmiş açılış stoğu mu, sayım fazlası mı — muhasebeciniz yıl sonunda karar verir.
              </p>
              <p className="mt-1">
                En büyükleri:{" "}
                {o.faturasiz.urunler
                  .slice(0, 5)
                  .map((u) => `${u.ad} (${u.miktar.toLocaleString("tr-TR")} adet, ${tl(u.deger)})`)
                  .join(", ")}
                {o.faturasiz.urunSayisi > 5 ? "…" : ""}
              </p>
              {o.faturasiz.maliyetsiz > 0 && (
                <p className="mt-1">Alış fiyatı bilinmeyen {o.faturasiz.maliyetsiz} ürünün girişi 0 olarak sayıldı.</p>
              )}
            </Uyari>
          )}
          {o.plan.uyarilar.map((u) => (
            <Uyari key={u} ton="sari">
              {u}
            </Uyari>
          ))}
          {(o.secenekler.maliyet || o.secenekler.stok || o.secenekler.fazla) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {o.secenekler.maliyet && (
                <AltHesap
                  etiket="Maliyet hangi alt hesaba (621)?"
                  secenekler={o.secenekler.maliyet}
                  deger={o.secim.maliyet}
                  onSec={(kod) => setSecim((s) => ({ ...s, maliyet: kod }))}
                />
              )}
              {o.secenekler.stok && (
                <AltHesap
                  etiket="Stok hangi alt hesaptan düşülsün (153)?"
                  secenekler={o.secenekler.stok}
                  deger={o.secim.stok}
                  onSec={(kod) => setSecim((s) => ({ ...s, stok: kod }))}
                />
              )}
              {o.secenekler.fazla && (
                <AltHesap
                  etiket="Faturasız giriş hangi alt hesaba (397)?"
                  secenekler={o.secenekler.fazla}
                  deger={o.secim.fazla}
                  onSec={(kod) => setSecim((s) => ({ ...s, fazla: kod }))}
                />
              )}
            </div>
          )}
          {o.plan.hatalar.length > 0 && (
            <Uyari ton="sari">
              {o.plan.hatalar.map((e) => (
                <p key={e}>{e}</p>
              ))}
            </Uyari>
          )}
          <WriteAction>
            <Button onClick={yap} disabled={mesgul || o.engeller.length > 0 || o.plan.hatalar.length > 0}>
              {mesgul ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              Maliyeti yaz
            </Button>
          </WriteAction>
        </Kart>
      )}
    </div>
  )
}

function Bilgi({ etiket, deger, vurgu }: { etiket: string; deger: string; vurgu?: boolean }) {
  return (
    <div className={cn("rounded-xl px-3 py-2", vurgu ? "bg-kobipo-pale dark:bg-muted/60" : "bg-kobipo-offwhite dark:bg-muted/40")}>
      <dt className="text-xs font-semibold uppercase tracking-wide text-kobipo-gray">{etiket}</dt>
      <dd className="mt-0.5 text-base font-semibold tabular-nums text-kobipo-navy dark:text-foreground">{deger}</dd>
    </div>
  )
}

function AltHesap({
  etiket,
  secenekler,
  deger,
  onSec,
}: {
  etiket: string
  secenekler: Array<{ kod: string; ad: string }>
  deger: string | null
  onSec: (kod: string) => void
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="font-medium text-kobipo-navy dark:text-foreground">{etiket}</span>
      <select value={deger ?? ""} onChange={(e) => onSec(e.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
        <option value="">Seçin…</option>
        {secenekler.map((s) => (
          <option key={s.kod} value={s.kod}>
            {s.kod} {s.ad}
          </option>
        ))}
      </select>
    </label>
  )
}
