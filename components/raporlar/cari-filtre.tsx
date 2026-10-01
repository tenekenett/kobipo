"use client"

import { useMemo, type ReactNode } from "react"
import { CalendarRange, RefreshCcw, SlidersHorizontal, UserRound, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SearchSelect } from "@/components/ui/search-select"
import { CariLink } from "@/components/raporlar/rapor-link"
import { reportRangePresets } from "@/lib/raporlar/date-range"
import type { RefCounterparty } from "@/lib/swr/use-company-data"
import { cn } from "@/lib/utils"

/**
 * Raporların CARİ (müşteri/tedarikçi) + DÖNEM süzgeci — satış/alış raporu, bölüm
 * sayfaları ve stok raporu aynı parçaları kullanır.
 *
 * Neden ayrı: müşteri seçici ilk sürümde (7a0df80) stok raporunda tablo
 * başlığındaki yedi kutunun arasına ETİKETSİZ girdi, satışta da tarih ve
 * sınıflandırma kutularının arasında kayboldu; kullanıcı stok tarafında
 * filtreyi hiç bulamadı. Seçici artık süzgeç kartının BAŞINDA, etiketli ve
 * seçiliyken vurgulu durur; seçimden sonra `CariFocusBanner` sayfanın neye
 * süzüldüğünü söyler ("neden bu kadar az kayıt var" sorusu doğmasın).
 */

export type CariKind = "customer" | "supplier"

const KIND_TEXT: Record<CariKind, { label: string; all: string; focus: string }> = {
  customer: { label: "Müşteri", all: "Tüm müşteriler", focus: "Müşteri görünümü" },
  supplier: { label: "Tedarikçi", all: "Tüm tedarikçiler", focus: "Tedarikçi görünümü" },
}

/** Etiket satırı yüksekliği: geçiş düğmeli ve düz etiketli alanlar aynı hizada başlasın. */
export const FILTER_LABEL_ROW = "flex min-h-7 items-center gap-1.5"

/** Seçili kutunun vurgusu — "bir süzgeç açık" tek bakışta görünsün. */
const ACTIVE_FIELD =
  "border-kobipo-blue bg-kobipo-blue/5 font-medium ring-1 ring-kobipo-blue/20 dark:border-primary dark:bg-primary/10 dark:ring-primary/30"

/**
 * Süzgeç kartı: başlık satırı (etkin süzgeç sayısı + Temizle) ve gövde.
 * Gövde ızgarası çağırana aittir; her ekranın alan sayısı farklı.
 */
export function ReportFilterPanel({
  activeCount,
  onClear,
  onRefresh,
  refreshing,
  children,
}: {
  /** Dönem DIŞINDAKİ etkin süzgeç sayısı (dönem her zaman doludur). */
  activeCount: number
  onClear?: () => void
  onRefresh?: () => void
  refreshing?: boolean
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border bg-card shadow-card">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <SlidersHorizontal className="h-4 w-4 text-kobipo-blue dark:text-primary" />
          Filtreler
          {activeCount > 0 && (
            <span className="rounded-full bg-kobipo-blue px-2 py-0.5 text-[11px] font-semibold tabular-nums text-white dark:bg-primary dark:text-primary-foreground">
              {activeCount} etkin
            </span>
          )}
        </p>
        <div className="flex items-center gap-1">
          {onClear && activeCount > 0 && (
            <Button variant="ghost" size="sm" onClick={onClear} className="h-8 text-muted-foreground">
              <X className="mr-1 h-4 w-4" />
              Temizle
            </Button>
          )}
          {onRefresh && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRefresh}
              disabled={refreshing}
              className="h-8 text-muted-foreground"
              title="Raporu yenile"
            >
              <RefreshCcw className={cn("h-4 w-4", refreshing && "animate-spin")} />
              <span className="sr-only">Yenile</span>
            </Button>
          )}
        </div>
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

/**
 * Cari seçici. `onKindChange` verilirse etiketin yerinde "Müşteri | Tedarikçi"
 * geçişi durur — stok raporu iki yöne de bakar (müşteriye satılan / tedarikçiden
 * alınan). Satış ve alış raporunda yön sabittir, geçiş basılmaz.
 */
