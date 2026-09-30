"use client"

import useSWR from "swr"
import { ArrowUpRight, RefreshCw } from "lucide-react"
import { format } from "date-fns"
import { tr } from "date-fns/locale"
import { CompanyLink } from "@/components/dashboard/company-link"
import { describeFetchError, FetchError, jsonFetcher } from "@/lib/swr/fetcher"
import { OVERDUE_BUCKETS, type AgingBucket } from "@/lib/raporlar/cari-yaslandirma-buckets"
import { cn } from "@/lib/utils"

/**
 * Fatura keserken seçili carinin durumu: bakiye, vadesi geçmiş tutar ve son
 * hareketler.
 *
 * VERİ EKSTREDEN GELİR (`/api/cari/ekstre?last=N`). Cari bakiyesi zaten altı
 * yerde kuruluyor (bkz. CLAUDE.md "Cari bakiyesi ALTI yerde kurulur"); burada
 * yedinci bir hesap yazılmaz. Bakiye ekstrenin son bakiyesi, vade kutuları
 * yaşlandırma raporunun kendisidir — cari ekstresini açan kullanıcı aynı
 * rakamları görür.
 *
 * Ekstrenin ekseni her iki kartta "borç − alacak": müşteride artı bakiye
 * tahsil edilecek tutardır, tedarikçide EKSİ bakiye bizim borcumuzdur.
 *
 * Yetki: uç müşteri/tedarikçi sayfası izni ister. Olmayan kullanıcıda (403)
 * panel çizilmez — kendi ekranı olmayan veriyi burada da görmemeli. Diğer
 * hatalar sessiz geçmez: tek satır hata + yeniden dene.
 */

const SON_HAREKET = 5

type Satir = {
  type: string
  id: string
  date: string
  description: string
  debit: number
  credit: number
  balance: number
}

type Yanit = {
  entries: Satir[]
  finalBalance: number
  aging: Record<AgingBucket, number> | null
  totalEntries?: number
}

const tl = (n: number) =>
  `₺${Math.abs(n).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function bakiyeEtiketi(kind: "customer" | "supplier", bakiye: number) {
  if (Math.abs(bakiye) < 0.005) return { etiket: "Bakiye yok", sinif: "text-kobipo-gray" }
  if (kind === "customer") {
    return bakiye > 0
      ? { etiket: "Tahsil edilecek", sinif: "text-kobipo-navy dark:text-foreground" }
      : { etiket: "Müşteri alacaklı (avans)", sinif: "text-kobipo-green-dark dark:text-emerald-400" }
  }
  return bakiye < 0
    ? { etiket: "Ödenecek", sinif: "text-orange-700 dark:text-orange-400" }
    : { etiket: "Tedarikçiden alacak", sinif: "text-kobipo-green-dark dark:text-emerald-400" }
}

export function CariOzetPaneli({
  companyId,
  customerId,
  supplierId,
}: {
  companyId: string | null
  customerId?: string
  supplierId?: string
}) {
  const kind: "customer" | "supplier" | null = customerId ? "customer" : supplierId ? "supplier" : null
  const partyParam = customerId ? `customerId=${encodeURIComponent(customerId)}` : supplierId ? `supplierId=${encodeURIComponent(supplierId)}` : ""

  const { data, error, isLoading, mutate } = useSWR<Yanit>(
    companyId && kind ? `/api/cari/ekstre?companyId=${encodeURIComponent(companyId)}&${partyParam}&last=${SON_HAREKET}` : null,
    jsonFetcher,
    { revalidateOnFocus: false, dedupingInterval: 30_000 }
  )

  if (!kind || !companyId) return null
  if (error instanceof FetchError && error.status === 403) return null

  const kutu = "rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-xs dark:border-border dark:bg-muted/20"

  if (error) {
    return (
      <div className={cn(kutu, "flex items-center justify-between gap-2 text-red-700 dark:text-red-400")}>
        <span>{describeFetchError(error, "Cari hareketleri").message}</span>
        <button
          type="button"
          onClick={() => mutate()}
          className="inline-flex shrink-0 items-center gap-1 font-semibold hover:underline"
        >
          <RefreshCw className="h-3 w-3" aria-hidden />
          Yeniden dene
        </button>
      </div>
    )
  }

  if (isLoading || !data) {
    return <div className={cn(kutu, "text-kobipo-gray")}>Cari hareketleri yükleniyor…</div>
  }

  const bakiye = bakiyeEtiketi(kind, data.finalBalance)
  const gecikmis = data.aging ? OVERDUE_BUCKETS.reduce((toplam, b) => toplam + (data.aging?.[b] ?? 0), 0) : 0
  const hareketler = [...data.entries].reverse()

  return (
    <div className={kutu}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-kobipo-gray">{bakiye.etiket}</p>
          <p className={cn("font-mono text-sm font-semibold", bakiye.sinif)}>{tl(data.finalBalance)}</p>
        </div>
        <CompanyLink
          href={`/cari/ekstre?${partyParam}`}
          className="inline-flex shrink-0 items-center gap-0.5 font-semibold text-kobipo-blue hover:underline"
        >
          Ekstre
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        </CompanyLink>
      </div>

      {gecikmis > 0.005 && (
        <p className="mt-1.5 font-medium text-amber-700 dark:text-amber-400">
          Vadesi geçmiş: <span className="font-mono">{tl(gecikmis)}</span>
        </p>
      )}

      {hareketler.length === 0 ? (
        <p className="mt-2 text-kobipo-gray">Bu cariyle henüz hareket yok.</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-200/80 border-t border-slate-200/80 dark:divide-border dark:border-border">
          {hareketler.map((h) => {
            const tutar = h.debit - h.credit
            return (
              <li key={`${h.type}-${h.id}`} className="flex items-center justify-between gap-2 py-1.5">
                <span className="min-w-0 truncate text-kobipo-text" title={h.description}>
                  <span className="tabular-nums text-kobipo-gray">{format(new Date(h.date), "d MMM yy", { locale: tr })}</span>
                  {" · "}
                  {h.description}
                </span>
                <span
                  className={cn(
                    "shrink-0 font-mono tabular-nums",
                    tutar >= 0 ? "text-kobipo-navy dark:text-foreground" : "text-kobipo-green-dark dark:text-emerald-400",
                  )}
                >
                  {tutar >= 0 ? "" : "−"}
                  {tl(tutar)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
      {data.totalEntries != null && data.totalEntries > hareketler.length && (
        <p className="mt-1 text-[11px] text-kobipo-gray">Son {hareketler.length} hareket · toplam {data.totalEntries}</p>
      )}
    </div>
  )
}
