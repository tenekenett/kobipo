/**
 * GİB karekodu — e-Fatura / e-Arşiv / e-SMM belgelerinin 1. sayfasındaki JSON.
 *
 * SAF: karekodun HAM metnini alır (jsQR çözümü girdi/pdf.ts'te), yapılandırır.
 * İstemcide de çalışır (onay kartı "karekoddan geldi" rozetini buradan kurar).
 *
 * ALAN ADLARI GİB "e-Fatura / e-Arşiv Karekod Standardı" kılavuzundan yazıldı ve
 * 2026-09-21 itibarıyla gerçek bir e-Arşiv PDF'inde ÖLÇÜLMEDİ (korpus yok —
 * plan §9). Bu yüzden:
 *   • tanınmayan her anahtar `diger`e olduğu gibi yazılır, atılmaz;
 *   • oran bazlı anahtarlar (`kdvmatrah(20)`, `hesaplanankdv(20)`) desenle
 *     yakalanır, oran sabit listeden değil anahtardan okunur;
 *   • sayılar hem "1234.56" hem "1.234,56" biçiminde kabul edilir.
 * İlk gerçek PDF'te sapma çıkarsa düzeltme TEK yerde: bu dosya + testi.
 *
 * Karekod JSON DEĞİLSE (bazı entegratörler doğrulama URL'si basıyor) tür "URL"
 * ya da "BILINMEYEN" döner; model o zaman başlığı da kendisi okur.
 */

export type KarekodKdv = { oran: number; matrah: number | null; kdv: number | null }

export type GibKarekodu = {
  tur: "GIB"
  /** Satıcı (düzenleyen) VKN/TCKN */
  saticiVkn: string | null
  /** Alıcı VKN/TCKN */
  aliciVkn: string | null
  /** TEMELFATURA, TICARIFATURA, EARSIVFATURA, IHRACAT, ... */
  senaryo: string | null
  /** SATIS, IADE, TEVKIFAT, ISTISNA, ... */
  tip: string | null
  tarih: string | null
  belgeNo: string | null
  ettn: string | null
  paraBirimi: string | null
  malHizmetToplam: number | null
  kdvKirilimi: KarekodKdv[]
  vergiDahil: number | null
  odenecek: number | null
  /** Tanınmayan anahtarlar, olduğu gibi */
  diger: Record<string, unknown>
}

export type Karekod =
  | GibKarekodu
  | { tur: "URL"; url: string }
  | { tur: "BILINMEYEN"; ham: string }

const sayi = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  if (typeof v !== "string") return null
  const s = v.trim()
  if (!s) return null
  // "1.234,56" -> 1234.56 ; "1234.56" -> 1234.56 ; "1234,56" -> 1234.56
  const tr = /^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s) || /^-?\d+,\d+$/.test(s)
  const n = Number(tr ? s.replace(/\./g, "").replace(",", ".") : s)
  return Number.isFinite(n) ? n : null
}
const metin = (v: unknown): string | null => {
  if (v == null) return null
  const s = String(v).trim()
  return s ? s : null
}
const rakam = (v: unknown): string | null => {
  const s = metin(v)
  if (!s) return null
  const r = s.replace(/\D/g, "")
  return r || null
}

const ORAN_DESENI = /^(kdvmatrah|hesaplanankdv)\((\d+(?:[.,]\d+)?)\)$/i

const BILINEN = new Set([
  "vkntckn",
  "avkntckn",
  "senaryo",
  "tip",
  "tarih",
  "no",
  "ettn",
  "parabirimi",
  "malhizmettoplam",
  "vergidahil",
  "odenecek",
])

export function karekodCoz(ham: string | null | undefined): Karekod | null {
  if (!ham) return null
  const s = ham.trim()
  if (!s) return null
  if (/^https?:\/\//i.test(s)) return { tur: "URL", url: s }

  let obj: Record<string, unknown>
  try {
    const p = JSON.parse(s)
    if (!p || typeof p !== "object" || Array.isArray(p)) return { tur: "BILINMEYEN", ham: s }
    obj = p
  } catch {
    return { tur: "BILINMEYEN", ham: s }
  }

  // Anahtarlar küçük harfe indirilir: kılavuz küçük yazıyor ama entegratörler
  // "VknTckn" gibi varyantlar basabilir; ASCII olduğu için toLowerCase güvenli.
  const k = new Map<string, unknown>()
  for (const [ad, deger] of Object.entries(obj)) k.set(ad.toLowerCase().replace(/\s+/g, ""), deger)

  const kdv = new Map<number, KarekodKdv>()
  const diger: Record<string, unknown> = {}
  for (const [ad, deger] of k) {
    const m = ad.match(ORAN_DESENI)
    if (m) {
      const oran = Number(m[2].replace(",", "."))
      const kayit = kdv.get(oran) ?? { oran, matrah: null, kdv: null }
      if (m[1].toLowerCase() === "kdvmatrah") kayit.matrah = sayi(deger)
      else kayit.kdv = sayi(deger)
      kdv.set(oran, kayit)
    } else if (!BILINEN.has(ad)) {
      diger[ad] = deger
    }
  }

  return {
    tur: "GIB",
    saticiVkn: rakam(k.get("vkntckn")),
    aliciVkn: rakam(k.get("avkntckn")),
    senaryo: metin(k.get("senaryo"))?.toUpperCase() ?? null,
    tip: metin(k.get("tip"))?.toUpperCase() ?? null,
    tarih: metin(k.get("tarih")),
    belgeNo: metin(k.get("no")),
    ettn: metin(k.get("ettn"))?.toLowerCase() ?? null,
    paraBirimi: metin(k.get("parabirimi"))?.toUpperCase() ?? null,
    malHizmetToplam: sayi(k.get("malhizmettoplam")),
    kdvKirilimi: [...kdv.values()].sort((a, b) => a.oran - b.oran),
    vergiDahil: sayi(k.get("vergidahil")),
    odenecek: sayi(k.get("odenecek")),
    diger,
  }
}

/** Karekod bir GİB belgesini mi anlatıyor (başlık alanları oradan alınabilir mi)? */
export function gibKarekoduMu(k: Karekod | null | undefined): k is GibKarekodu {
  return !!k && k.tur === "GIB" && (!!k.belgeNo || !!k.ettn) && !!k.saticiVkn
}