export function CariFilterSelect({
  id,
  kind,
  options,
  value,
  onChange,
  onKindChange,
}: {
  id: string
  kind: CariKind
  options: RefCounterparty[]
  value: string
  onChange: (id: string) => void
  onKindChange?: (kind: CariKind) => void
}) {
  const text = KIND_TEXT[kind]
  // VKN/TCKN ipucu: aynı adlı iki cari ya da yalnız numarası bilinen cari için.
  const searchOptions = useMemo(
    () => options.map((c) => ({ id: c.id, name: c.name, hint: c.taxNumber ?? null })),
    [options]
  )

  return (
    <div className="space-y-1.5">
      <div className={cn(FILTER_LABEL_ROW, "justify-between")}>
        <Label htmlFor={id} className="flex items-center gap-1.5">
          <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
          {onKindChange ? "Cari" : text.label}
        </Label>
        {onKindChange && (
          <div role="radiogroup" aria-label="Cari türü" className="inline-flex rounded-md border bg-muted/60 p-0.5">
            {(["customer", "supplier"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={kind === option}
                onClick={() => option !== kind && onKindChange(option)}
                className={cn(
                  "rounded px-2.5 py-0.5 text-xs font-medium transition-colors",
                  kind === option
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {KIND_TEXT[option].label}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="relative">
      <UserRound
        className={cn(
          "pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2",
          value ? "text-kobipo-blue dark:text-primary" : "text-muted-foreground"
        )}
      />
      <SearchSelect
        id={id}
        options={searchOptions}
        value={value}
        onChange={onChange}
        placeholder={text.all}
        allowClear
        clearLabel={text.all}
        emptyText={`${text.label} bulunamadı`}
        className={cn("pl-9", value && ACTIVE_FIELD)}
      />
      </div>
    </div>
  )
}

/**
 * Dönem: iki tarih kutusu + kısayollar. Seçili kısayol, kutulardaki aralık
 * ona BİREBİR eşitse yanar; elle değiştirilen aralıkta hiçbiri yanmaz.
 *
 * `allowAll` dönemi tamamen kaldırır (iki kutu boş = tüm kayıtlar). Yalnız
 * boş aralığı anlayan ekranlarda açılır — stok raporunun dönem sütunları iki
 * ucu da ister.
 */
export function PeriodFilter({
  idPrefix,
  startDate,
  endDate,
  onChange,
  allowAll,
  label = "Dönem",
}: {
  idPrefix: string
  startDate: string
  endDate: string
  onChange: (range: { startDate: string; endDate: string }) => void
  allowAll?: boolean
  label?: string
}) {
  const presets = useMemo(() => reportRangePresets(), [])
  const isAll = !startDate && !endDate

  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
      active
        ? "border-kobipo-blue bg-kobipo-blue text-white dark:border-primary dark:bg-primary dark:text-primary-foreground"
        : "border-border bg-background text-muted-foreground hover:border-kobipo-blue/50 hover:text-foreground"
    )

  return (
    <div className="space-y-1.5">
      <div className={FILTER_LABEL_ROW}>
        <Label htmlFor={`${idPrefix}-baslangic`} className="flex items-center gap-1.5">
          <CalendarRange className="h-3.5 w-3.5 text-muted-foreground" />
          {label}
        </Label>
      </div>
      <div className="flex items-center gap-1.5">
        <Input
          id={`${idPrefix}-baslangic`}
          type="date"
          aria-label="Dönem başlangıcı"
          className="min-w-0 flex-1"
          value={startDate}
          max={endDate || undefined}
          onChange={(e) => onChange({ startDate: e.target.value, endDate })}
        />
        <span className="text-muted-foreground">–</span>
        <Input
          id={`${idPrefix}-bitis`}
          type="date"
          aria-label="Dönem bitişi"
          className="min-w-0 flex-1"
          value={endDate}
          min={startDate || undefined}
          onChange={(e) => onChange({ startDate, endDate: e.target.value })}
        />
      </div>
      <div className="flex flex-wrap gap-1.5 pt-0.5">
        {presets.map((preset) => (
          <button
            key={preset.key}
            type="button"
            aria-pressed={preset.startDate === startDate && preset.endDate === endDate}
            className={chip(preset.startDate === startDate && preset.endDate === endDate)}
            onClick={() => onChange({ startDate: preset.startDate, endDate: preset.endDate })}
          >
            {preset.label}
          </button>
        ))}
        {allowAll && (
          <button
            type="button"
            aria-pressed={isAll}
            className={chip(isAll)}
            onClick={() => onChange({ startDate: "", endDate: "" })}
          >
            Tüm zamanlar
          </button>
        )}
      </div>
    </div>
  )
}

/** "ACME Gıda Ltd" → "AG". Türkçe büyük harf (i → İ). */
function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toLocaleUpperCase("tr-TR"))
    .join("")
}

/**
 * Sayfa tek cariye süzülmüşken üstte duran şerit: kim, ne anlama geliyor,
 * özet rakamlar (`children`) ve süzgeci kaldırma. Ad cari kartına bağlanır.
 */
export function CariFocusBanner({
  companyId,
  kind,
  cariId,
  name,
  description,
  from,
  actions,
  onClear,
  children,
}: {
  companyId: string
  kind: CariKind
  cariId: string
  /** Seçicinin listesinden; liste henüz gelmediyse boş olabilir. */
  name: string | null | undefined
  description?: ReactNode
  /** Cari kartının "geri" düğmesi bu sayfaya dönsün. */
  from?: string
  actions?: ReactNode
  onClear?: () => void
  children?: ReactNode
}) {
  const text = KIND_TEXT[kind]
  const display = name || "…"
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-kobipo-blue/30 bg-gradient-to-r from-kobipo-blue/10 via-kobipo-blue/5 to-transparent p-4 dark:border-primary/30 dark:from-primary/15 dark:via-primary/5 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-kobipo-blue text-sm font-bold text-white shadow-sm dark:bg-primary dark:text-primary-foreground">
          {name ? initialsOf(name) : <UserRound className="h-5 w-5" />}
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-kobipo-blue dark:text-primary">
            {text.focus}
          </p>
          <p className="truncate text-base font-semibold">
            <CariLink companyId={companyId} kind={kind} cariRef={cariId} from={from}>
              {display}
            </CariLink>
          </p>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
      {(actions || onClear) && (
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {onClear && (
            <Button variant="ghost" size="sm" onClick={onClear} className="text-muted-foreground">
              <X className="mr-1 h-4 w-4" />
              Süzgeci kaldır
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

/** Şeritteki küçük rakam kutusu. */
export function FocusStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border bg-background/80 px-3 py-1.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="font-mono text-sm font-semibold tabular-nums">{value}</p>
    </div>
  )
}
