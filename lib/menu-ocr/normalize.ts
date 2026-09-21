/**
 * Model çıktısı → MenuOkuma. Saf. Sağlayıcı strict şemayı yok sayabilir (fişte
 * ölçüldü); her alan tek tek güvenli tipe indirilir.
 *
 * Fiyatsız / sıfır fiyatlı satır KALEM DEĞİLDİR (başlık ürün sanılmış, §3.7):
 * atılır ama sayısı `fiyatsizSatir`a yazılır ki denetim "n satır atıldı" desin.
 */

import type { MenuFiyat, MenuKalem, MenuOkuma } from "./turler"

const metin = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ") : null

/** "120,50" / "1.250" / "₺120" — model şemaya uymayıp dize dönerse de sayı çıkar. */
export function fiyatSayisi(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  if (typeof v !== "string") return null
  // "120.-" ve "120,-" gibi kuruşsuz yazımlar: sondaki ayraç/tire düşer.
  const s = v.replace(/[^\d,.\-]/g, "").replace(/[^\d]+$/, "")
  if (!s) return null
  const tr = s.includes(",")
    ? s.replace(/\./g, "").replace(",", ".")
    : s.replace(/\.(?=\d{3}(\D|$))/g, "")
  const n = Number(tr)
  return Number.isFinite(n) ? n : null
}

const guven01 = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0

export function paraBirimiNormalize(v: unknown): string | null {
  const s = metin(v)?.toUpperCase() ?? ""
  if (!s) return null
  if (/TRY|TL|₺/.test(s)) return "TRY"
  if (/USD|\$/.test(s)) return "USD"
  if (/EUR|€/.test(s)) return "EUR"
  return /^[A-Z]{3}$/.test(s) ? s : null
}

function fiyatlarNormalize(v: unknown): MenuFiyat[] {
  if (!Array.isArray(v)) return []
  const out: MenuFiyat[] = []
  for (const f of v) {
    // Düz sayı dizisi de kabul: [90, 110]
    const nesne = f && typeof f === "object" ? (f as Record<string, unknown>) : null
    const fiyat = fiyatSayisi(nesne ? nesne.fiyat : f)
    if (fiyat == null || fiyat <= 0) continue
    out.push({ etiket: nesne ? metin(nesne.etiket) : null, fiyat: Math.round(fiyat * 100) / 100 })
  }
  return out
}

export function menuNormalize(ham: unknown, sayfa: number): MenuOkuma {
  const h = (ham && typeof ham === "object" && !Array.isArray(ham) ? ham : {}) as Record<string, unknown>
  // Model şemayı yok sayıp düz dizi dönerse onu kalem listesi say.
  const hamKalemler: unknown[] = Array.isArray(ham) ? ham : Array.isArray(h.kalemler) ? h.kalemler : []
  const kalemler: MenuKalem[] = []
  let fiyatsizSatir = 0
  for (const k of hamKalemler) {
    const kk = (k && typeof k === "object" ? k : {}) as Record<string, unknown>
    const ad = metin(kk.ad)
    if (!ad) continue
    const fiyatlar = fiyatlarNormalize(kk.fiyatlar ?? (kk.fiyat != null ? [kk.fiyat] : []))
    if (fiyatlar.length === 0) {
      fiyatsizSatir++
      continue
    }
    kalemler.push({ ad, aciklama: metin(kk.aciklama), bolum: metin(kk.bolum), fiyatlar, sayfa })
  }
  const g = (h.guven && typeof h.guven === "object" ? h.guven : {}) as Record<string, unknown>
  return {
    bolumler: (Array.isArray(h.bolumler) ? h.bolumler : []).map(metin).filter((b): b is string => Boolean(b)),
    kalemler,
    kdvNotu: metin(h.kdvNotu),
    paraBirimi: paraBirimiNormalize(h.paraBirimi),
    guven: { kalemler: guven01(g.kalemler), fiyatlar: guven01(g.fiyatlar), bolumler: guven01(g.bolumler) },
    fiyatsizSatir,
  }
}
