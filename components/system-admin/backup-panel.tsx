"use client"

import { useState } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import {
  Download,
  Loader2,
  Copy,
  ExternalLink,
  HardDriveDownload,
  Database,
  Info,
} from "lucide-react"

interface BackupPanelProps {
  dbSize: string
  dashboardUrl: string | null
}

// Free planda Supabase yönetilen otomatik yedek sağlamaz; tam yedek için
// connection string ile manuel pg_dump kullanılır (gelecekte veri büyüdüğünde).
const PG_DUMP = `pg_dump --clean --if-exists --no-owner "$DIRECT_URL" > kobipo-yedek.sql`
const PSQL_RESTORE = `psql "$DIRECT_URL" -f kobipo-yedek.sql`
const CLI_DUMP = `supabase db dump --db-url "$DIRECT_URL" -f kobipo-yedek.sql`

export function BackupPanel({ dbSize, dashboardUrl }: BackupPanelProps) {
  const { toast } = useToast()
  const [downloading, setDownloading] = useState(false)

  async function handleDownload() {
    setDownloading(true)
    try {
      const res = await fetch("/api/system-admin/backup")
      if (!res.ok) {
        const j = await res.json().catch(() => null)
        throw new Error(j?.error || "Yedek alınamadı")
      }
      const blob = await res.blob()
      const cd = res.headers.get("Content-Disposition") || ""
      const fname = /filename="?([^"]+)"?/.exec(cd)?.[1] || "kobipo-yedek.json"
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = fname
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast({ title: "Yedek indirildi", description: fname })
    } catch (e) {
      toast({
        title: "Hata",
        description: e instanceof Error ? e.message : "Yedek alınamadı",
        variant: "destructive",
      })
    } finally {
      setDownloading(false)
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast({ title: "Komut kopyalandı" })
    } catch {
      toast({ title: "Kopyalanamadı", variant: "destructive" })
    }
  }

  return (
    <div className="space-y-6">
      {/* Tek tık JSON yedek */}
      <Card className="bg-slate-900/50 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <HardDriveDownload className="h-5 w-5 text-orange-400" />
            Hızlı Yedek (JSON)
          </CardTitle>
          <CardDescription className="text-slate-500">
            Tüm tablolardaki veriyi tek dosyada indirir. Geri yükleme için saklayın.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-3 rounded-lg bg-slate-800/50">
            <span className="flex items-center gap-2 text-slate-300">
              <Database className="h-4 w-4 text-green-400" />
              Veritabanı Boyutu
            </span>
            <span className="text-slate-400">{dbSize}</span>
          </div>

          <Button
            onClick={handleDownload}
            disabled={downloading}
            className="bg-gradient-to-r from-red-500 to-orange-500 text-white hover:from-red-600 hover:to-orange-600"
          >
            {downloading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Yedek hazırlanıyor…
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Tek Tıkla Yedek İndir
              </>
            )}
          </Button>

          <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-300/90">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Bu yedek yalnızca <strong>veriyi</strong> içerir (tablo yapısı
              koddan / <code>prisma db push</code> ile kurulur). Veri çok
              büyüdüğünde bu yöntem zaman aşımına uğrayabilir; o zaman aşağıdaki
              Supabase <code>pg_dump</code> yolunu kullanın.
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Supabase (Free) — tam yedek */}
      <Card className="bg-slate-900/50 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <Database className="h-5 w-5 text-green-400" />
            Tam Yedek — Supabase (pg_dump)
          </CardTitle>
          <CardDescription className="text-slate-500">
            Şema + veri dahil eksiksiz, geri yüklenebilir yedek. Free planda
            otomatik yedek yoktur; aşağıdaki komutları kendi bilgisayarınızda
            çalıştırın.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-slate-500">
            Önce Supabase panelinden <strong>Direct connection</strong> bağlantı
            dizesini alın ve <code>$DIRECT_URL</code> yerine koyun (ya da{" "}
            <code>export DIRECT_URL=&quot;postgresql://…&quot;</code> yapın).
          </p>

          <CommandRow label="Yedek al" command={PG_DUMP} onCopy={copy} />
          <CommandRow label="Geri yükle (mevcut veriyi ezer)" command={PSQL_RESTORE} onCopy={copy} />
          <CommandRow label="Alternatif — Supabase CLI" command={CLI_DUMP} onCopy={copy} />

          {dashboardUrl && (
            <a
              href={dashboardUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-orange-400 hover:text-orange-300"
            >
              <ExternalLink className="h-4 w-4" />
              Supabase — Bağlantı dizesi / Veritabanı ayarları
            </a>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function CommandRow({
  label,
  command,
  onCopy,
}: {
  label: string
  command: string
  onCopy: (text: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-medium text-slate-400">{label}</span>
      <div className="flex items-center gap-2 rounded-lg bg-slate-950 border border-slate-800 p-2">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-xs text-slate-300">
          {command}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-slate-400 hover:text-white hover:bg-slate-800"
          onClick={() => onCopy(command)}
          aria-label="Kopyala"
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}
