/**
 * Dekont denetimleri — saf. IBAN mod-97, tutar, tarih, "bizim hesap mı".
 */

import type { Denetim } from "../turler"
import { DEKONT_ISLEM_TURLERI, type Dekont } from "./schema"

const sayi = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null)

export const ibanSade = (v: string | null | undefined) => (v ?? "").replace(/\s+/g, "").toUpperCase()

/** ISO 13616 mod-97 denetimi — TR IBAN 26 karakter. */
export function ibanGecerliMi(iban: string | null | undefined): boolean {
  const s = ibanSade(iban)
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false
  if (s.startsWith("TR") && s.length !== 26) return false
  const donmus = s.slice(4) + s.slice(0, 4)
  let kalan = 0
  for (const ch of donmus) {
    const d = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55)
    for (const c of d) kalan = (kalan * 10 + Number(c)) % 97
  }
  return kalan === 1
}

export function islemTuruNormalize(v: unknown): (typeof DEKONT_ISLEM_TURLERI)[number] {
  const s = String(v ?? "").toUpperCase().replace(/[^A-Z]/g, "")
  return (DEKONT_ISLEM_TURLERI as readonly string[]).includes(s) ? (s as any) : "DIGER"
}

export type DekontYonu = "TAHSILAT" | "ODEME" | "BELIRSIZ"

/** Bizim IBAN listesine göre yön: alıcı bizsek TAHSİLAT, gönderen bizsek ÖDEME. */
export function dekontYonu(d: Dekont, bizimIbanlar: string[]): DekontYonu {
  const biz = new Set(bizimIbanlar.map(ibanSade).filter(Boolean))
  if (biz.size === 0) return "BELIRSIZ"
  if (biz.has(ibanSade(d.aliciIban))) return "TAHSILAT"
  if (biz.has(ibanSade(d.gonderenIban))) return "ODEME"
  return "BELIRSIZ"
}

export function dekontDenetle(d: Dekont, b: { bizimIbanlar: string[]; bugun?: Date }): Denetim[] {
  const s: Denetim[] = []
  const bugun = b.bugun ?? new Date()

  const t = sayi(d.tutar)
  s.push({ anahtar: "tutar", etiket: "Tutar", durum: t == null ? "olcelemedi" : t > 0 ? "gecti" : "patladi", aciklama: t == null ? "Tutar okunamadı" : t > 0 ? t.toFixed(2) : "Tutar 0 veya negatif" })

  for (const [anahtar, etiket, iban] of [["gonderenIban", "Gönderen IBAN", d.gonderenIban], ["aliciIban", "Alıcı IBAN", d.aliciIban]] as const) {
    if (!iban) s.push({ anahtar, etiket, durum: "olcelemedi", aciklama: "IBAN okunamadı" })
    else s.push({ anahtar, etiket, durum: ibanGecerliMi(iban) ? "gecti" : "patladi", aciklama: ibanGecerliMi(iban) ? ibanSade(iban) : `Mod-97 tutmuyor: ${ibanSade(iban)}` })
  }

  const yon = dekontYonu(d, b.bizimIbanlar)
  s.push({
    anahtar: "hesap",
    etiket: "Bizim hesap",
    durum: b.bizimIbanlar.length === 0 ? "olcelemedi" : yon === "BELIRSIZ" ? "patladi" : "gecti",
    aciklama:
      b.bizimIbanlar.length === 0
        ? "Kasa/banka kartlarında IBAN kayıtlı değil"
        : yon === "TAHSILAT"
          ? "Para bizim hesaba geldi (tahsilat)"
          : yon === "ODEME"
            ? "Para bizim hesaptan çıktı (ödeme)"
            : "İki IBAN da bizim hesaplarımızdan değil",
  })

  const tarih = d.islemTarihi
  if (!tarih || !/^\d{4}-\d{2}-\d{2}/.test(tarih)) s.push({ anahtar: "tarih", etiket: "Tarih", durum: tarih ? "patladi" : "olcelemedi", aciklama: tarih ? `YYYY-MM-DD değil: ${tarih}` : "Tarih okunamadı" })
  else {
    const dt = new Date(tarih.slice(0, 10) + "T00:00:00Z")
    const g = !Number.isNaN(dt.getTime()) && dt <= new Date(bugun.getTime() + 86400000)
    s.push({ anahtar: "tarih", etiket: "Tarih", durum: g ? "gecti" : "patladi", aciklama: g ? tarih.slice(0, 10) : `Gelecek tarih: ${tarih}` })
  }
  return s
}

export function dekontInsanaSorulmali(d: Denetim[], x: Dekont): boolean {
  if (d.some((y) => y.durum === "patladi")) return true
  const g = x.guven
  return !g || Math.min(g.taraflar, g.tarih, g.tutar) < 0.8
}
