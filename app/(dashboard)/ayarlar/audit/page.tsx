"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export default function AuditPage() {
  const [logs, setLogs] = useState<any[]>([])

  useEffect(() => {
    fetch("/api/system-admin/logs?limit=50").then(async (res) => {
      if (!res.ok) return
      const data = await res.json()
      setLogs(data.logs || data)
    })
  }, [])

  return (
    <Card>
      <CardHeader><CardTitle>Audit Log</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {logs.length === 0 && <p className="text-sm text-muted-foreground">Kayıt bulunamadı</p>}
        {logs.map((log) => (
          <div key={log.id} className="rounded border p-2 text-sm">
            <div className="font-medium">{log.action} - {log.entity || "-"}</div>
            <div className="text-xs text-muted-foreground">{new Date(log.createdAt).toLocaleString("tr-TR")}</div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
