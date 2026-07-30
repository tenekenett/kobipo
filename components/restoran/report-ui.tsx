"use client"

// Restoran & Kafe raporlarının ortak istemci parçaları: tarih aralığı, veri
// çekme ve tekrar eden görsel öğeler. Dört rapor da aynı aralık mantığını
// kullanmak zorunda — ayrı ayrı yazılsaydı biri "bugün"ü 00:00, diğeri 03:00
// başlatırdı (bkz. aşağıdaki saat dilimi notu).

import { useMemo, useState } from "react"
import useSWR from "swr"
import { jsonFetcher } from "@/lib/swr/fetcher"
import { Card, CardContent } from "@/components/ui/card"
import { FetchErrorText } from "@/components/ui/fetch-error"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

// Biçimlendiriciler lib/format.ts'te; rapor sayfaları bunları buradan almaya
// devam edebilsin diye yeniden dışa aktarılıyor (tek tanım, tek import yolu).
export { money, money0, qty, pct } from "@/lib/format"

/** YYYY-MM-DD (yerel gün). */
const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

const today = () => isoDay(new Date())
const daysAgo = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return isoDay(d)
}
const monthStart = () => {
  const d = new Date()
  return isoDay(new Date(d.getFullYear(), d.getMonth(), 1))
}

/**
 * Yerel gün sınırlarını mutlak ISO'ya çevirir. Sunucu tarafında tarihler UTC
 * saklanıyor; "26 Temmuz"u sunucuya çıplak gönderirsek sunucunun saat dilimine
 * göre yorumlanır ve TSİ 00:00–03:00 arası satışlar yanlış güne düşer.
 */
const startIso = (day: string) => {
  const [y, m, d] = day.split("-").map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0).toISOString()
}
const endIso = (day: string) => {
  const [y, m, d] = day.split("-").map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1, 23, 59, 59, 999).toISOString()
}

export type RangePreset = "today" | "yesterday" | "week" | "month"

const PRESETS: { key: RangePreset; label: string; range: () => [string, string] }[] = [
  { key: "today", label: "Bugün", range: () => [today(), today()] },
  { key: "yesterday", label: "Dün", range: () => [daysAgo(1), daysAgo(1)] },
  { key: "week", label: "Son 7 gün", range: () => [daysAgo(6), today()] },
  { key: "month", label: "Bu ay", range: () => [monthStart(), today()] },
]

export function useReportRange(initial: RangePreset = "week") {
  const [[from, to], setRange] = useState<[string, string]>(
    () => PRESETS.find((p) => p.key === initial)!.range()
  )
  const query = useMemo(
    () => `startDate=${encodeURIComponent(startIso(from))}&endDate=${encodeURIComponent(endIso(to))}`,
    [from, to]
  )
  return {
    from,
    to,
    query,
    setFrom: (v: string) => setRange(([, t]) => [v, t]),
    setTo: (v: string) => setRange(([f]) => [f, v]),
    setPreset: (key: RangePreset) => setRange(PRESETS.find((p) => p.key === key)!.range()),
    /** Tek günlük raporlarda (gün sonu) ileri/geri gitmek için. */
    shiftDay: (delta: number) =>
      setRange(([f]) => {
        const [y, m, d] = f.split("-").map(Number)
        const next = isoDay(new Date(y, (m ?? 1) - 1, (d ?? 1) + delta))
        return [next, next]
      }),
    setDay: (v: string) => setRange([v, v]),
  }
}

/**
 * Tarih aralığı artık raporun KENDİSİNE ait değil, onları barındıran sekmeli
 * sayfaya ait (app/(dashboard)/restoran/raporlar). Böylece kullanıcı aralığı bir
 * kez seçip sekmeler arasında geziyor; eskiden her rapor kendi aralığını
 * tuttuğu için sekme değiştirince seçim sıfırlanıyordu.
 */
export type ReportRangeState = ReturnType<typeof useReportRange>

/** Sekmeli sayfanın her rapora geçirdiği ortak sözleşme. */
export type ReportProps = { range: ReportRangeState }

