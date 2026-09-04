"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import useSWR from "swr"
import { Loader2, RefreshCw, Send, Sparkles, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { jsonFetcher } from "@/lib/swr/fetcher"
import { cn } from "@/lib/utils"
import { UyariKarti } from "./uyari-karti"
import { DENENEBILIR_MODELLER, VARSAYILAN_MODEL } from "@/lib/asistan/modeller"
import type { Sinyal, SohbetKullanim, SohbetMesaji } from "@/lib/asistan/tipler"

/**
 * İşletme asistanı paneli.
 *
 * İKİ YARIM, TEK EKRAN: üstte deterministik uyarılar (LLM'e uğramamış, rakamları
 * kesin), altta sohbet. Sıra bilinçli — panel açılır açılmaz kullanıcı bir işe
 * yarar bulgu görüyor ve asistan "ne sorsam" ekranı olmuyor. Sohbet, uyarıların
 * üstüne soru sorma yeri.
 *
 * Uyarılar SWR ile önbellekli: panel her açılışta yeniden hesaplatmak, büyük
 * firmada birkaç saniyelik bekleme ve boşuna sorgu demek. `dedupingInterval`
 * içinde ikinci açılış anında geliyor; "Yenile" düğmesi elle tazeliyor.
 */

type SinyalYaniti = {
  sinyaller: Sinyal[]
  kapaliAlanlar: string[]
  hatalar: Array<{ anahtar: string; mesaj: string }>
  karsilama: string
}

type SohbetYaniti = {
  cevap: string
  model: string
  saglayici: string
  araclar: Array<{ ad: string; girdi: Record<string, unknown>; sureMs: number }>
  kullanim: SohbetKullanim
}

/** Bir cevabın maliyet künyesi — mesaj sırasına göre saklanır. */
type Kunye = { model: string; saglayici: string; kullanim: SohbetKullanim }

const token = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1).replace(".", ",")}k` : String(n)

/**
 * Maliyet 4 ondalıkla ve USD olarak yazılır.
 *
 * TL'ye ÇEVİRMİYORUZ: sağlayıcı USD bildiriyor, çevirmek için bir kur seçmek
 * gerekir ve o kur (hangi gün, hangi kaynak) burada verilecek bir karar değil.
 * Yanlış kurla çevrilmiş bir maliyet, hiç gösterilmemesinden kötüdür.
 *
 * `null` = sağlayıcı maliyet bildirmedi; "$0" YAZILMAZ — bedava olduğu anlamına
 * gelirdi. Bu ayrım ölçümde önemli: maliyeti bilinmeyen modelle bedava model
 * karıştırılırsa karşılaştırma çöker.
 */
const usd = (n: number | null) => (n == null ? "maliyet bildirilmedi" : `$${n.toFixed(4)}`)

const ARAC_ETIKETI: Record<string, string> = {
  urun_ara: "ürün kartı",
  satis_siralamasi: "satış sıralaması",
  donem_ozeti: "dönem özeti",
  hareketsiz_stok: "hareketsiz stok",
  kritik_stok: "kritik stok",
  cari_ara: "cari kartı",
  vadesi_gecenler: "vadesi geçenler",
  nakit_durumu: "kasa/banka",
}

const ORNEK_SORULAR = [
  "Bu ay geçen aya göre nasıl gidiyoruz?",
  "En çok kazandıran ürünüm hangisi?",
  "Hangi müşterilerden alacağım gecikti?",
  "6 aydır satılmayan ürünleri listele",
]

export function AsistanPanel() {
  const { selectedCompanyId, selectedCompany } = useDashboardCompany()
  const [acik, setAcik] = useState(false)
  const [mesajlar, setMesajlar] = useState<SohbetMesaji[]>([])
  const [araclar, setAraclar] = useState<Record<number, SohbetYaniti["araclar"]>>({})
  // Her cevabın maliyet künyesi, mesaj sırasına göre.
  const [kunyeler, setKunyeler] = useState<Record<number, Kunye>>({})
  const [model, setModel] = useState<string>(VARSAYILAN_MODEL)
  const [girdi, setGirdi] = useState("")
  const [bekliyor, setBekliyor] = useState(false)
  const [hata, setHata] = useState<string | null>(null)
  const akisSonu = useRef<HTMLDivElement>(null)

  const acikMi = Boolean(selectedCompany?.isAsistanEnabled)

  const { data, error, isLoading, mutate } = useSWR<SinyalYaniti>(
    acik && acikMi && selectedCompanyId
      ? `/api/asistan/sinyaller?companyId=${encodeURIComponent(selectedCompanyId)}`
      : null,
    jsonFetcher,
    { dedupingInterval: 5 * 60_000, revalidateOnFocus: false }
  )

  // Firma değişince sohbet SIFIRLANIR: önceki firmanın rakamları üstüne konuşmak
  // panelin en tehlikeli hatası olurdu (bkz. CLAUDE.md "?company= taşınmalı").
  useEffect(() => {
    setMesajlar([])
    setAraclar({})
    setKunyeler({})
    setHata(null)
  }, [selectedCompanyId])

  useEffect(() => {
    if (acik) akisSonu.current?.scrollIntoView({ behavior: "smooth" })
  }, [mesajlar, acik, bekliyor])

  const gonder = useCallback(
    async (soru: string) => {
      const temiz = soru.trim()
      if (!temiz || bekliyor || !selectedCompanyId) return

      const yeniGecmis: SohbetMesaji[] = [...mesajlar, { rol: "kullanici", metin: temiz }]
      setMesajlar(yeniGecmis)
      setGirdi("")
      setBekliyor(true)
      setHata(null)

      try {
        const yanit = await fetch("/api/asistan/sohbet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId: selectedCompanyId,
            soru: temiz,
            model,
            // Sorunun kendisi geçmişe DAHİL DEĞİL — sunucu onu ayrı alıyor.
            gecmis: mesajlar,
          }),
        })
        const govde = await yanit.json().catch(() => null)
        if (!yanit.ok) {
          throw new Error(govde?.error || `Sunucu ${yanit.status} döndü`)
        }
        const sonuc = govde as SohbetYaniti
        setMesajlar((m) => {
          const sonraki: SohbetMesaji[] = [...m, { rol: "asistan", metin: sonuc.cevap }]
          const i = sonraki.length - 1
          setAraclar((a) => ({ ...a, [i]: sonuc.araclar ?? [] }))
          // Künye SUNUCUNUN bildirdiği model ile yazılır, seçicideki değerle
          // DEĞİL: geçersiz bir model adı gönderilirse sunucu varsayılana düşer
          // ve seçiciye bakarak yazmak, ölçümde yanlış modeli kaydettirirdi.
          if (sonuc.kullanim) {
            setKunyeler((k) => ({
              ...k,
              [i]: { model: sonuc.model, saglayici: sonuc.saglayici, kullanim: sonuc.kullanim },
            }))
          }
          return sonraki
        })
      } catch (e) {
        setHata(e instanceof Error ? e.message : "Asistana ulaşılamadı")
      } finally {
        setBekliyor(false)
      }
    },
    [bekliyor, mesajlar, model, selectedCompanyId]
  )

  /**
   * Oturum toplamı — açık sohbetin şimdiye kadarki maliyeti.
   *
   * Maliyeti BİLDİRİLMEYEN cevaplar toplamda 0 sayılmaz, ayrıca sayılır:
   * "$0,0210 (+2 cevabın maliyeti bilinmiyor)" demek, eksik veriyi sıfırmış
   * gibi gösterip toplamı olduğundan düşük yazmaktan iyi.
   */
  const toplam = Object.values(kunyeler).reduce(
    (t, k) => ({
      girdi: t.girdi + k.kullanim.girdiToken,
      cikti: t.cikti + k.kullanim.ciktiToken,
      usd: t.usd + (k.kullanim.maliyetUsd ?? 0),
      bilinmeyen: t.bilinmeyen + (k.kullanim.maliyetUsd == null ? 1 : 0),
    }),
    { girdi: 0, cikti: 0, usd: 0, bilinmeyen: 0 }
  )
  const cevapSayisi = Object.keys(kunyeler).length

  if (!acikMi) return null

  return (
    <>
      {!acik && (
        <button
          type="button"
          onClick={() => setAcik(true)}
          className="fixed bottom-5 right-5 z-40 flex h-12 items-center gap-2 rounded-full bg-primary px-4 text-primary-foreground shadow-lg transition hover:opacity-90"
          aria-label="İşletme asistanını aç"
        >
          <Sparkles className="h-5 w-5" />
          <span className="hidden text-sm font-medium sm:inline">Asistan</span>
        </button>
      )}

      {acik && (
        <>
          {/* Mobilde arka planı kapatan katman; masaüstünde panel yan durur. */}
          <div
            className="fixed inset-0 z-40 bg-black/30 sm:hidden"
            onClick={() => setAcik(false)}
            aria-hidden
          />
          <aside className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-background shadow-xl sm:w-[420px]">
            <header className="flex items-center gap-2 border-b px-4 py-3">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="flex-1 text-sm font-semibold">İşletme asistanı</span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => mutate()}
                disabled={isLoading}
                title="Uyarıları yenile"
              >
                <RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setAcik(false)} aria-label="Kapat">
                <X className="h-4 w-4" />
              </Button>
            </header>

            {/* ÖLÇÜM ÇUBUĞU — deneme fazının kontrol paneli.
                Model seçimi burada çünkü karar henüz verilmedi: aynı soruyu iki
                modele sorup cevapları ve maliyeti yan yana görmek, ölçümün
                kendisi. Kazanan seçilip varsayılan olunca bu çubuk sadeleşir
                (bkz. docs/asistan/OLCUM.md). */}
            <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2 text-[11px]">
              <label htmlFor="asistan-model" className="shrink-0 text-muted-foreground">
                Model
              </label>
              <select
                id="asistan-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={bekliyor}
                className="min-w-0 flex-1 truncate rounded border bg-background px-1.5 py-1 text-[11px] outline-none focus:ring-1 focus:ring-ring"
              >
                {DENENEBILIR_MODELLER.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.etiket}
                  </option>
                ))}
              </select>
              {cevapSayisi > 0 && (
                <span className="shrink-0 text-right tabular-nums text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {toplam.bilinmeyen === cevapSayisi ? "—" : `$${toplam.usd.toFixed(4)}`}
                  </span>
                  {" · "}
                  {token(toplam.girdi + toplam.cikti)} tk
                  {" · "}
                  {cevapSayisi} cevap
                </span>
              )}
            </div>

            {toplam.bilinmeyen > 0 && (
              <p className="border-b bg-amber-50 px-4 py-1 text-[10px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                {toplam.bilinmeyen} cevabın maliyetini sağlayıcı bildirmedi — toplam eksik.
              </p>
            )}

            <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
              {isLoading && (
                <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  İşletme verileri okunuyor…
                </div>
              )}

              {error != null && (
                <p className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
                  Uyarılar hesaplanamadı. Sohbeti yine de kullanabilirsin.
                </p>
              )}

              {data && (
                <>
                  <p className="text-xs text-muted-foreground">{data.karsilama}</p>
                  {data.sinyaller.map((s) => (
                    <UyariKarti key={s.anahtar} sinyal={s} />
                  ))}

                  {/* Hesaplanamayan sinyal SESSİZCE YUTULMAZ: "uyarı yok" ile
                      "uyarı hesaplanamadı" kullanıcı için çok farklı iki durum. */}
                  {data.hatalar.length > 0 && (
                    <p className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
                      {data.hatalar.length} uyarı hesaplanamadı ({data.hatalar
                        .map((h) => h.anahtar)
                        .join(", ")}). Bu başlıklarda bulgu olmadığı anlamına GELMEZ.
                    </p>
                  )}
                </>
              )}

              {mesajlar.length === 0 && data && (
                <div className="pt-1">
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    Örnek sorular
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {ORNEK_SORULAR.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => gonder(s)}
                        className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground transition hover:bg-muted"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {mesajlar.map((m, i) => (
                <div
                  key={i}
                  className={cn(
                    "rounded-lg px-3 py-2 text-sm",
                    m.rol === "kullanici"
                      ? "ml-6 bg-primary/10"
                      : "mr-2 border bg-muted/40"
                  )}
                >
                  <p className="whitespace-pre-wrap leading-relaxed">{m.metin}</p>
                  {/* Hangi veriye baktığı yazılıyor: rakamın kaynağını göremeyen
                      kullanıcı ya asistana körü körüne inanır ya hiç kullanmaz. */}
                  {araclar[i]?.length > 0 && (
                    <p className="mt-1.5 border-t pt-1.5 text-[11px] text-muted-foreground">
                      Baktığı yerler:{" "}
                      {araclar[i].map((a) => ARAC_ETIKETI[a.ad] ?? a.ad).join(", ")}
                    </p>
                  )}
                  {/* KÜNYE: bu tek cevabın modeli, süresi, tokeni ve maliyeti.
                      Oturum toplamı yukarıda duruyor ama karar burada veriliyor —
                      "bu cevap bu parayı hak etti mi" sorusu cevap başınadır. */}
                  {kunyeler[i] && (
                    <p
                      className={cn(
                        "text-[10px] tabular-nums text-muted-foreground",
                        araclar[i]?.length > 0 ? "mt-1" : "mt-1.5 border-t pt-1.5"
                      )}
                      title={`Sağlayıcı: ${kunyeler[i].saglayici} · ${kunyeler[i].kullanim.aracTuru} araç çağrısı`}
                    >
                      {kunyeler[i].model}
                      {" · "}
                      {(kunyeler[i].kullanim.sureMs / 1000).toFixed(1).replace(".", ",")} sn
                      {" · "}
                      {token(kunyeler[i].kullanim.girdiToken)}→
                      {token(kunyeler[i].kullanim.ciktiToken)} tk
                      {" · "}
                      {usd(kunyeler[i].kullanim.maliyetUsd)}
                    </p>
                  )}
                </div>
              ))}

              {bekliyor && (
                <div className="mr-2 flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Verilere bakıyor…
                </div>
              )}

              {hata && (
                <p className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300">
                  {hata}
                </p>
              )}

              <div ref={akisSonu} />
            </div>

            <form
              className="flex items-end gap-2 border-t p-3"
              onSubmit={(e) => {
                e.preventDefault()
                gonder(girdi)
              }}
            >
              <textarea
                value={girdi}
                onChange={(e) => setGirdi(e.target.value)}
                onKeyDown={(e) => {
                  // Enter gönderir, Shift+Enter satır atlar — sohbet kutusunun
                  // beklenen davranışı.
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    gonder(girdi)
                  }
                }}
                rows={1}
                maxLength={2000}
                placeholder="İşletmenle ilgili bir şey sor…"
                className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
              <Button type="submit" size="sm" disabled={bekliyor || !girdi.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </form>

            <p className="border-t px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              Rakamlar kendi verinden hesaplanır; yorum yapay zekâya aittir. Karar
              vermeden önce ilgili ekrandan doğrula.
            </p>
          </aside>
        </>
      )}
    </>
  )
}
