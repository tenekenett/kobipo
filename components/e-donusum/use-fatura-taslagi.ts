"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Yeni fatura formunun TARAYICIDA korunan taslağı.
 *
 * Sekme kapanır, oturum düşer ya da kullanıcı yanlışlıkla geri tuşuna basarsa
 * yarım fatura kaybolmasın. Veri yalnız bu tarayıcının `localStorage`ında
 * durur; sunucuya gitmez, başka cihazda görünmez.
 *
 * ── Kurallar ────────────────────────────────────────────────────────────────
 * 1. GERİ YÜKLEME OTOMATİK DEĞİL. Açılışta taslak varsa ekran şeritle sorar
 *    ("geri yükle / sil"). Sessizce doldurmak, kullanıcının fark etmediği bir
 *    faturayı kesmesine yol açardı.
 * 2. TEKLİF BEKLERKEN YAZILMAZ. Kullanıcı şeridi yok sayıp yeni bir fatura
 *    doldurursa eski taslağın üstüne yazılmaz; karar verilince kayıt başlar.
 * 3. BOŞ FORM TASLAK DEĞİLDİR. `kirli` false iken saklı taslak silinir (form
 *    elle boşaltıldıysa eski taslak geri gelmemeli).
 * 4. KAYIT BAŞARILI OLUNCA SİLİNİR (`temizle`) ve o form için yazma durur.
 * 5. `etkin` false iken (düzenleme, kopyadan/irsaliyeden/gelen e-faturadan
 *    gelen form) hiçbir şey okunmaz ve yazılmaz: o formlar başka bir kaynaktan
 *    doluyor, üstlerine taslak teklif etmek kafa karıştırırdı.
 */

const SURUM = 1
/** Bundan eski taslak teklif edilmez, silinir. */
const OMUR_MS = 14 * 24 * 60 * 60 * 1000
const BEKLEME_MS = 800

type Kayit<T> = { v: number; savedAt: string; data: T }

function oku<T>(anahtar: string): Kayit<T> | null {
  try {
    const ham = window.localStorage.getItem(anahtar)
    if (!ham) return null
    const k = JSON.parse(ham) as Kayit<T>
    if (!k || k.v !== SURUM || !k.savedAt || k.data == null) return null
    if (Date.now() - new Date(k.savedAt).getTime() > OMUR_MS) {
      window.localStorage.removeItem(anahtar)
      return null
    }
    return k
  } catch {
    return null
  }
}

function sil(anahtar: string) {
  try {
    window.localStorage.removeItem(anahtar)
  } catch {
    /* depolama kapalı (gizli pencere) — taslak zaten yok */
  }
}

export function useFaturaTaslagi<T>({
  etkin,
  anahtar,
  veri,
  kirli,
  geriYukleyici,
}: {
  etkin: boolean
  anahtar: string
  /** Saklanacak form durumu. JSON'a çevrilebilir olmalı. */
  veri: T
  /** Formda saklamaya değer bir şey var mı. */
  kirli: boolean
  /** Geri yükle'ye basılınca form durumunu kurar. */
  geriYukleyici: (data: T) => void
}) {
  const [teklif, setTeklif] = useState<{ savedAt: string } | null>(null)
  const teklifVeri = useRef<T | null>(null)
  // Karar verilmeden (teklif varken) yazma yok — kural 2.
  const kararVerildi = useRef(false)
  // Kayıt tamamlandıktan sonra form sıfırlanırken yeniden yazılmasın — kural 4.
  const kapandi = useRef(false)
  const sonYazilan = useRef<string | null>(null)

  useEffect(() => {
    if (!etkin) return
    const k = oku<T>(anahtar)
    if (k) {
      teklifVeri.current = k.data
      setTeklif({ savedAt: k.savedAt })
    } else {
      kararVerildi.current = true
    }
  }, [etkin, anahtar])

  const metin = JSON.stringify(veri)

  useEffect(() => {
    if (!etkin || !kararVerildi.current || kapandi.current) return
    const t = window.setTimeout(() => {
      if (!kirli) {
        sil(anahtar)
        sonYazilan.current = null
        return
      }
      if (sonYazilan.current === metin) return
      try {
        const kayit: Kayit<unknown> = { v: SURUM, savedAt: new Date().toISOString(), data: JSON.parse(metin) }
        window.localStorage.setItem(anahtar, JSON.stringify(kayit))
        sonYazilan.current = metin
      } catch {
        /* kota dolu ya da depolama kapalı — taslak tutulamıyor, form çalışmaya devam eder */
      }
    }, BEKLEME_MS)
    return () => window.clearTimeout(t)
  }, [etkin, anahtar, metin, kirli, teklif])

  const geriYukle = useCallback(() => {
    const data = teklifVeri.current
    teklifVeri.current = null
    setTeklif(null)
    kararVerildi.current = true
    if (data != null) geriYukleyici(data)
  }, [geriYukleyici])

  const vazgec = useCallback(() => {
    teklifVeri.current = null
    setTeklif(null)
    kararVerildi.current = true
    sil(anahtar)
  }, [anahtar])

  /** Fatura kaydedildi: taslağı sil ve bu form için yazmayı durdur. */
  const temizle = useCallback(() => {
    kapandi.current = true
    sil(anahtar)
  }, [anahtar])

  return { teklif, geriYukle, vazgec, temizle }
}
