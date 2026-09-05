"use client"

import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { ProjectionBucket } from "@/lib/raporlar/nakit-projeksiyon-kova"

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)

const compact = (value: number) => {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${Math.round(value / 1_000)}B`
  return String(value)
}

function ProjectionTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const bucket: ProjectionBucket | undefined = payload[0]?.payload
  return (
    <div className="rounded-lg border bg-background p-3 shadow-lg">
      <p className="font-medium">{label}</p>
      {bucket && (
        <p className="mb-2 text-xs text-muted-foreground">
          {bucket.startDate} → {bucket.endDate}
        </p>
      )}
      {payload.map((entry: any) => (
        <p key={entry.dataKey} style={{ color: entry.color }} className="text-sm">
          {entry.name}: {formatCurrency(entry.value)}
        </p>
      ))}
    </div>
  )
}

export function NakitProjeksiyonChart({ data }: { data: ProjectionBucket[] }) {
  return (
    <div className="h-[340px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis
            dataKey="label"
            tick={{ fill: "currentColor", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fill: "currentColor", fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={compact}
          />
          <Tooltip content={<ProjectionTooltip />} />
          <Legend />
          {/* Sıfır çizgisi ŞART: bu grafiğin tek sorusu "bakiye eksiye düşüyor
              mu"; referans olmadan eğrinin nereyi kestiği gözle okunamıyor. */}
          <ReferenceLine y={0} stroke="#dc2626" strokeDasharray="4 4" />
          <Bar dataKey="inflow" name="Tahsilat" fill="#22c55e" radius={[3, 3, 0, 0]} />
          <Bar dataKey="outflow" name="Ödeme" fill="#ef4444" radius={[3, 3, 0, 0]} />
          <Area
            type="monotone"
            dataKey="balance"
            name="Kümülatif bakiye"
            stroke="#2563eb"
            strokeWidth={2}
            fill="#2563eb"
            fillOpacity={0.12}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
