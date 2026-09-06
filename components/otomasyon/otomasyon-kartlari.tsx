"use client"

import { useState } from "react"
import useSWR from "swr"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { useWriteGuard } from "@/components/dashboard/write-guard"
import { jsonFetcher } from "@/lib/swr/fetcher"
import type { Kart, KartKarari } from "@/lib/otomasyon/tipler"
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
 * duyurulur. Sıralama sunucudan önem sırasına göre geliyor.
 *
 * "YOK SAY" YAZMA YETKİSİ İSTER. Susturma FİRMA GENELİDİR
 * (`aktifSusturmalar` companyId ile sorar, kullanıcıyla değil): salt-okunur bir
 * çalışanın kapattığı kart, patron için de susardı. Aksiyon düğmeleri serbest —
 * onlar yalnız ilgili ekrana GÖTÜRÜR, kapı orada zaten var.
 */

const GOSTERILECEK = 3

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

  const { data, mutate } = useSWR<Yanit>(
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
  if (kartlar.length === 0) return null

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
    </section>
  )
}
