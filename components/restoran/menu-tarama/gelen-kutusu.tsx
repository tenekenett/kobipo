"use client"

/**
 * Menü tarama gelen kutusu — oturum listesi (aynı menünün dosyaları tek satır).
 * Okunmuş ama onaylanmamış oturum kaybolmaz; satıra tıklayınca fark listesi açılır.
 */

import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { MenuOturumOzeti } from "@/lib/menu-ocr/turler"
import { RefreshCw } from "lucide-react"

const fetcher = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error("liste alınamadı"))))

const DURUM_ETIKETI: Record<MenuOturumOzeti["status"], string> = {
  READING: "Okunuyor",
  AWAITING_APPROVAL: "Onay bekliyor",
  SAVED: "Kaydedildi",
  REJECTED: "Reddedildi",
  FAILED: "Hata",
}

const DURUM_STILI: Record<MenuOturumOzeti["status"], string> = {
  READING: "bg-kobipo-blue/10 text-kobipo-blue",
  AWAITING_APPROVAL: "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200",
  SAVED: "bg-kobipo-green-light text-kobipo-green-dark",
  REJECTED: "bg-kobipo-offwhite text-kobipo-gray",
  FAILED: "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300",
}

export function MenuGelenKutusu({ companyId, seciliId, onSec, yenilemeAnahtari }: { companyId: string; seciliId: string | null; onSec: (sessionId: string) => void; yenilemeAnahtari: number }) {
  const { data, error, isLoading, mutate } = useSWR<MenuOturumOzeti[]>(
    `/api/restoran/menu-tarama?companyId=${encodeURIComponent(companyId)}&_=${yenilemeAnahtari}`,
    fetcher
  )
  const liste = Array.isArray(data) ? data : []
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">Okunan menüler</CardTitle>
        <Button variant="outline" size="sm" onClick={() => mutate()}>
          <RefreshCw className="mr-2 h-3.5 w-3.5" />Yenile
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {error && <p className="p-4 text-sm text-red-700">Liste alınamadı.</p>}
        {isLoading && !data && <p className="p-4 text-sm text-muted-foreground">Yükleniyor…</p>}
        {data && liste.length === 0 && <p className="p-4 text-sm text-muted-foreground">Henüz menü okunmadı.</p>}
        <ul className="divide-y">
          {liste.map((o) => {
            const ad = o.dosyalar.length > 1 ? `${o.dosyalar[0].fileName} +${o.dosyalar.length - 1}` : o.dosyalar[0]?.fileName ?? o.sessionId
            const hata = o.dosyalar.find((d) => d.status === "FAILED")?.error
            return (
              <li key={o.sessionId}>
                <button
                  type="button"
                  onClick={() => onSec(o.sessionId)}
                  className={`flex w-full flex-wrap items-center justify-between gap-2 px-4 py-2 text-left text-sm transition hover:bg-kobipo-offwhite ${seciliId === o.sessionId ? "bg-kobipo-offwhite" : ""}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{ad}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {o.sayfa} sayfa · {o.kalem} kalem{o.tamMenu ? " · tam menü" : ""}{o.hedef > 0 ? ` · ${o.hedef} kayıt` : ""} · {new Date(o.createdAt).toLocaleString("tr-TR")}
                      {hata ? ` — ${hata}` : ""}
                    </span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${DURUM_STILI[o.status]}`}>{DURUM_ETIKETI[o.status]}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
