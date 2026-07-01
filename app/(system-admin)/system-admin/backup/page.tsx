import { DatabaseBackup } from "lucide-react"
import { prisma } from "@/lib/db/prisma"
import { BackupPanel } from "@/components/system-admin/backup-panel"

export const dynamic = "force-dynamic"

/** NEXT_PUBLIC_SUPABASE_URL'den proje ref'ini çıkarıp Dashboard linki üretir. */
function supabaseDashboardUrl(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) return null
  try {
    const ref = new URL(url).hostname.split(".")[0] // <ref>.supabase.co
    return ref ? `https://supabase.com/dashboard/project/${ref}/settings/database` : null
  } catch {
    return null
  }
}

async function getDbSize(): Promise<string> {
  try {
    const rows = await prisma.$queryRawUnsafe<{ size: string }[]>(
      "SELECT pg_size_pretty(pg_database_size(current_database())) AS size"
    )
    return rows?.[0]?.size ?? "-"
  } catch {
    return "-"
  }
}

export default async function BackupPage() {
  const dbSize = await getDbSize()
  const dashboardUrl = supabaseDashboardUrl()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <DatabaseBackup className="h-8 w-8 text-orange-400" />
          Yedekleme
        </h1>
        <p className="text-slate-400 mt-1">Veritabanı yedeği alın ve saklayın</p>
      </div>

      <BackupPanel dbSize={dbSize} dashboardUrl={dashboardUrl} />
    </div>
  )
}
