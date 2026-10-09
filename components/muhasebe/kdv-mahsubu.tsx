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
import type { KdvAyi, KdvOnizleme } from "@/lib/muhasebe/kdv-mahsup.server"

/**
 * KDV mahsubu sekmesi (Ay Sonu İşlemleri) — her ayın sonunda hesaplanan KDV (391) ile indirilecek KDV'nin (191)
 * kapatılması (kural: lib/muhasebe/kdv-mahsup.ts). Aylar sırayla; mahsup fişi onaylı
 * yazılır, yalnız en son ay geri alınabilir. Ön izleme defterdeki KDV'yi Vergi
 * Raporları'nın (belgelerden) KDV'siyle yan yana gösterir: ayrışırsa ya onay bekleyen
 * fiş vardır ya da bir belge deftere farklı girmiştir.
 */

type Yanit = { aylar: KdvAyi[]; ay: string | null; onizleme: KdvOnizleme | null }

export function KdvMahsubu({ companyId, onDegisti }: { companyId: string; onDegisti?: () => void }) {
  const { confirm } = useConfirm()
  const [veri, setVeri] = useState<Yanit | null>(null)
  const [ay, setAy] = useState<string | null>(null)
  const [secim, setSecim] = useState<{ odenecek: string; devreden: string }>({ odenecek: "", devreden: "" })
  const [hata, setHata] = useState<string | null>(null)
  const [mesgul, setMesgul] = useState(false)

  const yukle = useCallback(async () => {
    if (!companyId) return
    try {
      const q = new URLSearchParams({ companyId })
      if (ay) q.set("ay", ay)
      if (secim.odenecek) q.set("odenecek", secim.odenecek)
      if (secim.devreden) q.set("devreden", secim.devreden)
      setVeri(await muhasebeIstegi<Yanit>(`/api/muhasebe/kdv?${q}`))
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

  const yap = async () => {
    if (!o || !seciliAy) return
    const ok = await confirm({
      title: `${ayAdi(seciliAy)} KDV mahsubu yapılsın mı?`,
      description:
        o.plan.odenecek > 0
          ? `Ödenecek KDV: ${tl(o.plan.odenecek)}. Fiş onaylı olarak deftere yazılır; gerekirse geri alınabilir.`
          : `Sonraki aya devreden KDV: ${tl(o.plan.devredenSonraki)}. Fiş onaylı olarak deftere yazılır; gerekirse geri alınabilir.`,
      confirmLabel: "Mahsup et",
    })
    if (!ok) return
    setMesgul(true)
    try {
      await muhasebeIstegi("/api/muhasebe/kdv", {
        method: "POST",
        body: JSON.stringify({ companyId, ay: seciliAy, islem: "yap", odenecek: o.secim.odenecek, devreden: o.secim.devreden }),
      })
      toast({ title: `${ayAdi(seciliAy)} KDV mahsubu yapıldı` })
      setAy(null)
      await yukle()
      onDegisti?.()
    } catch (e) {
      hataBildir(e, "Mahsup yapılamadı")
    } finally {
      setMesgul(false)
    }
  }

  const geriAl = async (hedef: string) => {
    const ok = await confirm({
      title: `${ayAdi(hedef)} mahsubu geri alınsın mı?`,
      description: "Mahsup fişi silinir; ay yeniden mahsup edilmeyi bekler.",
      confirmLabel: "Geri al",
    })
    if (!ok) return
    setMesgul(true)
    try {
      await muhasebeIstegi("/api/muhasebe/kdv", { method: "POST", body: JSON.stringify({ companyId, ay: hedef, islem: "geri-al" }) })
      toast({ title: "Mahsup geri alındı" })
      setAy(hedef)
      await yukle()
      onDegisti?.()
    } catch (e) {
      hataBildir(e, "Geri alınamadı")
    } finally {
      setMesgul(false)
    }
  }

  const sonYapilan = [...(veri?.aylar ?? [])].reverse().find((a) => a.mahsup)?.ay ?? null
  const farkVar = o && (Math.abs(o.plan.hesaplanan - o.vergiRaporu.hesaplanan) >= 0.01 || Math.abs(o.plan.indirilecek - o.vergiRaporu.indirilecek) >= 0.01)

  return (
    <div className="space-y-4">
      <EkranAciklamasi anahtar="kdv" baslik="KDV mahsubu nedir?">
        <p>
          Satış yaptığınızda müşteriden aldığınız KDV devlete aittir (<strong>hesaplanan KDV</strong>, 391). Alış yaptığınızda ödediğiniz KDV&apos;yi
          bundan düşebilirsiniz (<strong>indirilecek KDV</strong>, 191). Ay sonunda ikisi karşılaştırılır:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Hesaplanan fazlaysa fark <strong>ödenecek KDV</strong> olarak vergi borcuna (360) geçer; beyannameyle ödenir.</li>
          <li>İndirilecek fazlaysa fark <strong>devreden KDV</strong> (190) olur ve sonraki ayın hesaplanan KDV&apos;sinden düşülür.</li>
        </ul>
        <p>
          Aylar sırayla mahsup edilir; o ayın KDV&apos;li bütün fişleri önce onaylanmış olmalı. Rakamlar Vergi Raporları&apos;ndaki KDV beyanıyla
          aynı olmalıdır — fark varsa ekran söyler.
        </p>
      </EkranAciklamasi>
      {hata && <Uyari ton="kirmizi">{hata}</Uyari>}
      {!veri && !hata && (
        <p className="flex items-center gap-2 text-sm text-kobipo-gray">
          <Loader2 className="h-4 w-4 animate-spin" /> Hesaplanıyor…
        </p>
      )}

      {veri && veri.aylar.length === 0 && (
        <Kart>
          <p className="text-sm text-kobipo-gray">Henüz biten bir ay yok: mahsup ay bittikten sonra yapılır.</p>
        </Kart>
      )}

      {veri && veri.aylar.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-kobipo-border/90 bg-card shadow-card">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-kobipo-offwhite text-left text-xs font-semibold uppercase tracking-wide text-kobipo-gray dark:bg-muted/40">
              <tr>
                <th className="px-3 py-2.5">Ay</th>
                <th className="px-3 py-2.5 text-right">Hesaplanan</th>
                <th className="px-3 py-2.5 text-right">İndirilecek</th>
                <th className="px-3 py-2.5 text-right">Sonuç</th>
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
                  <td className="px-3 py-2.5 text-right tabular-nums">{tutarSifirli(a.hesaplanan)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{tutarSifirli(a.indirilecek)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">
                    {a.mahsup ? (a.mahsup.odenecek > 0 ? `Ödenecek ${tutarSifirli(a.mahsup.odenecek)}` : `Devreden ${tutarSifirli(a.mahsup.devreden)}`) : "—"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5">
                    <AyDurumu a={a} />
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
          <h2 className="font-bold text-kobipo-navy dark:text-foreground">{ayAdi(seciliAy)} mahsubu</h2>
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
          <dl className="grid gap-3 sm:grid-cols-4">
            <Bilgi etiket="Hesaplanan KDV" deger={tl(o.plan.hesaplanan)} />
            <Bilgi etiket="İndirilecek KDV" deger={tl(o.plan.indirilecek)} />
            <Bilgi etiket="Önceki aydan devreden" deger={tl(o.plan.devredenOnceki)} />
            <Bilgi
              etiket={o.plan.odenecek > 0 ? "Ödenecek KDV" : "Sonraki aya devreden"}
              deger={tl(o.plan.odenecek > 0 ? o.plan.odenecek : o.plan.devredenSonraki)}
              vurgu
            />
          </dl>
          {farkVar && (
            <Uyari ton="sari">
              Vergi Raporları bu ay için hesaplanan {tl(o.vergiRaporu.hesaplanan)}, indirilecek {tl(o.vergiRaporu.indirilecek)} KDV gösteriyor;
              defterdeki rakam farklı. Genellikle sebep onaylanmamış ya da hesabı başka yere yazılmış bir fiştir. Mahsuptan önce farkı kontrol
              edin.
            </Uyari>
          )}
          {o.vergiRaporu.kursuzBelge > 0 && (
            <Uyari ton="sari">{o.vergiRaporu.kursuzBelge} dövizli belgenin kuru girilmemiş; Vergi Raporları bunları toplama katmadı.</Uyari>
          )}
          {(o.secenekler.odenecek || o.secenekler.devreden) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {o.secenekler.odenecek && (
                <AltHesapSecimi
                  etiket="Ödenecek KDV hangi alt hesaba?"
                  secenekler={o.secenekler.odenecek}
                  deger={o.secim.odenecek}
                  onSec={(kod) => setSecim((s) => ({ ...s, odenecek: kod }))}
                />
              )}
              {o.secenekler.devreden && (
                <AltHesapSecimi
                  etiket="Devreden KDV hangi alt hesaba?"
                  secenekler={o.secenekler.devreden}
                  deger={o.secim.devreden}
                  onSec={(kod) => setSecim((s) => ({ ...s, devreden: kod }))}
                />
              )}
            </div>
          )}
          {o.plan.satirlar.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <thead className="text-left text-xs font-semibold uppercase tracking-wide text-kobipo-gray">
                  <tr>
                    <th className="py-1.5">Hesap</th>
                    <th className="py-1.5">Açıklama</th>
                    <th className="py-1.5 text-right">Borç</th>
                    <th className="py-1.5 text-right">Alacak</th>
                  </tr>
                </thead>
                <tbody>
                  {o.plan.satirlar.map((s, i) => (
                    <tr key={i} className="border-t border-kobipo-border/60 tabular-nums">
                      <td className="py-1.5 font-mono">{s.kod}</td>
                      <td className="py-1.5 text-kobipo-gray">{s.aciklama}</td>
                      <td className="py-1.5 text-right">{s.taraf === "B" ? tutarSifirli(s.tutar) : ""}</td>
                      <td className="py-1.5 text-right">{s.taraf === "A" ? tutarSifirli(s.tutar) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
              Mahsup et
            </Button>
          </WriteAction>
        </Kart>
      )}
    </div>
  )
}

function AyDurumu({ a }: { a: KdvAyi }) {
  if (a.mahsup) {
    return a.mahsup.guncelDegil ? (
      <span className="rounded-lg bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
        Güncel değil — geri alıp yeniden yapın
      </span>
    ) : (
      <span className="rounded-lg bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
        Yapıldı
      </span>
    )
  }
  if (a.durum === "gerekmez") return <span className="text-xs text-kobipo-gray">KDV hareketi yok</span>
  return (
    <span className="rounded-lg bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-800 dark:bg-sky-950/50 dark:text-sky-200">
      {a.taslak > 0 ? `Bekliyor · ${a.taslak} taslak fiş` : "Bekliyor"}
    </span>
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

function AltHesapSecimi({
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
      <select
        value={deger ?? ""}
        onChange={(e) => onSec(e.target.value)}
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
      >
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
