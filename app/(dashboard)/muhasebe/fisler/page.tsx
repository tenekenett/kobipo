"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { CheckCheck, ChevronLeft, ChevronRight, FilePlus2, Link2, Loader2, RefreshCw, Search } from "lucide-react"
import { CompanyLink } from "@/components/dashboard/company-link"
import { ReadOnlyBanner, WriteAction, useWriteGuard } from "@/components/dashboard/write-guard"
import { withCompanyHref } from "@/lib/company/href"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { cn } from "@/lib/utils"
import {
  FIS_TURU,
  KAYNAK_TURU,
  KurulumGerekli,
  SayfaBasligi,
  Uyari,
  gunMetni,
  hataBildir,
  muhasebeIstegi,
  tutarSifirli,
  useMuhasebeDurumu,
} from "@/components/muhasebe/ortak"
import { MutabakatIlerlemesi, ozetMetni, useMutabakat } from "@/components/muhasebe/mutabakat"
import { EkranAciklamasi } from "@/components/muhasebe/ekran-aciklamasi"

/**
 * Muhasebe Fişleri — belgelerden doğan taslak fişlerin onay ekranı (plan §2.6).
 *
 *   Emin          hesapların hepsi belli ve tahmin yok → toplu onay
 *   Gözden geçir  hesapsız ya da tahminli satır var → fişi açıp hesabı seçin
 *   Belge değişti onaylı fişin belgesi sonradan değişti → yeniden üretin
 *   Onaylı        deftere işlenmiş
 *
 * Ekran açılırken (yazma yetkisi varsa) mutabakat çalışır: yazarken bildirilmemiş
 * bir belge değişikliği de burada yakalanır.
 */

type Sekme = "emin" | "gozden" | "degisti" | "onayli" | "tum"
const SEKMELER: Array<{ k: Sekme; ad: string }> = [
  { k: "emin", ad: "Emin" },
  { k: "gozden", ad: "Gözden geçir" },
  { k: "degisti", ad: "Belge değişti" },
  { k: "onayli", ad: "Onaylı" },
  { k: "tum", ad: "Tümü" },
]

type Satir = {
  id: string
  voucherNo: string
  tarih: string
  aciklama: string | null
  tur: string
  durum: string
  emin: boolean
  kaynakTipi: string
  kaynakId: string | null
  sube: string | null
  degisti: boolean
  tutar: number
  hesapsiz: number
  tahmin: number
}

type Liste = {
  fisler: Satir[]
  toplam: number
  sayilar: { emin: number; gozden: number; degisti: number; onayli: number }
  sayfa: number
  sayfaBoyu: number
}

