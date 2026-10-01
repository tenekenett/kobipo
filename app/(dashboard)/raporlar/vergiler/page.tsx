"use client"

import { useEffect, useState, type ReactNode } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Info,
  Landmark,
  Users,
} from "lucide-react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ExportButton } from "@/components/export/export-button"
import { CompanyLink } from "@/components/dashboard/company-link"
import { cn } from "@/lib/utils"
import {
  AY_ADLARI,
  BEYAN_GUNU,
  MUHTASAR_GUNU,
  beyanTarihi,
  istanbulParcalari,
  siradakiBeyan,
  type BeyanTarihi,
} from "@/lib/raporlar/beyan-takvimi"
import type {
  MuhtasarResult,
  VatChecklist,
  VatDeclarationResult,
  VatRateRow,
} from "@/lib/raporlar/vergiler"

/**
 * Vergi Raporları — ay sonu beyannamelerinden ÖNCE kontrol ekranı.
 *
 * Rakamlar `lib/raporlar/vergiler.ts`ten gelir (pano KDV kartı ve K-BLG-07 ile
 * aynı fonksiyon); bu sayfa onları "ne ödenecek, ne zamana kadar, önce ne
 * yapılmalı" diye okutur. 2026-10-01'de yeniden yazıldı: eskisi iki sayı
 * kutusu ve sekmelerden ibaretti, ne olduğu anlaşılmıyordu; Muhtasar sekmesi
 * hiçbir firmada kayıt bulamıyordu, Ba-Bs ise 2024'ten beri verilmeyen bir formdu.
 */

type KdvYaniti = VatDeclarationResult & { kontrol: VatChecklist | null }

const tl = (n: number) =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(n)

/** Dönemi kapsayan en küçük liste penceresi (hedef listeler yalnız bunları kabul eder). */
function kapsayanGun(yil: number, ay: number, secenekler: readonly number[]): number {
  const b = istanbulParcalari(new Date())
  const gun = Math.ceil((Date.UTC(b.yil, b.ay - 1, b.gun) - Date.UTC(yil, ay - 1, 1)) / 864e5) + 1
  return secenekler.find((s) => s >= gun) ?? secenekler[secenekler.length - 1]
}

function parseDonem(sp: URLSearchParams): { yil: number; ay: number } {
  const y = Number(sp.get("year"))
  const m = Number(sp.get("month"))
  if (Number.isInteger(y) && y >= 2000 && y <= 2100 && Number.isInteger(m) && m >= 1 && m <= 12) {
    return { yil: y, ay: m }
  }
  // Varsayılan: beyanı SIRADA olan dönem (ayın 28'ine kadar geçen ay) — pano
  // kartıyla aynı. İçinde bulunulan ay henüz bitmemiştir, beyana konu değildir.
  const s = siradakiBeyan()
  return { yil: s.yil, ay: s.ay }
}

