"use client"

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

export type CashflowPoint = { label: string; income: number; expense: number }

function formatTry(n: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(n)
}

function compactTry(n: number) {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}M`
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })}B`
  return formatTry(n)
}

export function DashboardCashflowChart({ data }: { data: CashflowPoint[] }) {
  const hasData = data.some((d) => d.income > 0 || d.expense > 0)

  if (!hasData) {
    return (
      <div className="flex h-[240px] flex-col items-center justify-center rounded-2xl border border-dashed border-kobipo-border bg-kobipo-offwhite/60 text-center">
        <p className="text-sm font-medium text-kobipo-navy">Henüz hareket yok</p>
        <p className="mt-1 max-w-xs text-xs text-kobipo-gray">
          Son 14 günde kayıtlı gelir veya gider işlemi bulunmuyor. Finans modülünden işlem ekledikçe grafik burada
          canlanacak.
        </p>
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 4, right: 6, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="dashIncome" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#185FA5" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#185FA5" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="dashExpense" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#DC2626" stopOpacity={0.22} />
            <stop offset="100%" stopColor="#DC2626" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 6" vertical={false} stroke="#DDE8F5" strokeOpacity={0.9} />
        <XAxis
          dataKey="label"
          tick={{ fill: "#6B7A99", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          dy={6}
        />
        <YAxis
          tick={{ fill: "#6B7A99", fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => compactTry(Number(v))}
          width={48}
        />
        <Tooltip
          contentStyle={{
            borderRadius: 12,
            border: "1px solid #DDE8F5",
            boxShadow: "0 8px 24px rgba(12,59,107,0.08)",
            fontSize: 12,
          }}
          labelStyle={{ color: "#0C3B6B", fontWeight: 600 }}
          formatter={(value: number, name: string) => [
            formatTry(value),
            name === "income" ? "Gelir" : "Gider",
          ]}
        />
        <Area
          type="monotone"
          dataKey="expense"
          name="expense"
          stroke="#DC2626"
          strokeWidth={2}
          fill="url(#dashExpense)"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
        />
        <Area
          type="monotone"
          dataKey="income"
          name="income"
          stroke="#185FA5"
          strokeWidth={2.5}
          fill="url(#dashIncome)"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
