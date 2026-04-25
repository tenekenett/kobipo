export default function DashboardLoading() {
  return (
    <div className="space-y-3 p-4">
      <div className="h-8 w-56 animate-pulse rounded bg-muted" />
      <div className="grid gap-3 md:grid-cols-3">
        <div className="h-24 animate-pulse rounded bg-muted" />
        <div className="h-24 animate-pulse rounded bg-muted" />
        <div className="h-24 animate-pulse rounded bg-muted" />
      </div>
    </div>
  )
}
