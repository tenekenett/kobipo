import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Settings, Database } from "lucide-react"
import { prisma } from "@/lib/db/prisma"
import { getSystemSettings } from "@/lib/system/settings"
import { SettingsForm } from "@/components/system-admin/settings-form"

export const dynamic = "force-dynamic"

async function getDatabaseStatus() {
  try {
    const rows = await prisma.$queryRawUnsafe<{ size: string }[]>(
      "SELECT pg_size_pretty(pg_database_size(current_database())) AS size"
    )
    return { connected: true, size: rows?.[0]?.size ?? "-" }
  } catch {
    return { connected: false, size: "-" }
  }
}

export default async function SettingsPage() {
  const [settings, db] = await Promise.all([getSystemSettings(), getDatabaseStatus()])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white flex items-center gap-3">
          <Settings className="h-8 w-8 text-orange-400" />
          Sistem Ayarları
        </h1>
        <p className="text-slate-400 mt-1">Platform geneli yapılandırma ayarları</p>
      </div>

      <SettingsForm initial={settings} />

      {/* Veritabanı durumu (salt-okunur) */}
      <Card className="bg-slate-900/50 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Database className="h-5 w-5 text-green-400" />
            Veritabanı
          </CardTitle>
          <CardDescription className="text-slate-500">Veritabanı durumu</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/50">
            <span className="text-slate-300">Bağlantı Durumu</span>
            {db.connected ? (
              <span className="flex items-center gap-2 text-green-400">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                Bağlı
              </span>
            ) : (
              <span className="flex items-center gap-2 text-red-400">
                <div className="w-2 h-2 rounded-full bg-red-500" />
                Bağlantı yok
              </span>
            )}
          </div>
          <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/50">
            <span className="text-slate-300">Veritabanı Boyutu</span>
            <span className="text-slate-400">{db.size}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