export default function VergilerPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const companyId = searchParams.get("company")
  const { yil, ay } = parseDonem(searchParams)

  const [kdv, setKdv] = useState<KdvYaniti | null>(null)
  const [muhtasar, setMuhtasar] = useState<MuhtasarResult | null>(null)
  const [kdvHata, setKdvHata] = useState<string | null>(null)
  const [muhtasarHata, setMuhtasarHata] = useState<string | null>(null)
  const [yukleniyor, setYukleniyor] = useState(true)

  useEffect(() => {
    if (!companyId) return
    const ctrl = new AbortController()
    const params = new URLSearchParams({ companyId, year: String(yil), month: String(ay) })
    const oku = async <T,>(url: string, ad: string): Promise<{ veri: T | null; hata: string | null }> => {
      try {
        const res = await fetch(url, { signal: ctrl.signal })
        const data = await res.json().catch(() => null)
        if (!res.ok) return { veri: null, hata: data?.error || `${ad} alınamadı (${res.status})` }
        return { veri: data as T, hata: null }
      } catch (e) {
        if ((e as Error).name === "AbortError") throw e
        return { veri: null, hata: `${ad} alınamadı: bağlantı hatası` }
      }
    }
    setYukleniyor(true)
    Promise.all([
      oku<KdvYaniti>(`/api/raporlar/kdv-beyanname?${params}&period=monthly`, "KDV raporu"),
      oku<MuhtasarResult>(`/api/raporlar/muhtasar?${params}`, "Muhtasar raporu"),
    ])
      .then(([k, m]) => {
        setKdv(k.veri)
        setKdvHata(k.hata)
        setMuhtasar(m.veri)
        setMuhtasarHata(m.hata)
        setYukleniyor(false)
      })
      .catch(() => {
        /* dönem değişti, istek iptal edildi — yenisi zaten yolda */
      })
    return () => ctrl.abort()
  }, [companyId, yil, ay])

  const buAy = istanbulParcalari(new Date())
  const ileriYok = yil > buAy.yil || (yil === buAy.yil && ay >= buAy.ay)
  const donemSurer = yil === buAy.yil && ay === buAy.ay

  // Dönem URL'de durur (`?company=` korunur): yenileme ve panodaki KDV kartının
  // linki aynı dönemi açar.
  const donemeGit = (fark: number) => {
    const d = new Date(Date.UTC(yil, ay - 1 + fark, 1))
    const sp = new URLSearchParams(searchParams.toString())
    sp.set("year", String(d.getUTCFullYear()))
    sp.set("month", String(d.getUTCMonth() + 1))
    router.replace(`${pathname}?${sp}`, { scroll: false })
  }

  if (!companyId) {
    return <p className="p-6 text-sm text-kobipo-gray">Firma seçiniz.</p>
  }

  const donemAdi = `${AY_ADLARI[ay - 1]} ${yil}`

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-kobipo-navy dark:text-foreground">Vergi Raporları</h1>
          <p className="mt-1 max-w-2xl text-sm text-kobipo-gray">
            Ay sonu beyannamelerinden önce kontrol. KDV faturalarınızdan, muhtasar bordrolarınızdan hesaplanır;
            beyanname yerine geçmez. Excel dosyasını muhasebecinize gönderebilirsiniz.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center rounded-xl border border-kobipo-border bg-card shadow-sm">
            <button
              type="button"
              onClick={() => donemeGit(-1)}
              className="rounded-l-xl p-2.5 text-kobipo-gray hover:bg-kobipo-pale hover:text-kobipo-navy dark:hover:bg-muted"
              aria-label="Önceki ay"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[8.5rem] px-2 text-center text-sm font-semibold text-kobipo-navy dark:text-foreground">
              {donemAdi}
            </span>
            <button
              type="button"
              onClick={() => donemeGit(1)}
              disabled={ileriYok}
              className="rounded-r-xl p-2.5 text-kobipo-gray hover:bg-kobipo-pale hover:text-kobipo-navy disabled:pointer-events-none disabled:opacity-30 dark:hover:bg-muted"
              aria-label="Sonraki ay"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <ExportButton
            dataset="rapor-vergiler"
            companyId={companyId}
            size="default"
            params={{ year: String(yil), month: String(ay) }}
            disabled={!kdv}
          />
        </div>
      </header>

      <TakvimSeridi yil={yil} ay={ay} donemAdi={donemAdi} donemSurer={donemSurer} />

      <KdvBolumu
        yil={yil}
        ay={ay}
        kdv={kdv}
        hata={kdvHata}
        yukleniyor={yukleniyor}
        kdvSonGun={beyanTarihi(yil, ay, BEYAN_GUNU)}
      />

      <MuhtasarBolumu donemAdi={donemAdi} veri={muhtasar} hata={muhtasarHata} yukleniyor={yukleniyor} />
    </div>
  )
}

// ── Takvim ────────────────────────────────────────────────────────────────

function sonGunMetni(b: BeyanTarihi) {
  if (b.kalanGun < 0) return "süresi geçti"
  if (b.kalanGun === 0) return "bugün son gün"
  return `${b.kalanGun} gün kaldı`
}

