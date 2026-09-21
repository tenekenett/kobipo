"use client"

/**
 * Tarama satırı → onay kartları. Türe göre kartı seçer; fiş için MEVCUT
 * FisOnayKarti (plan §2: dokunulmaz), diğerleri belge/ altındaki yeni kartlar.
 *
 * `dosya` yalnız aynı oturumda yüklenen dosya için dolu: "türü değiştir ve
 * yeniden oku" dosyayı yeniden gönderir (dosya saklanmıyor — karar B). Gelen
 * kutusundan açılan satırda dosya yoktur; kart bunu söyler.
 */

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { FisOnayKarti } from "@/components/alis/fis-onay-karti"
import type { TaramaSatiri } from "@/lib/belge-ocr/kayit"
import type { BelgeCikarimi } from "@/lib/belge-ocr/boru"
import { BELGE_TURLERI, BELGE_TURU_ETIKETI, type BelgeTuru } from "@/lib/belge-ocr/turler"
import { FaturaOnayKarti } from "./fatura-onay-karti"
import { IrsaliyeOnayKarti } from "./irsaliye-onay-karti"
import { DekontOnayKarti } from "./dekont-onay-karti"
import { CekOnayKarti } from "./cek-onay-karti"
import { DenetimSeridi, KaydedildiKarti, hedefYaz } from "./kabuk"

export function BelgeKartlari({
  satir,
  companyId,
  dosya,
  onYenidenOku,
}: {
  satir: TaramaSatiri
  companyId: string
  dosya?: File | null
  onYenidenOku?: (tur: BelgeTuru) => void
}) {
  const ext = satir.extraction
  const belgeler: BelgeCikarimi[] = ext?.belgeler ?? []
  const firmaVkn = ext?.firma?.vkn ?? null
  const yol = ext?.yol ?? "gorsel"
  const hedefler = satir.targets ?? []

  if (belgeler.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">Dosyada tanınan belge bulunamadı.</CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {belgeler.map((b, i) => {
        const hedef = hedefler.find((t) => t.index === i)
        if (hedef) {
          return <KaydedildiKarti key={`${satir.id}-${i}`} baslik={`${i + 1}. ${BELGE_TURU_ETIKETI[b.tur]}`} aciklama={`daha önce kaydedildi — ${hedef.no ?? hedef.id} (${new Date(hedef.at).toLocaleString("tr-TR")})`} />
        }
        const key = `${satir.id}-${i}`
        switch (b.tur) {
          case "FIS":
            return (
              <FisOnayKarti
                key={key}
                sonuc={{ fis: b.veri, denetimler: b.denetimler as any }}
                sira={i + 1}
                companyId={companyId}
                onKaydedildi={(k) => void hedefYaz(satir.id, i, "INVOICE", k.id, k.invoiceNo, k.slug)}
              />
            )
          case "FATURA":
            return <FaturaOnayKarti key={key} scanId={satir.id} index={i} sinif={b.sinif} fatura={b.veri} karekod={b.karekod} yol={yol} firmaVkn={firmaVkn} companyId={companyId} />
          case "IRSALIYE":
            return <IrsaliyeOnayKarti key={key} scanId={satir.id} index={i} sinif={b.sinif} irsaliye={b.veri} yol={yol} firmaVkn={firmaVkn} companyId={companyId} />
          case "DEKONT":
            return <DekontOnayKarti key={key} scanId={satir.id} index={i} sinif={b.sinif} dekont={b.veri} yol={yol} companyId={companyId} />
          case "CEK":
          case "SENET":
            return <CekOnayKarti key={key} scanId={satir.id} index={i} sinif={b.sinif} cek={b.veri} yol={yol} firmaVkn={firmaVkn} companyId={companyId} />
          default:
            return <DigerKarti key={key} index={i} belge={b} dosyaVar={!!dosya} onYenidenOku={onYenidenOku} />
        }
      })}
    </div>
  )
}

function DigerKarti({ index, belge, dosyaVar, onYenidenOku }: { index: number; belge: BelgeCikarimi; dosyaVar: boolean; onYenidenOku?: (tur: BelgeTuru) => void }) {
  const [tur, setTur] = useState<BelgeTuru>("FATURA")
  return (
    <Card className="border-amber-400">
      <CardContent className="space-y-3 p-4">
        <div className="text-sm">
          <strong>{index + 1}. Tanınmayan belge</strong>
          {belge.sinif.not && <span className="text-muted-foreground"> — {belge.sinif.not}</span>}
        </div>
        <DenetimSeridi denetimler={belge.denetimler} />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Bu belge aslında şu türde:</span>
          <select value={tur} onChange={(e) => setTur(e.target.value as BelgeTuru)} className="h-9 rounded-md border border-kobipo-border bg-background px-2 text-sm">
            {BELGE_TURLERI.filter((t) => t !== "DIGER").map((t) => (
              <option key={t} value={t}>{BELGE_TURU_ETIKETI[t]}</option>
            ))}
          </select>
          <Button variant="outline" size="sm" disabled={!dosyaVar || !onYenidenOku} onClick={() => onYenidenOku?.(tur)}>
            Bu türle yeniden oku
          </Button>
          {!dosyaVar && <span className="text-xs text-muted-foreground">Dosya saklanmadığı için yeniden okuma yalnız yüklendiği oturumda yapılır; dosyayı yeniden yükleyin.</span>}
        </div>
      </CardContent>
    </Card>
  )
}
