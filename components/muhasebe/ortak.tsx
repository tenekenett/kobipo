"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { AlertTriangle, Loader2, Settings2 } from "lucide-react"
import { CompanyLink } from "@/components/dashboard/company-link"
import { toast } from "@/components/ui/use-toast"
import { cn } from "@/lib/utils"

/**
 * Muhasebe ekranlarının ortak parçaları. Kurallar sunucuda (lib/muhasebe); burası
 * yalnız gösterir ve seçtirir.
 */

const tlFormat = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** "1.234,50" — muhasebe tablolarında ₺ işareti sütun başlığında durur. */
export const tutar = (n: number | null | undefined) => (n ? tlFormat.format(n) : "")
export const tutarSifirli = (n: number | null | undefined) => tlFormat.format(n ?? 0)
export const tl = (n: number) => `₺${tlFormat.format(n)}`

/** "2026-09-30" → "30.09.2026". */
export function gunMetni(iso: string | null | undefined): string {
  if (!iso) return ""
  const [y, m, d] = iso.slice(0, 10).split("-")
  return `${d}.${m}.${y}`
}

export async function muhasebeIstegi<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...(init?.headers ?? {}) } : init?.headers,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const err = new Error(data?.error || `İstek başarısız (${res.status})`) as Error & { code?: string; status?: number }
    err.code = data?.code
    err.status = res.status
    throw err
  }
  return data as T
}

export function hataBildir(e: unknown, baslik = "İşlem yapılamadı") {
  toast({ title: baslik, description: e instanceof Error ? e.message : String(e), variant: "destructive" })
}

export type MuhasebeDurumu = {
  defter: { id: string; ad: string; sube: boolean; sirketSayisi: number }
  modulAcik: boolean
  kurulu: boolean
  ayar: { baslangic: string; kilitliSonGun: string | null; planKurulum: string | null } | null
  hesapSayisi: number
  fisler: { taslak: number; onayli: number }
  acilis: { id: string; no: string; durum: string; emin: boolean; degisti: boolean } | null
}

/** Defterin kurulum durumu — her muhasebe ekranı önce bunu sorar. */
export function useMuhasebeDurumu(companyId: string | null) {
  const [durum, setDurum] = useState<MuhasebeDurumu | null>(null)
  const [hata, setHata] = useState<string | null>(null)
  const yenile = useCallback(async () => {
    if (!companyId) return
    try {
      setDurum(await muhasebeIstegi<MuhasebeDurumu>(`/api/muhasebe/ayarlar?companyId=${encodeURIComponent(companyId)}`))
      setHata(null)
    } catch (e) {
      setHata(e instanceof Error ? e.message : String(e))
    }
  }, [companyId])
  useEffect(() => {
    void yenile()
  }, [yenile])
  return { durum, hata, yenile }
}

export function SayfaBasligi({ baslik, aciklama, sag }: { baslik: string; aciklama?: ReactNode; sag?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-kobipo-navy dark:text-foreground">{baslik}</h1>
        {aciklama && <p className="mt-1 max-w-3xl text-sm text-kobipo-gray">{aciklama}</p>}
      </div>
      {sag && <div className="flex flex-wrap items-center gap-2">{sag}</div>}
    </header>
  )
}

export function Kart({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-2xl border border-kobipo-border/90 bg-card p-4 shadow-card sm:p-5", className)}>
      {children}
    </section>
  )
}

/**
 * Muhasebe durumu gelene kadar ekranın yerine: yükleniyor ya da durum hatası. Durum
 * gelmeden sayfa hiçbir şey çizmiyordu (uzak veritabanında saniyelerce boş ekran) ve
 * durum isteği düşerse hata hiç görünmüyordu.
 */
export function DurumBekleniyor({ hata }: { hata: string | null }) {
  if (hata) return <Uyari ton="kirmizi">{hata}</Uyari>
  return (
    <p className="flex items-center gap-2 p-6 text-sm text-kobipo-gray">
      <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor…
    </p>
  )
}

/** Kurulum yapılmamış defterde ekranın yerine. */
export function KurulumGerekli({ durum }: { durum: MuhasebeDurumu | null }) {
  return (
    <Kart className="flex flex-col items-start gap-3">
      <div className="flex items-center gap-2.5">
        <span className="rounded-xl bg-kobipo-pale p-2 text-kobipo-blue">
          <Settings2 className="h-5 w-5" aria-hidden />
        </span>
        <p className="font-semibold text-kobipo-navy dark:text-foreground">Muhasebe henüz kurulmadı</p>
      </div>
      <p className="text-sm text-kobipo-gray">
        Başlangıç tarihini seçin; Tekdüzen hesap planı kurulur, o tarihteki bakiyelerden açılış fişi hazırlanır ve
        sonraki belgelerinizin taslak fişleri kendiliğinden üretilir.
        {durum?.defter.sube && " Şubenin belgeleri ana firmanın defterine yazılır."}
      </p>
      <CompanyLink
        href="/muhasebe/ayarlar"
        className="rounded-xl bg-kobipo-blue px-4 py-2 text-sm font-semibold text-white hover:bg-kobipo-blue/90"
      >
        Muhasebe Ayarları&apos;na git
      </CompanyLink>
    </Kart>
  )
}

export function Uyari({ children, ton = "sari" }: { children: ReactNode; ton?: "sari" | "kirmizi" | "mavi" }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-xl border p-3 text-sm",
        ton === "kirmizi" && "border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-100",
        ton === "sari" && "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100",
        ton === "mavi" && "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-100",
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  )
}

export type PlanHesabi = {
  id: string
  kod: string
  ad: string
  duzey: number
  aktif: boolean
  yaprak: boolean
  kullanim: number
  bagli: string | null
}

/** Fiş türü etiketi. */
export const FIS_TURU: Record<string, string> = {
  ACILIS: "Açılış",
  MAHSUP: "Mahsup",
  TAHSIL: "Tahsil",
  TEDIYE: "Tediye",
  KAPANIS: "Kapanış",
}

/** Kaynak türü etiketi (fiş listesi süzgeci ve rozet). */
export const KAYNAK_TURU: Record<string, string> = {
  INVOICE: "Fatura / fiş",
  PAYMENT: "Kasasız ödeme",
  TRANSACTION: "Kasa / banka hareketi",
  CHECK: "Çek",
  CHECK_ENDORSE: "Çek cirosu",
  NOTE: "Senet",
  NOTE_ENDORSE: "Senet cirosu",
  VIRMAN: "Cari virman",
  PAYROLL: "Bordro",
  CARI_OPENING: "Cari açılış bakiyesi",
  ACCOUNT_OPENING: "Kasa açılış bakiyesi",
  OPENING: "Açılış",
  CLOSING: "Dönem kapanışı",
  MANUAL: "Elle fiş",
}

/** Hesabın nereden geldiği — satırın yanında küçük rozet. */
export const HESAP_KAYNAGI: Record<string, { ad: string; sinif: string }> = {
  USER: { ad: "elle", sinif: "bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-200" },
  LEARNED: { ad: "öğrenildi", sinif: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200" },
  CARI: { ad: "kayıt hesabı", sinif: "bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200" },
  DEFAULT: { ad: "varsayılan", sinif: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" },
  NONE: { ad: "hesap yok", sinif: "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-200" },
}
