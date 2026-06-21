export function StatsSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-28 animate-pulse rounded-2xl border border-kobipo-border bg-muted/40" />
      ))}
    </div>
  )
}

export function CashflowSummarySkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-xl border bg-muted/40" />
      ))}
    </div>
  )
}

export function CashflowChartSkeleton() {
  return <div className="h-[360px] animate-pulse rounded-xl border bg-muted/30" />
}

export function RecentInvoicesSkeleton() {
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="h-5 w-40 animate-pulse rounded bg-muted" />
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-lg bg-muted/60" />
      ))}
    </div>
  )
}