function TakvimSeridi({
  yil,
  ay,
  donemAdi,
  donemSurer,
}: {
  yil: number
  ay: number
  donemAdi: string
  donemSurer: boolean
}) {
  const satirlar = [
    { ad: "Muhtasar ve prim hizmet", b: beyanTarihi(yil, ay, MUHTASAR_GUNU) },
    { ad: "KDV", b: beyanTarihi(yil, ay, BEYAN_GUNU) },
  ]
  return (
    <section className="rounded-2xl border border-kobipo-border/90 bg-card p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-2.5">
          <span className="rounded-xl bg-kobipo-pale p-2 text-kobipo-blue">
            <CalendarClock className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-bold text-kobipo-navy dark:text-foreground">{donemAdi} beyanları</p>
            <p className="text-xs text-kobipo-gray">
              {donemSurer ? "Dönem sürüyor — rakamlar ay sonuna kadar değişir." : "Son günler (aylık beyan)"}
            </p>
          </div>
        </div>
        <ul className="flex flex-1 flex-wrap gap-2">
          {satirlar.map(({ ad, b }) => {
            const yakin = b.kalanGun >= 0 && b.kalanGun <= 7
            const gecti = b.kalanGun < 0
            return (
              <li
                key={ad}
                className={cn(
                  "rounded-xl px-3 py-2 text-xs",
                  gecti
                    ? "bg-muted text-kobipo-gray"
                    : yakin
                      ? "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200"
                      : "bg-kobipo-offwhite text-kobipo-navy dark:bg-muted/40 dark:text-foreground",
                )}
              >
                <span className="font-semibold">{ad}</span> · {b.tarih} {b.haftaGunu} ·{" "}
                <span className="font-semibold">{sonGunMetni(b)}</span>
                {b.kaydirildi && <span className="block opacity-80">hafta sonuna denk geldiği için Pazartesi</span>}
              </li>
            )
          })}
        </ul>
      </div>
      <p className="mt-3 text-[11px] text-kobipo-gray">
        Bayram tatilleri ve GİB&apos;in süre uzatmaları hesaba katılmaz; üç aylık beyan veriyorsanız muhasebecinize
        danışın.
      </p>
    </section>
  )
}

// ── Ortak parçalar ────────────────────────────────────────────────────────

function Bolum({
  ikon,
  baslik,
  altBaslik,
  sag,
  children,
}: {
  ikon: ReactNode
  baslik: string
  altBaslik: string
  sag?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rounded-3xl border border-kobipo-border/90 bg-card p-5 shadow-card sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-kobipo-pale p-2.5 text-kobipo-blue">{ikon}</span>
          <div>
            <h2 className="text-lg font-bold text-kobipo-navy dark:text-foreground">{baslik}</h2>
            <p className="text-sm text-kobipo-gray">{altBaslik}</p>
          </div>
        </div>
        {sag}
      </div>
      <div className="mt-5 space-y-4">{children}</div>
    </section>
  )
}

function Kutucuk({
  etiket,
  tutar,
  alt,
  vurgu,
}: {
  etiket: string
  tutar: string
  alt?: ReactNode
  vurgu?: "odenecek" | "devreden"
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-2xl px-4 py-3.5",
        vurgu === "odenecek"
          ? "bg-orange-50 ring-1 ring-orange-200 dark:bg-orange-950/30 dark:ring-orange-900"
          : vurgu === "devreden"
            ? "bg-emerald-50 ring-1 ring-emerald-200 dark:bg-emerald-950/30 dark:ring-emerald-900"
            : "bg-kobipo-offwhite dark:bg-muted/40",
      )}
    >
      <p
        className={cn(
          "text-xs font-semibold uppercase tracking-wide",
          vurgu === "odenecek"
            ? "text-orange-700 dark:text-orange-400"
            : vurgu === "devreden"
              ? "text-kobipo-green-dark dark:text-emerald-400"
              : "text-kobipo-gray",
        )}
      >
        {etiket}
      </p>
      <p className="mt-1 truncate font-mono text-xl font-bold tracking-tight text-kobipo-navy sm:text-2xl dark:text-foreground">
        {tutar}
      </p>
      {alt && <div className="mt-1 text-xs text-kobipo-gray">{alt}</div>}
    </div>
  )
}

