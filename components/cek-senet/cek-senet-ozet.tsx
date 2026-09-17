"use client"

import { AlertTriangle, ArrowRightLeft, CheckCircle2, Layers, Undo2, Wallet } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { cekSenetStatusLabel } from "@/lib/cek-senet/labels"
import type { CekSenetOzet, DurumToplami } from "@/lib/cek-senet/ozet"
import { money } from "@/lib/format"

/**
 * Durum kartları: her durumun adet + toplam tutarı, altında alınan/verilen kırılımı.
 * Kart aynı zamanda durum SÜZGECİDİR — tıklamak listeyi o duruma süzer, aktif karta
 * tekrar tıklamak süzgeci kaldırır (gelen e-faturalar ekranındaki desen).
 */

const TONES = {
  slate: {
    border: "border-slate-200 dark:border-slate-700/60",
    label: "text-muted-foreground",
    value: "",
    sub: "text-muted-foreground",
    icon: "text-slate-300 dark:text-slate-500",
    ring: "ring-slate-400 dark:ring-slate-500",
  },
  sky: {
    border: "border-sky-200 dark:border-sky-500/30",
    label: "text-sky-700 dark:text-sky-300",
    value: "text-sky-800 dark:text-sky-200",
    sub: "text-sky-700/80 dark:text-sky-300/80",
    icon: "text-sky-300 dark:text-sky-500/70",
    ring: "ring-sky-500",
  },
  violet: {
    border: "border-violet-200 dark:border-violet-500/30",
    label: "text-violet-700 dark:text-violet-300",
    value: "text-violet-800 dark:text-violet-200",
    sub: "text-violet-700/80 dark:text-violet-300/80",
    icon: "text-violet-300 dark:text-violet-500/70",
    ring: "ring-violet-500",
  },
  emerald: {
    border: "border-emerald-200 dark:border-emerald-500/30",
    label: "text-emerald-700 dark:text-emerald-300",
    value: "text-emerald-800 dark:text-emerald-200",
    sub: "text-emerald-700/80 dark:text-emerald-300/80",
    icon: "text-emerald-300 dark:text-emerald-500/70",
    ring: "ring-emerald-500",
  },
  amber: {
    border: "border-amber-200 dark:border-amber-500/30",
    label: "text-amber-700 dark:text-amber-300",
    value: "text-amber-800 dark:text-amber-200",
    sub: "text-amber-700/80 dark:text-amber-300/80",
    icon: "text-amber-300 dark:text-amber-500/70",
    ring: "ring-amber-500",
  },
  red: {
    border: "border-red-200 dark:border-red-500/30",
    label: "text-red-700 dark:text-red-300",
    value: "text-red-800 dark:text-red-200",
    sub: "text-red-700/80 dark:text-red-300/80",
    icon: "text-red-300 dark:text-red-500/70",
    ring: "ring-red-500",
  },
} as const

type Tone = keyof typeof TONES

const STATUS_STYLE: Record<string, { tone: Tone; Icon: typeof Wallet }> = {
  PORTFÖYDE: { tone: "sky", Icon: Wallet },
  CİRO_EDİLDİ: { tone: "violet", Icon: ArrowRightLeft },
  TAHSİL_EDİLDİ: { tone: "emerald", Icon: CheckCircle2 },
  İADE_EDİLDİ: { tone: "amber", Icon: Undo2 },
  PROTESTOLU: { tone: "red", Icon: AlertTriangle },
}

const UNIT: Record<"CHECK" | "PROMISSORY_NOTE", string> = {
  CHECK: "çek",
  PROMISSORY_NOTE: "senet",
}

export function CekSenetOzetKartlari({
  ozet,
  mode,
  active,
  onSelect,
}: {
  ozet: CekSenetOzet
  mode: "CHECK" | "PROMISSORY_NOTE"
  /** Seçili durum; null = süzgeç yok. */
  active: string | null
  onSelect: (status: string | null) => void
}) {
  const unit = UNIT[mode]
  return (
    <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
      <OzetKart
        tone="slate"
        Icon={Layers}
        label="Tümü"
        row={ozet.all}
        unit={unit}
        active={active === null}
        onClick={() => onSelect(null)}
      />
      {ozet.byStatus.map((row) => {
        const style = STATUS_STYLE[row.status] ?? { tone: "slate" as Tone, Icon: Layers }
        return (
          <OzetKart
            key={row.status}
            tone={style.tone}
            Icon={style.Icon}
            label={cekSenetStatusLabel(row.status)}
            row={row}
            unit={unit}
            active={active === row.status}
            onClick={() => onSelect(active === row.status ? null : row.status)}
          />
        )
      })}
    </div>
  )
}

function OzetKart({
  tone,
  Icon,
  label,
  row,
  unit,
  active,
  onClick,
}: {
  tone: Tone
  Icon: typeof Wallet
  label: string
  row: DurumToplami
  unit: string
  active: boolean
  onClick: () => void
}) {
  const t = TONES[tone]
  // Yön kırılımı: alınan alacaktır, verilen borç — tek toplam ikisini karıştırır.
  // Sıfır olan yön yazılmaz; tek yönlü kartta satır toplamın hangi yön olduğunu söyler.
  const yonler = [
    row.received > 0 ? `Alınan ${money(row.received)}` : null,
    row.given > 0 ? `Verilen ${money(row.given)}` : null,
  ].filter((x): x is string => x !== null)
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={active ? `${label} süzgeci açık — kaldırmak için tıklayın` : `${label} olanlara süz`}
      className="rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-kobipo-blue"
    >
      <Card className={`h-full ${t.border} transition hover:shadow-md ${active ? `ring-2 ${t.ring}` : ""}`}>
        <CardContent className="flex items-start justify-between gap-2 pt-5 pb-4">
          <div className="min-w-0">
            <p className={`text-xs uppercase tracking-wider ${t.label}`}>{label}</p>
            <p className={`truncate text-lg font-bold tabular-nums ${t.value}`} title={money(row.total)}>
              {money(row.total)}
            </p>
            <p className={`text-xs ${t.sub}`}>
              {row.count} {unit}
            </p>
            {yonler.length > 0 && (
              <p className={`mt-1 text-[11px] tabular-nums ${t.sub}`}>{yonler.join(" · ")}</p>
            )}
          </div>
          <Icon className={`h-7 w-7 shrink-0 ${t.icon}`} />
        </CardContent>
      </Card>
    </button>
  )
}
