"use client"

/**
 * Gelen kutusu — document_scans listesi. Okunmuş ama onaylanmamış belge
 * kaybolmaz: satıra tıklayınca kartlar açılır. Dosya SAKLANMADIĞI için
 * kutudan açılan kayıtta "yeniden oku" yoktur (kart bunu söyler).
 */

import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { TaramaOzeti } from "@/lib/belge-ocr/kayit"
import { BELGE_TURU_ETIKETI, TARAMA_DURUMU_ETIKETI, YON_ETIKETI, type TaramaDurumu } from "@/lib/belge-ocr/turler"
import { tl } from "./kabuk"
import { RefreshCw } from "lucide-react"

const fetcher = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error("liste alınamadı"))))

const DURUM_STILI: Record<TaramaDurumu, string> = {
  PENDING: "bg-kobipo-offwhite text-kobipo-gray",
  READING: "bg-kobipo-blue/10 text-kobipo-blue",
  AWAITING_APPROVAL: "bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200",
  SAVED: "bg-kobipo-green-light text-kobipo-green-dark",
  REJECTED: "bg-kobipo-offwhite text-kobipo-gray",
  FAILED: "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300",
}

export function GelenKutusu({ companyId, seciliId, onSec, yenilemeAnahtari }: { companyId: string; seciliId: string | null; onSec: (id: string) => void; yenilemeAnahtari: number }) {
  const { data, error, isLoading, mutate } = useSWR<TaramaOzeti[]>(
    `/api/alis/belge-tarama?companyId=${encodeURIComponent(companyId)}&_=${yenilemeAnahtari}`,
    fetcher
  )
  const liste = Array.isArray(data) ? data : []
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">Gelen kutusu</CardTitle>
        <Button variant="outline" size="sm" onClick={() => mutate()}>
          <RefreshCw className="mr-2 h-3.5 w-3.5" />Yenile
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        {error && <p className="p-4 text-sm text-red-700">Liste alınamadı.</p>}
        {isLoading && !data && <p className="p-4 text-sm text-muted-foreground">Yükleniyor…</p>}
        {data && liste.length === 0 && <p className="p-4 text-sm text-muted-foreground">Henüz belge okunmadı.</p>}
        <ul className="divide-y">
          {liste.map((s) => {
            const ilk = s.belgeler[0]
            const ek = s.belgeler.length > 1 ? ` +${s.belgeler.length - 1}` : ""
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onSec(s.id)}
                  className={`flex w-full flex-wrap items-center justify-between gap-2 px-4 py-2 text-left text-sm transition hover:bg-kobipo-offwhite ${seciliId === s.id ? "bg-kobipo-offwhite" : ""}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {ilk ? `${BELGE_TURU_ETIKETI[ilk.tur]}${ek} · ${ilk.duzenleyenUnvan || ilk.muhatapUnvan || s.fileName}` : s.fileName}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {ilk?.belgeNo ? `${ilk.belgeNo} · ` : ""}
                      {ilk?.tarih ? `${ilk.tarih} · ` : ""}
                      {ilk?.yon && ilk.yon !== "BELIRSIZ" ? `${YON_ETIKETI[ilk.yon]} · ` : ""}
                      {ilk?.toplam != null ? `${tl(ilk.toplam)} · ` : ""}
                      {new Date(s.createdAt).toLocaleString("tr-TR")}
                      {s.status === "FAILED" && s.error ? ` — ${s.error}` : ""}
                    </span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${DURUM_STILI[s.status] ?? ""}`}>{TARAMA_DURUMU_ETIKETI[s.status] ?? s.status}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