function Islem({ simge }: { simge: string }) {
  return (
    <div className="flex items-center justify-center" aria-hidden>
      <span className="flex h-7 w-7 items-center justify-center rounded-full border border-kobipo-border bg-card text-sm font-bold text-kobipo-gray">
        {simge}
      </span>
    </div>
  )
}

function Uyari({
  ton,
  children,
  link,
}: {
  ton: "uyari" | "bilgi" | "tamam"
  children: ReactNode
  link?: { href: string; etiket: string }
}) {
  const Ikon = ton === "uyari" ? AlertTriangle : ton === "tamam" ? CheckCircle2 : Info
  return (
    <li
      className={cn(
        "flex flex-wrap items-start gap-x-3 gap-y-1 rounded-xl px-3 py-2.5 text-sm",
        ton === "uyari" && "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
        ton === "bilgi" && "bg-kobipo-pale/60 text-kobipo-navy dark:bg-muted/50 dark:text-foreground",
        ton === "tamam" && "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200",
      )}
    >
      <Ikon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{children}</span>
      {link && (
        <CompanyLink
          href={link.href}
          className="inline-flex shrink-0 items-center gap-1 font-semibold text-kobipo-blue hover:underline"
        >
          {link.etiket}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </CompanyLink>
      )}
    </li>
  )
}

function Acilir({ baslik, children }: { baslik: string; children: ReactNode }) {
  const [acik, setAcik] = useState(false)
  return (
    <div className="rounded-2xl border border-kobipo-border/80">
      <button
        type="button"
        onClick={() => setAcik((v) => !v)}
        aria-expanded={acik}
        className="flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold text-kobipo-navy hover:bg-kobipo-offwhite dark:text-foreground dark:hover:bg-muted/40"
      >
        {baslik}
        <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", acik && "rotate-180")} aria-hidden />
      </button>
      {acik && <div className="border-t border-kobipo-border/80 px-4 py-4">{children}</div>}
    </div>
  )
}

function Iskelet() {
  return (
    <div className="grid animate-pulse gap-3 sm:grid-cols-3" aria-label="Yükleniyor">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-24 rounded-2xl bg-kobipo-offwhite dark:bg-muted/40" />
      ))}
    </div>
  )
}

function HataKutusu({ mesaj }: { mesaj: string }) {
  return (
    <p className="rounded-xl bg-red-50 px-3 py-2.5 text-sm font-medium text-red-800 dark:bg-red-950/40 dark:text-red-300">
      {mesaj}
    </p>
  )
}

// ── KDV ───────────────────────────────────────────────────────────────────

function KdvBolumu({
  yil,
  ay,
  kdv,
  hata,
  yukleniyor,
  kdvSonGun,
}: {
  yil: number
  ay: number
  kdv: KdvYaniti | null
  hata: string | null
  yukleniyor: boolean
  kdvSonGun: BeyanTarihi
}) {
  const sag = kdv ? (
    <p className="rounded-full bg-kobipo-offwhite px-3 py-1 text-xs font-medium text-kobipo-gray dark:bg-muted/40">
      {kdv.documentCounts.sales} satış · {kdv.documentCounts.purchases} alış belgesi
    </p>
  ) : null

  return (
    <Bolum
      ikon={<Landmark className="h-5 w-5" aria-hidden />}
      baslik="KDV"
      altBaslik="Satışlarınızdaki KDV'den alışlarınızdakini düşersiniz; kalan ödenir"
      sag={sag}
    >
      {hata && <HataKutusu mesaj={hata} />}
      {yukleniyor && !kdv ? (
        <Iskelet />
      ) : kdv ? (
        <KdvIcerik yil={yil} ay={ay} kdv={kdv} kdvSonGun={kdvSonGun} />
      ) : null}
    </Bolum>
  )
}

