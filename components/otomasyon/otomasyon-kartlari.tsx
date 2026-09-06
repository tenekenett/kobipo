"use client"

import { useState } from "react"
import useSWR from "swr"
import { AlertTriangle } from "lucide-react"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { useWriteGuard } from "@/components/dashboard/write-guard"
import { describeFetchError, jsonFetcher } from "@/lib/swr/fetcher"
import { GOSTERILECEK, type Kart, type KartKarari } from "@/lib/otomasyon/tipler"
import { OtomasyonKarti } from "./otomasyon-karti"

/**
 * Panodaki otomasyon kartları listesi.
 *
 * KART YOKSA HİÇBİR ŞEY BASILMAZ — "her şey yolunda" kutusu bile. Kart zaten
 * koşul oluşmadan çıkmıyor; sağlıklı işletmede bu bölüm görünmez ve pano
 * kalabalıklaşmaz. Boş durum kutusu, bir süre sonra kimsenin okumadığı sabit
 * bir şeride dönerdi.
 *
 * GÖSTERİM BÜTÇESİ: en fazla `GOSTERILECEK` kart basılır, gerisi sayıyla
 * duyurulur. Sıralama sunucudan önem sırasına göre geliyor. Sayı `tipler.ts`te
 * çünkü uç de aynı sayıyı okuyor — günlüğe yalnız EKRANA GİREN kart yazılsın
 * diye (bkz. `GOSTERILECEK` başlığı).
 *
 * HATA SESSİZ GEÇMEZ — "kart yok" ile "kart hesaplanamadı" ayrı şeylerdir ve
 * ikisi de boş ekranla ifade edilemez. Uç `hatalar[]` alanını zaten dolduruyor;
 * burada okunmasaydı çalışmayan bir kart sistemi, sağlıklı bir panodan ayırt
 * edilemezdi (2026-09-06: Prisma istemcisi eskiyince uç 500 dönüyordu, panoda
 * hiçbir iz yoktu). İki ayrı durum var, ikisi de basılır:
 *   - istek düştü          → kart yok, tek satır hata + "Yeniden dene"
 *   - bazı kartlar patladı → çalışanlar basılır, altında hangilerinin
 *                            hesaplanamadığı yazar.
 *
 * "YOK SAY" YAZMA YETKİSİ İSTER. Susturma FİRMA GENELİDİR
 * (`aktifSusturmalar` companyId ile sorar, kullanıcıyla değil): salt-okunur bir
 * çalışanın kapattığı kart, patron için de susardı. Aksiyon düğmeleri serbest —
 * onlar yalnız ilgili ekrana GÖTÜRÜR, kapı orada zaten var.
 */

type Yanit = {
  kartlar: Kart[]
  kapaliAlanlar: string[]
  hatalar: Array<{ kod: string; mesaj: string }>
}

export function OtomasyonKartlari() {
  const { selectedCompanyId } = useDashboardCompany()
  const { canWrite } = useWriteGuard()
  const [kapatilan, setKapatilan] = useState<Set<string>>(new Set())
  const [bekleyen, setBekleyen] = useState<string | null>(null)

  const { data, error, isLoading, mutate } = useSWR<Yanit>(
    selectedCompanyId
      ? `/api/otomasyon/kartlar?companyId=${encodeURIComponent(selectedCompanyId)}`
      : null,
    jsonFetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 }
  )

  const anahtar = (k: Kart) => `${k.kod}|${k.ozneId}`

  /**
   * Kararı günlüğe yazar ve kartı ekrandan kaldırır.
   *
   * Kart ÖNCE kapatılır, sunucu cevabı beklenmez: karar zaten geri alınabilir
   * bir şey değil ve kullanıcıyı ağ turu boyunca bekletmenin karşılığı yok.
   * Yazma başarısız olursa kaybedilen şey bir veri noktasıdır (bkz.
   * `lib/otomasyon/gunluk.ts`), kullanıcının akışı değil.
   */
  async function kararVer(kart: Kart, karar: KartKarari, aksiyon?: string) {
    // Salt-okunur yetkide karar YAZILMAZ: kararın yan etkisi firma geneli
    // susturmadır. Kullanıcı aksiyon linkine yine gidebilir.
    if (!canWrite) return
    setKapatilan((o) => new Set(o).add(anahtar(kart)))
    setBekleyen(anahtar(kart))
    try {
      await fetch("/api/otomasyon/kartlar/karar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: selectedCompanyId,
          kod: kart.kod,
          ozneId: kart.ozneId,
          karar,
          aksiyon: aksiyon ?? null,
        }),
      })
    } catch {
      // Sessiz: kart zaten kapandı, kullanıcıya gösterilecek bir şey yok.
    } finally {
      setBekleyen(null)
      mutate()
    }
  }

  const kartlar = (data?.kartlar ?? []).filter((k) => !kapatilan.has(anahtar(k)))
  const hatalar = data?.hatalar ?? []

  // İstek düştü: gösterilecek kart YOK ama söylenecek bir şey var. Yükleme
  // sürerken basılmaz — SWR yeniden denerken hata bir an görünüp kaybolurdu.
  if (error && !isLoading) {
    const { message } = describeFetchError(error, "Otomasyon kartları")
    return (
      <section className="space-y-2" aria-label="Otomasyon kartları">
        <h2 className="text-sm font-semibold">Bugün dikkatinizi çeken</h2>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs dark:border-amber-900/50 dark:bg-amber-950/25">
          <AlertTriangle className="h-4 w-4 shrink-0 opacity-70" />
          <span className="min-w-0 flex-1">{message}</span>
          <button
            type="button"
            onClick={() => mutate()}
            className="font-medium underline-offset-2 hover:underline"
          >
            Yeniden dene
          </button>
        </div>
      </section>
    )
  }

  // Kart da yok, hata da yok → koşul oluşmamış; hiçbir şey basılmaz.
  if (kartlar.length === 0 && hatalar.length === 0) return null

  const gorunen = kartlar.slice(0, GOSTERILECEK)
  const gizli = kartlar.length - gorunen.length

  return (
    <section className="space-y-2" aria-label="Otomasyon kartları">
      <h2 className="text-sm font-semibold">Bugün dikkatinizi çeken</h2>
      {gorunen.map((k) => (
        <OtomasyonKarti
          key={anahtar(k)}
          kart={k}
          bekliyor={bekleyen === anahtar(k)}
          yokSayilabilir={canWrite}
          onAksiyon={(aksiyonAnahtari) => kararVer(k, "ACTED", aksiyonAnahtari)}
          onYokSay={() => kararVer(k, "DISMISSED")}
        />
      ))}
      {gizli > 0 && (
        <p className="text-xs text-muted-foreground">
          +{gizli} konu daha var; en önemli {GOSTERILECEK} tanesi gösteriliyor.
        </p>
      )}
      {hatalar.length > 0 && (
        // Kartın KODU yazılır, hata metni değil: kullanıcıya yığın izi göstermek
        // bir şey anlatmaz, ama "bir konu hesaplanamadı" bilgisi "sorun yok"tan
        // ayırt edilebilir olmalı. Ayrıntı sunucu günlüğünde.
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {hatalar.length} konu hesaplanamadı ({hatalar.map((h) => h.kod).join(", ")}) — bu
          başlıklarda bugün uyarı çıkmayabilir.
        </p>
      )}
    </section>
  )
}