export default function MuhasebeFislerPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const companyId = searchParams.get("company")
  const sekme = (SEKMELER.find((s) => s.k === searchParams.get("sekme"))?.k ?? "emin") as Sekme
  const sayfa = Math.max(1, Number(searchParams.get("sayfa")) || 1)
  const bas = searchParams.get("bas") ?? ""
  const bit = searchParams.get("bit") ?? ""
  const tip = searchParams.get("tip") ?? ""
  const q = searchParams.get("q") ?? ""

  const { durum, hata: durumHata } = useMuhasebeDurumu(companyId)
  const mutabakat = useMutabakat(companyId)
  const { canWrite } = useWriteGuard()
  const { confirm } = useConfirm()
  const [liste, setListe] = useState<Liste | null>(null)
  const [yukleniyor, setYukleniyor] = useState(false)
  const [hata, setHata] = useState<string | null>(null)
  const [secili, setSecili] = useState<Set<string>>(new Set())
  const [onaylaniyor, setOnaylaniyor] = useState(false)
  const [arama, setArama] = useState(q)
  const ilkTarama = useRef(false)

  const parametre = (degis: Record<string, string | null>) => {
    const sp = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(degis)) {
      if (v) sp.set(k, v)
      else sp.delete(k)
    }
    router.replace(`${pathname}?${sp}`, { scroll: false })
  }

  const yukle = useCallback(async () => {
    if (!companyId) return
    setYukleniyor(true)
    try {
      const sp = new URLSearchParams({ companyId, sekme, sayfa: String(sayfa) })
      if (bas) sp.set("bas", bas)
      if (bit) sp.set("bit", bit)
      if (tip) sp.set("tip", tip)
      if (q) sp.set("q", q)
      setListe(await muhasebeIstegi<Liste>(`/api/muhasebe/fisler?${sp}`))
      setHata(null)
    } catch (e) {
      setHata(e instanceof Error ? e.message : String(e))
    } finally {
      setYukleniyor(false)
    }
  }, [companyId, sekme, sayfa, bas, bit, tip, q])

  // İlk açılışta mutabakat (yalnız yazabilene: senkron fiş yazar), sonra liste.
  useEffect(() => {
    if (!durum?.kurulu || ilkTarama.current) return
    ilkTarama.current = true
    if (!canWrite) return
    void mutabakat.calistir({ acilis: true }).then((o) => {
      if (o && (o.acilan || o.yenilenen || o.silinen || o.isaretlenen)) {
        toast({ title: "Belgeler eşleştirildi", description: ozetMetni(o) })
        void yukle()
      }
    })
  }, [durum?.kurulu, canWrite, mutabakat, yukle])

  useEffect(() => {
    if (durum?.kurulu) void yukle()
  }, [durum?.kurulu, yukle])

  useEffect(() => setSecili(new Set()), [sekme, sayfa, bas, bit, tip, q])

  const eminSatirlar = useMemo(() => (liste?.fisler ?? []).filter((f) => f.durum === "DRAFT" && f.emin), [liste])

  const topluOnayla = async (ids: string[] | null) => {
    const adet = ids ? ids.length : liste?.sayilar.emin ?? 0
    const ok = await confirm({
      title: `${adet} fiş onaylansın mı?`,
      description: "Onaylanan fiş deftere (yevmiye, kebir, mizan) işlenir. Gerekirse sonradan geri alınabilir.",
      confirmLabel: "Onayla",
    })
    if (!ok) return
    setOnaylaniyor(true)
    try {
      let toplam = 0
      let atlanan = 0
      for (let tur = 0; tur < 50; tur++) {
        const r = await muhasebeIstegi<{ onaylanan: number; atlanan: unknown[]; kalan: number }>(
          "/api/muhasebe/fisler/toplu-onay",
          { method: "POST", body: JSON.stringify({ companyId, ...(ids ? { ids } : {}) }) },
        )
        toplam += r.onaylanan
        atlanan += r.atlanan.length
        if (ids || r.kalan === 0 || r.onaylanan === 0) break
      }
      toast({
        title: `${toplam} fiş onaylandı`,
        description: atlanan ? `${atlanan} fiş atlandı (onaya engel bir sorun var).` : undefined,
      })
      setSecili(new Set())
      await yukle()
    } catch (e) {
      hataBildir(e, "Toplu onay yapılamadı")
    } finally {
      setOnaylaniyor(false)
    }
  }

  if (!companyId) return <p className="p-6 text-sm text-kobipo-gray">Firma seçiniz.</p>
  if (durum && !durum.kurulu) {
    return (
      <div className="mx-auto max-w-4xl space-y-5">
        <SayfaBasligi baslik="Muhasebe Fişleri" />
        <KurulumGerekli durum={durum} />
      </div>
    )
  }

  const sayfaSayisi = liste ? Math.max(1, Math.ceil(liste.toplam / liste.sayfaBoyu)) : 1

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <SayfaBasligi
        baslik="Muhasebe Fişleri"
        aciklama="Belgelerinizden üretilen taslak yevmiye fişleri. Hesabı belli olanları toplu onaylayın; hesap seçimi gerekenleri tek tek açın — seçtiğiniz hesap sonraki benzer belgelerde öğrenilir."
        sag={
          <>
            {(liste?.sayilar.gozden ?? 0) > 0 && (
              <Button variant="outline" asChild>
                <CompanyLink href="/muhasebe/fisler/eslesme">
                  <Link2 className="mr-2 h-4 w-4" />
                  Toplu eşle
                </CompanyLink>
              </Button>
            )}
            <WriteAction>
              <Button variant="outline" onClick={() => mutabakat.calistir({ acilis: true }).then(() => yukle())} disabled={mutabakat.calisiyor}>
                <RefreshCw className={cn("mr-2 h-4 w-4", mutabakat.calisiyor && "animate-spin")} />
                Belgeleri tara
              </Button>
            </WriteAction>
            <WriteAction>
              <Button asChild>
                <CompanyLink href="/muhasebe/fisler/yeni">
                  <FilePlus2 className="mr-2 h-4 w-4" />
                  Elle fiş
                </CompanyLink>
              </Button>
            </WriteAction>
          </>
        }
      />
      <EkranAciklamasi anahtar="fisler">
        <p>
          Her fatura, tahsilat, ödeme, bordro ya da çek için Kobipo bir <strong>muhasebe fişi</strong> hazırlar: hangi hesabın borçlandığı,
          hangisinin alacaklandığı. Fişler siz onaylayana kadar <strong>taslaktır</strong> ve deftere (mizan, bilanço) girmez.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Emin</strong>: bütün hesaplar belli — toplu onaylayabilirsiniz.
          </li>
          <li>
            <strong>Gözden geçir</strong>: bir satırın hesabı seçilmeli ya da Kobipo&apos;nun tahmini kontrol edilmeli (ör. bir alış gider mi, mal
            mı). &quot;Toplu eşle&quot; aynı türden fişleri birlikte çözer.
          </li>
          <li>
            <strong>Belge değişti</strong>: onayladıktan sonra belge düzenlendi; fişi yeniden üretip tekrar onaylayın.
          </li>
        </ul>
      </EkranAciklamasi>
      <ReadOnlyBanner />
      {(durumHata || hata || mutabakat.hata) && <Uyari ton="kirmizi">{durumHata || hata || mutabakat.hata}</Uyari>}
      <MutabakatIlerlemesi calisiyor={mutabakat.calisiyor} ilerleme={mutabakat.ilerleme} />
      {mutabakat.ozet && mutabakat.ozet.kurYok.length > 0 && (
        <Uyari>
          {mutabakat.ozet.kurYok.length} dövizli belgenin kuru girilmemiş; TL karşılığı bilinmeden fişi kurulamadı.
        </Uyari>
      )}

      {/* Sekmeler */}
      <div className="flex flex-wrap gap-1.5 overflow-x-auto rounded-2xl border border-kobipo-border/90 bg-card p-1.5 shadow-card">
        {SEKMELER.map((s) => {
          const sayi = s.k === "tum" ? null : liste?.sayilar[s.k]
          const aktif = s.k === sekme
          return (
            <button
              key={s.k}
              type="button"
              onClick={() => parametre({ sekme: s.k === "emin" ? null : s.k, sayfa: null })}
              className={cn(
                "flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-colors",
                aktif
                  ? "bg-kobipo-blue text-white"
                  : "text-kobipo-navy hover:bg-kobipo-pale dark:text-foreground dark:hover:bg-muted",
              )}
            >
              {s.ad}
              {sayi != null && (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs",
                    aktif
                      ? "bg-white/20"
                      : s.k === "degisti" && sayi > 0
                        ? "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200"
                        : "bg-kobipo-offwhite text-kobipo-gray dark:bg-muted",
                  )}
                >
                  {sayi}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {sekme === "gozden" && (liste?.sayilar.gozden ?? 0) > 1 && (
        <Uyari ton="mavi">
          Aynı tedarikçinin, aynı gider kategorisinin ya da aynı türün fişlerini tek tek açmak yerine{" "}
          <CompanyLink href="/muhasebe/fisler/eslesme" className="font-semibold underline">
            toplu eşleyebilirsiniz
          </CompanyLink>
          : her gruba bir hesap seçilir, gruptaki bütün fişler birlikte eşlenir.
        </Uyari>
      )}

      {/* Süzgeçler */}
      <div className="flex flex-wrap items-end gap-2">
        <form
          className="relative min-w-[14rem] flex-1"
          onSubmit={(e) => {
            e.preventDefault()
            parametre({ q: arama.trim() || null, sayfa: null })
          }}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-kobipo-gray" />
          <Input
            value={arama}
            onChange={(e) => setArama(e.target.value)}
            onBlur={() => arama.trim() !== q && parametre({ q: arama.trim() || null, sayfa: null })}
            placeholder="Fiş no, belge no, cari…"
            className="pl-9"
          />
        </form>
        <Input type="date" value={bas} onChange={(e) => parametre({ bas: e.target.value || null, sayfa: null })} className="w-40" aria-label="Başlangıç" />
        <Input type="date" value={bit} onChange={(e) => parametre({ bit: e.target.value || null, sayfa: null })} className="w-40" aria-label="Bitiş" />
        <select
          value={tip}
          onChange={(e) => parametre({ tip: e.target.value || null, sayfa: null })}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          aria-label="Kaynak"
        >
          <option value="">Tüm kaynaklar</option>
          {Object.entries(KAYNAK_TURU).map(([k, ad]) => (
            <option key={k} value={k}>
              {ad}
            </option>
          ))}
        </select>
      </div>

      {sekme === "emin" && (liste?.sayilar.emin ?? 0) > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900 ring-1 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-100 dark:ring-emerald-900">
          <span>
            <strong>{liste?.sayilar.emin}</strong> fişin bütün hesapları belli ve tahmin içermiyor — toplu onaylanabilir.
          </span>
          <div className="flex gap-2">
            {secili.size > 0 && (
              <WriteAction>
                <Button size="sm" variant="outline" onClick={() => topluOnayla([...secili])} disabled={onaylaniyor}>
                  Seçilenleri onayla ({secili.size})
                </Button>
              </WriteAction>
            )}
            <WriteAction>
              <Button size="sm" onClick={() => topluOnayla(null)} disabled={onaylaniyor}>
                {onaylaniyor ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCheck className="mr-2 h-4 w-4" />}
                Tümünü onayla
              </Button>
            </WriteAction>
          </div>
        </div>
      )}
      {sekme === "degisti" && (liste?.sayilar.degisti ?? 0) > 0 && (
        <Uyari ton="kirmizi">
          Bu fişler onaylandıktan sonra belgeleri değişti (tutar, tarih, iptal…). Defterde eski hâlleri duruyor: fişi açıp{" "}
          <strong>Yeniden üret</strong> ile belgenin bugünkü hâline getirin ve tekrar onaylayın.
        </Uyari>
      )}

      <div className="overflow-x-auto rounded-2xl border border-kobipo-border/90 bg-card shadow-card">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-kobipo-offwhite text-left text-xs font-semibold uppercase tracking-wide text-kobipo-gray dark:bg-muted/40">
            <tr>
              {sekme === "emin" && (
                <th className="w-10 px-3 py-2.5">
                  <input
                    type="checkbox"
                    aria-label="Sayfadakilerin hepsini seç"
                    checked={eminSatirlar.length > 0 && eminSatirlar.every((f) => secili.has(f.id))}
                    onChange={(e) => setSecili(e.target.checked ? new Set(eminSatirlar.map((f) => f.id)) : new Set())}
                  />
                </th>
              )}
              <th className="px-3 py-2.5">Tarih</th>
              <th className="px-3 py-2.5">Fiş</th>
              <th className="px-3 py-2.5">Açıklama</th>
              <th className="px-3 py-2.5 text-right">Tutar (₺)</th>
              <th className="px-3 py-2.5">Durum</th>
            </tr>
          </thead>
          <tbody>
            {yukleniyor && !liste ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-kobipo-gray">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            ) : (liste?.fisler.length ?? 0) === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-kobipo-gray">
                  {sekme === "emin"
                    ? "Toplu onaya hazır fiş yok."
                    : sekme === "gozden"
                      ? "Gözden geçirilecek fiş yok."
                      : sekme === "degisti"
                        ? "Belgesi değişmiş onaylı fiş yok."
                        : "Fiş yok."}
                </td>
              </tr>
            ) : (
              liste!.fisler.map((f) => {
                const href = withCompanyHref(`/muhasebe/fisler/${f.id}?sekme=${sekme}`, companyId)
                return (
                  <tr
                    key={f.id}
                    className="cursor-pointer border-t border-kobipo-border/60 hover:bg-kobipo-pale/50 dark:hover:bg-muted/30"
                    onClick={() => router.push(href)}
                  >
                    {sekme === "emin" && (
                      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        {f.durum === "DRAFT" && f.emin && (
                          <input
                            type="checkbox"
                            aria-label={`${f.voucherNo} seç`}
                            checked={secili.has(f.id)}
                            onChange={(e) =>
                              setSecili((s) => {
                                const n = new Set(s)
                                if (e.target.checked) n.add(f.id)
                                else n.delete(f.id)
                                return n
                              })
                            }
                          />
                        )}
                      </td>
                    )}
                    <td className="whitespace-nowrap px-3 py-2.5 text-kobipo-navy dark:text-foreground">{gunMetni(f.tarih)}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <span className="font-mono text-xs text-kobipo-navy dark:text-foreground">{f.voucherNo}</span>
                      <span className="ml-2 text-xs text-kobipo-gray">{FIS_TURU[f.tur] ?? f.tur}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-kobipo-navy dark:text-foreground">{f.aciklama || "—"}</span>
                      <span className="ml-2 inline-flex flex-wrap gap-1 align-middle">
                        <span className="rounded bg-kobipo-offwhite px-1.5 py-0.5 text-[11px] text-kobipo-gray dark:bg-muted">
                          {KAYNAK_TURU[f.kaynakTipi] ?? f.kaynakTipi}
                        </span>
                        {f.sube && (
                          <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[11px] text-sky-800 dark:bg-sky-950/50 dark:text-sky-200">
                            Şube: {f.sube}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums text-kobipo-navy dark:text-foreground">
                      {tutarSifirli(f.tutar)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <DurumRozeti f={f} />
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {liste && sayfaSayisi > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm text-kobipo-gray">
          <span>
            {liste.toplam} fiş · sayfa {sayfa}/{sayfaSayisi}
          </span>
          <Button size="sm" variant="outline" disabled={sayfa <= 1} onClick={() => parametre({ sayfa: String(sayfa - 1) })}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" disabled={sayfa >= sayfaSayisi} onClick={() => parametre({ sayfa: String(sayfa + 1) })}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  )
}

function DurumRozeti({ f }: { f: Satir }) {
  if (f.durum === "POSTED") {
    return f.degisti ? (
      <span className="rounded-lg bg-red-100 px-2 py-1 text-xs font-semibold text-red-800 dark:bg-red-950/50 dark:text-red-200">
        Belge değişti
      </span>
    ) : (
      <span className="rounded-lg bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
        Onaylı
      </span>
    )
  }
  if (f.hesapsiz > 0) {
    return (
      <span className="rounded-lg bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">
        {f.hesapsiz} satırda hesap yok
      </span>
    )
  }
  if (f.tahmin > 0) {
    return (
      <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
        Tahmin — gözden geçirin
      </span>
    )
  }
  return (
    <span className="rounded-lg bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-800 dark:bg-sky-950/50 dark:text-sky-200">
      Onaya hazır
    </span>
  )
}