function KdvIcerik({
  yil,
  ay,
  kdv,
  kdvSonGun,
}: {
  yil: number
  ay: number
  kdv: KdvYaniti
  kdvSonGun: BeyanTarihi
}) {
  const odenecek = kdv.netVAT > 0
  const devreden = kdv.netVAT < 0
  const k = kdv.kontrol
  const bekleyenVar =
    !!k && (k.aktarilmamis.adet > 0 || k.aktarilmamis.dovizli > 0 || k.gonderilmemis.adet > 0)

  return (
    <>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-3">
        <Kutucuk
          etiket="Satışlarınızdan"
          tutar={tl(kdv.calculatedVAT)}
          alt={
            kdv.withholding.sales !== 0 ? (
              <>Hesaplanan KDV · alıcının ödeyeceği {tl(kdv.withholding.sales)} tevkifat düşüldü</>
            ) : (
              "Hesaplanan KDV"
            )
          }
        />
        <Islem simge="−" />
        <Kutucuk etiket="Alışlarınızdan" tutar={tl(kdv.deductibleVAT)} alt="İndirilecek KDV" />
        <Islem simge="=" />
        <Kutucuk
          etiket={devreden ? "Sonraki aya devreden" : "Ödenecek KDV"}
          tutar={tl(Math.abs(kdv.netVAT))}
          vurgu={odenecek ? "odenecek" : devreden ? "devreden" : undefined}
          alt={
            odenecek
              ? `${kdvSonGun.tarih} ${kdvSonGun.haftaGunu} gününe kadar ödenir`
              : devreden
                ? "Bu ay ödeme yok; fark gelecek ayın KDV'sinden düşülür"
                : "Bu ay KDV farkı yok"
          }
        />
      </div>

      {kdv.withholding.purchases !== 0 && (
        <ul>
          <Uyari ton="bilgi">
            Ayrıca <strong>KDV-2</strong> ile <strong>{tl(kdv.withholding.purchases)}</strong> ödenecek: alışlarınızda
            tevkif ettiğiniz KDV. Bu tutar yukarıdaki indirilecek KDV&apos;nin içinde.
          </Uyari>
        </ul>
      )}

      <div>
        <h3 className="mb-2 text-sm font-bold text-kobipo-navy dark:text-foreground">Beyandan önce</h3>
        <ul className="space-y-2">
          {k && k.aktarilmamis.adet > 0 && (
            <Uyari
              ton="uyari"
              link={{
                href: `/alis/gelen-e-faturalar?gun=${kapsayanGun(yil, ay, [7, 30, 90, 180, 365])}&durum=KABUL&aktarim=unlinked`,
                etiket: "Gelen faturalar",
              }}
            >
              <strong>{k.aktarilmamis.adet} gelen e-fatura</strong> alış faturasına aktarılmamış —{" "}
              <strong>{tl(k.aktarilmamis.kdv)}</strong> KDV indirime girmiyor.
              {k.aktarilmamis.adet > 1 && k.aktarilmamis.enBuyuk > k.aktarilmamis.kdv / 2 && (
                <> En büyüğü tek başına {tl(k.aktarilmamis.enBuyuk)}; tutarı kontrol edin.</>
              )}
            </Uyari>
          )}
          {k && k.aktarilmamis.dovizli > 0 && (
            <Uyari ton="uyari">
              {k.aktarilmamis.dovizli} dövizli gelen e-fatura alışa aktarılmamış; KDV&apos;si yukarıdaki toplamda yok.
            </Uyari>
          )}
          {k && k.gonderilmemis.adet > 0 && (
            <Uyari ton="uyari" link={{ href: "/satis/fatura?durum=DRAFT,GIB_DRAFT", etiket: "Taslaklar" }}>
              <strong>{k.gonderilmemis.adet} e-Fatura/e-Arşiv</strong> GİB&apos;e gönderilmemiş
              {k.gonderilmemis.kdv !== 0 && (
                <>
                  {" "}
                  — <strong>{tl(k.gonderilmemis.kdv)}</strong> KDV sayılmadı
                </>
              )}
              . Gönderilmeyen belge kesilmiş sayılmaz.
            </Uyari>
          )}
          {kdv.unconvertedForeign > 0 && (
            <Uyari ton="uyari">
              {kdv.unconvertedForeign} dövizli faturanın kuru girilmemiş; TL&apos;ye çevrilemediği için yukarıdaki
              rakamlara dahil değil.
            </Uyari>
          )}
          {k && !bekleyenVar && kdv.unconvertedForeign === 0 && (
            <Uyari ton="tamam">Bekleyen iş yok: aktarılmamış gelen fatura ve gönderilmemiş e-belge bulunmuyor.</Uyari>
          )}
        </ul>
      </div>

      <Acilir baslik="Oranlara göre döküm">
        <div className="grid gap-5 lg:grid-cols-2">
          <OranTablosu baslik="Satışlar" satirlar={kdv.breakdown.sales} />
          <OranTablosu baslik="Alışlar" satirlar={kdv.breakdown.purchases} />
        </div>
      </Acilir>

      <Acilir baslik="Hangi belgeler sayılır?">
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-kobipo-text dark:text-foreground">
          <li>
            <strong>Satışta</strong> kâğıt (matbu) fatura ve fiş kaydedildiği an; e-Fatura ve e-Arşiv GİB&apos;e
            gönderildiğinde sayılır.
          </li>
          <li>
            <strong>Alışta</strong> kaydettiğiniz her alış faturası sayılır. Gelen e-fatura, alış faturasına
            aktarılınca sayılır.
          </li>
          <li>İadeler kendi tarafını azaltır; iptal edilen belgeler ve faturaya dönüşmüş fişler sayılmaz.</li>
          <li>Dövizli faturalar faturadaki kurla TL&apos;ye çevrilir.</li>
          <li>Tevkifatlı satışta KDV&apos;nin alıcının ödeyeceği kısmı sizin hesabınızdan düşülür.</li>
          <li>
            <strong>Dahil değil:</strong> önceki aydan devreden KDV, istisnalar ve KDV iadesi — beyannamede
            muhasebeciniz ekler.
          </li>
        </ul>
      </Acilir>
    </>
  )
}

