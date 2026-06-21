interface PageLoadingSkeletonProps {
  cards?: number
  rows?: number
}

export function PageLoadingSkeleton({ cards = 3, rows = 6 }: PageLoadingSkeletonProps) {
  return (
    <div className="space-y-4 p-4">
      <div className="h-8 w-56 animate-pulse rounded bg-muted" />
      <div className="grid gap-3 md:grid-cols-3">
        {Array.from({ length: cards }).map((_, index) => (
          <div key={`card-${index}`} className="h-24 animate-pulse rounded bg-muted" />
        ))}
      </div>
      <div className="space-y-2 rounded border bg-card p-4">
        {Array.from({ length: rows }).map((_, index) => (
          <div key={`row-${index}`} className="h-9 animate-pulse rounded bg-muted/70" />
        ))}
      </div>
    </div>
  )
}