/**
 * Rapor verisi — companyId yokken SWR isteği atmaz.
 *
 * `keepPreviousData` tarih aralığı değişirken tablonun titremesini önlüyor, ama
 * FİRMA değişiminde tehlikeli: yeni firmanın başlığı altında önceki firmanın
 * rakamları görünüyordu (tarayıcı testinde yakalandı). Bu yüzden yanıt kendi
 * anahtarıyla sarmalanıyor ve firma öneki tutmuyorsa veri gösterilmiyor —
 * aralık değişiminde önceki veri korunur, firma değişiminde yükleniyor durumuna düşer.
 */
export function useReport<T>(path: string, companyId: string | null, query: string) {
  const prefix = `${path}?companyId=${companyId}&`
  const key = companyId ? `${prefix}${query}` : null
  const { data, error, isLoading } = useSWR<{ key: string; payload: T }>(
    key,
    async (k: string) => ({ key: k, payload: await jsonFetcher<T>(k) }),
    { keepPreviousData: true }
  )
  const isSameCompany = data ? data.key.startsWith(prefix) : false
  return {
    data: isSameCompany ? data!.payload : undefined,
    error,
    isLoading: isLoading || (data != null && !isSameCompany),
  }
}

export function RangeBar({
  range,
  className,
}: {
  range: ReturnType<typeof useReportRange>
  className?: string
}) {
  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between", className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS.map((p) => {
          const [f, t] = p.range()
          const isActive = range.from === f && range.to === t
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => range.setPreset(p.key)}
              className={cn(
                "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
                isActive
                  ? "bg-kobipo-blue text-white dark:bg-primary dark:text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/70"
              )}
            >
              {p.label}
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="date"
          value={range.from}
          max={range.to}
          onChange={(e) => range.setFrom(e.target.value)}
          className="h-9 w-40"
        />
        <span className="text-muted-foreground">–</span>
        <Input
          type="date"
          value={range.to}
          min={range.from}
          onChange={(e) => range.setTo(e.target.value)}
          className="h-9 w-40"
        />
      </div>
    </div>
  )
}

export function StatTile({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string
  value: string
  hint?: string
  tone?: "default" | "good" | "warn" | "bad" | "brand"
}) {
  const toneClass =
    tone === "good"
      ? "text-kobipo-green"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : tone === "bad"
          ? "text-red-600 dark:text-red-400"
          : tone === "brand"
            ? "text-kobipo-blue dark:text-primary"
            : "text-kobipo-navy dark:text-foreground"
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className={cn("mt-1 truncate text-xl font-extrabold tabular-nums lg:text-2xl", toneClass)}>
          {value}
        </p>
        {hint && <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  )
}

/** Mevcut rapor ekranlarındaki desen: grafik kütüphanesi yok, bar CSS ile çizilir. */
export function Bar({ pct: value, tone = "brand" }: { pct: number; tone?: "brand" | "green" | "amber" }) {
  const width = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
  const fill =
    tone === "green"
      ? "bg-kobipo-green"
      : tone === "amber"
        ? "bg-amber-500"
        : "bg-gradient-to-r from-kobipo-blue to-kobipo-mid"
  return (
    <div className="h-2 overflow-hidden rounded-full bg-muted">
      <div className={cn("h-full rounded-full", fill)} style={{ width: `${width}%` }} />
    </div>
  )
}

/**
 * Dakika → "2 sa 15 dk". Masa süresi hem gün sonunda (açık masalar) hem masa
 * raporunda (ortalama süre) gösteriliyor; iki yerde ayrı yazılsaydı biri
 * "135 dk" diğeri "2 sa" derdi.
 */
export function duration(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return "—"
  const total = Math.max(0, Math.round(minutes))
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m} dk`
  return m === 0 ? `${h} sa` : `${h} sa ${m} dk`
}

export function marginTone(margin: number | null): "good" | "warn" | "bad" | "default" {
  if (margin == null) return "default"
  if (margin < 0) return "bad"
  if (margin < 20) return "warn"
  return "good"
}

export function ReportState({
  isLoading,
  error,
  empty,
  emptyText,
}: {
  isLoading: boolean
  error: unknown
  empty: boolean
  emptyText: string
}) {
  if (error) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-red-600 dark:text-red-400">
          <FetchErrorText error={error} subject="Rapor" />
        </CardContent>
      </Card>
    )
  }
  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">Yükleniyor…</CardContent>
      </Card>
    )
  }
  if (empty) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">{emptyText}</CardContent>
      </Card>
    )
  }
  return null
}