function OranTablosu({ baslik, satirlar }: { baslik: string; satirlar: VatRateRow[] }) {
  const tevkifatVar = satirlar.some((s) => s.withheld !== 0)
  const toplam = (key: "base" | "vatAmount" | "withheld") => satirlar.reduce((t, s) => t + s[key], 0)
  return (
    <div className="min-w-0">
      <h4 className="mb-1 text-sm font-semibold text-kobipo-navy dark:text-foreground">{baslik}</h4>
      {satirlar.length === 0 ? (
        <p className="py-3 text-sm text-kobipo-gray">Bu dönemde belge yok.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Oran</TableHead>
                <TableHead className="text-right">Matrah</TableHead>
                <TableHead className="text-right">KDV</TableHead>
                {tevkifatVar && <TableHead className="text-right">Tevkifat</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {satirlar.map((s) => (
                <TableRow key={s.vatRate}>
                  <TableCell>%{s.vatRate.toLocaleString("tr-TR")}</TableCell>
                  <TableCell className="text-right tabular-nums">{tl(s.base)}</TableCell>
                  <TableCell className="text-right tabular-nums">{tl(s.vatAmount)}</TableCell>
                  {tevkifatVar && <TableCell className="text-right tabular-nums">{tl(s.withheld)}</TableCell>}
                </TableRow>
              ))}
              <TableRow className="bg-muted/40 font-semibold">
                <TableCell>Toplam</TableCell>
                <TableCell className="text-right tabular-nums">{tl(toplam("base"))}</TableCell>
                <TableCell className="text-right tabular-nums">{tl(toplam("vatAmount"))}</TableCell>
                {tevkifatVar && <TableCell className="text-right tabular-nums">{tl(toplam("withheld"))}</TableCell>}
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

// ── Muhtasar ──────────────────────────────────────────────────────────────

function MuhtasarBolumu({
  donemAdi,
  veri,
  hata,
  yukleniyor,
}: {
  donemAdi: string
  veri: MuhtasarResult | null
  hata: string | null
  yukleniyor: boolean
}) {
  const sag = veri ? (
    <p className="rounded-full bg-kobipo-offwhite px-3 py-1 text-xs font-medium text-kobipo-gray dark:bg-muted/40">
      {veri.bordroSayisi} bordro
    </p>
  ) : null

  return (
    <Bolum
      ikon={<Users className="h-5 w-5" aria-hidden />}
      baslik="Muhtasar"
      altBaslik="Çalışanlardan kesilen vergi ve SGK primi — Personel → Maaş'taki bordrolardan"
      sag={sag}
    >
      {hata && <HataKutusu mesaj={hata} />}
      {yukleniyor && !veri ? <Iskelet /> : veri ? <MuhtasarIcerik donemAdi={donemAdi} veri={veri} /> : null}
    </Bolum>
  )
}

function MuhtasarIcerik({ donemAdi, veri }: { donemAdi: string; veri: MuhtasarResult }) {
  // Kişi başı döküm yalnız Maaş sayfasını açabilene döner; Maaş linki de ona verilir.
  const maasYetkisi = veri.calisanlar !== null
  const bos = veri.bordroSayisi === 0

  return (
    <>
      {bos ? (
        <ul>
          <Uyari ton="bilgi" link={maasYetkisi ? { href: "/personel/maas", etiket: "Maaş-Ödemeler" } : undefined}>
            {donemAdi} için Kobipo&apos;da bordro kaydı yok. Bordroyu muhasebeciniz hazırlıyorsa bu bölüm boş kalır.
          </Uyari>
        </ul>
      ) : (
        <div className="grid gap-2 sm:grid-cols-3 sm:gap-3">
          <Kutucuk
            etiket="Gelir + damga vergisi"
            tutar={tl(veri.gelirDamga)}
            alt="Çalışandan kesilir, muhtasarla ödenir"
          />
          <Kutucuk etiket="SGK işçi payı" tutar={tl(veri.sgkIsci)} alt="SGK ve işsizlik primi" />
          <Kutucuk etiket="Brüt ücretler" tutar={tl(veri.brut)} alt={`Çalışanlara net ${tl(veri.net)}`} />
        </div>
      )}

      {veri.bordrosuz.sayi > 0 && (
        <ul>
          <Uyari ton="uyari" link={maasYetkisi ? { href: "/personel/maas", etiket: "Bordro gir" } : undefined}>
            <strong>{veri.bordrosuz.sayi} çalışanın</strong> {donemAdi} bordrosu girilmemiş
            {veri.bordrosuz.adlar && veri.bordrosuz.adlar.length > 0 && <> ({veri.bordrosuz.adlar.join(", ")})</>};
            {bos ? " muhtasar hesaplanamıyor." : " yukarıdaki rakamlar onlarsız."}
          </Uyari>
        </ul>
      )}

      {!bos &&
        (veri.calisanlar ? (
          <Acilir baslik="Çalışan bazında döküm">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Çalışan</TableHead>
                    <TableHead className="text-right">Brüt</TableHead>
                    <TableHead className="text-right">SGK işçi</TableHead>
                    <TableHead className="text-right">Gelir + damga</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {veri.calisanlar.map((c) => (
                    <TableRow key={c.ref}>
                      <TableCell>
                        <CompanyLink href={`/personel/${c.ref}`} className="font-medium text-kobipo-blue hover:underline">
                          {c.ad}
                        </CompanyLink>
                        {!c.odendi && <span className="ml-2 text-xs text-kobipo-gray">ödenmedi</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{tl(c.brut)}</TableCell>
                      <TableCell className="text-right tabular-nums">{tl(c.sgkIsci)}</TableCell>
                      <TableCell className="text-right tabular-nums">{tl(c.gelirDamga)}</TableCell>
                      <TableCell className="text-right tabular-nums">{tl(c.net)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Acilir>
        ) : (
          <p className="text-xs text-kobipo-gray">
            Çalışan bazında döküm yalnız Maaş-Ödemeler sayfasını açabilen kullanıcılara gösterilir.
          </p>
        ))}

      <p className="text-xs text-kobipo-gray">
        <strong>Dahil değil:</strong> işveren SGK payı ve teşvikler (SGK tahakkukundan kontrol edin), kira ve serbest
        meslek stopajı.
      </p>
    </>
  )
}
