/**
 * HESAP PLANI KURALLARI — alt hesap numaralama ve düzey. Saf modül (Prisma yok).
 *
 * Kod biçimi (karar 2026-10-02, SIRALI):
 *   1 · 12 · 120          Tekdüzen sınıf / grup / defteri kebir (lib/muhasebe/tekduzen.ts)
 *   120.01                kayıt grubu ("Cari Hesaplar") — otomatik açılır
 *   120.01.0001           kaydın alt hesabı: "<cari adı> — <VKN>"
 *   120.01.0000           kayıtsız ortak alt hesap (perakende müşteri, carisiz alış)
 *
 * Kullanıcının elle açtığı alt hesaplar da aynı biçimdedir: üst hesap + "." + 1–4
 * hane (ör. 600.01, 770.01.001). Fişe yalnız YAPRAK (altı olmayan) hesap yazılır.
 */

import { hesapTuru, type HesapTuru } from "@/lib/muhasebe/tekduzen"
import type { AltHesapRef } from "@/lib/muhasebe/fis"

/** Kayıt türü → alt hesabın açıldığı defteri kebir hesabı. */
export function altHesapAnaKodu(ref: Pick<AltHesapRef, "tur" | "altTur">): string {
  switch (ref.tur) {
    case "musteri":
      return "120"
    case "tedarikci":
      return "320"
    case "personel":
      return "335"
    case "finans":
      // Kredi kartı kanalı bir BORÇTUR (harcama bakiyeyi eksiye çeker): 309 Diğer Mali Borçlar.
      if (ref.altTur === "CASH") return "100"
      if (ref.altTur === "CREDIT_CARD") return "309"
      return "102"
  }
}

/** Kayıt grubunun adı (120.01 …). */
export function altHesapGrupAdi(ref: Pick<AltHesapRef, "tur" | "altTur">): string {
  switch (ref.tur) {
    case "musteri":
      return "Müşteri Cari Hesapları"
    case "tedarikci":
      return "Tedarikçi Cari Hesapları"
    case "personel":
      return "Personel Hesapları"
    case "finans":
      if (ref.altTur === "CASH") return "Kasalar"
      if (ref.altTur === "CREDIT_CARD") return "Kredi Kartları"
      return "Banka Hesapları"
  }
}

export const GRUP_EKI = "01"
export const ORTAK_EK = "0000"

export const grupKodu = (ana: string) => `${ana}.${GRUP_EKI}`
export const ortakAltKod = (ana: string) => `${ana}.${GRUP_EKI}.${ORTAK_EK}`

/**
 * Grup altındaki sıradaki kayıt numarası: en büyük 4 haneli numara + 1 (0000 ortak
 * hesap sayılmaz). Silinmiş/boşta kalan numara yeniden VERİLMEZ — eski fişlerdeki
 * hesap koduyla yeni bir carinin kodu karışmasın.
 */
export function sonrakiAltKod(ana: string, mevcutKodlar: Iterable<string>): string {
  const onek = `${grupKodu(ana)}.`
  let max = 0
  for (const kod of mevcutKodlar) {
    if (!kod.startsWith(onek)) continue
    const ek = kod.slice(onek.length)
    if (!/^\d{4}$/.test(ek)) continue
    max = Math.max(max, Number(ek))
  }
  if (max >= 9999) throw new Error(`${grupKodu(ana)} altında boş numara kalmadı`)
  return `${onek}${String(max + 1).padStart(4, "0")}`
}

/**
 * Hesabın düzeyi: 1 sınıf, 2 grup, 3 defteri kebir, sonrası her nokta bir düzey
 * (120.01 → 4, 120.01.0001 → 5).
 */
export function hesapDuzeyi(kod: string): number {
  const parca = kod.split(".")
  if (parca.length === 1) return Math.min(parca[0].length, 3)
  return 3 + parca.length - 1
}

/** Üst hesap: "120.01.0001" → "120.01", "120.01" → "120", "120" → "12", "1" → null. */
export function ustHesapKodu(kod: string): string | null {
  const nokta = kod.lastIndexOf(".")
  if (nokta >= 0) return kod.slice(0, nokta)
  return kod.length > 1 ? kod.slice(0, -1) : null
}

/** Defteri kebir kodu (ilk üç hane): "120.01.0001" → "120". Sınıf/grupta kendisi. */
export function kebirKodu(kod: string): string {
  return kod.split(".")[0]
}

/** Hesabın türü kebir kodundan (alt hesap üstünün türünü taşır). */
export function hesapTuruKoddan(kod: string): HesapTuru {
  return hesapTuru(kebirKodu(kod))
}

/**
 * Elle açılan alt hesap kodu geçerli mi: üst hesabın kodu + "." + 1–4 hane.
 * Yalnız defteri kebir (3 hane) ve altı alt hesap alabilir; sınıf/grup alamaz.
 */
export function altKodHatasi(ustKod: string, yeniKod: string): string | null {
  if (!/^\d{3}(\.\d{1,4})*$/.test(ustKod)) return "Alt hesap yalnız defteri kebir hesabının (3 hane) ya da onun alt hesabının altına açılır."
  if (!yeniKod.startsWith(`${ustKod}.`)) return `Kod ${ustKod}. ile başlamalı.`
  const ek = yeniKod.slice(ustKod.length + 1)
  if (!/^\d{1,4}$/.test(ek)) return "Alt hesap eki 1–4 rakam olmalı (ör. 01 ya da 0001)."
  if (hesapDuzeyi(yeniKod) > 7) return "En fazla 4 alt düzey açılabilir."
  return null
}

/** Elle alt hesap açarken önerilen kod: üst hesabın doğrudan çocuklarına göre sıradaki. */
export function onerilenAltKod(ustKod: string, kardesKodlar: Iterable<string>): string {
  const onek = `${ustKod}.`
  let genislik = 2
  let max = 0
  for (const kod of kardesKodlar) {
    if (!kod.startsWith(onek)) continue
    const ek = kod.slice(onek.length)
    if (!/^\d{1,4}$/.test(ek)) continue
    genislik = Math.max(genislik, ek.length)
    max = Math.max(max, Number(ek))
  }
  return `${onek}${String(max + 1).padStart(genislik, "0")}`
}

/** Cari alt hesabının adı: "<ad> — <VKN/TCKN>" (VKN yoksa yalnız ad). */
export function altHesapAdi(ad: string, vkn?: string | null): string {
  const temiz = ad.trim() || "Adsız"
  const v = (vkn ?? "").trim()
  return (v ? `${temiz} — ${v}` : temiz).slice(0, 190)
}

/** Alt hesap referansının sözlük anahtarı. */
export function altAnahtar(ref: Pick<AltHesapRef, "tur" | "id" | "altTur">): string {
  return ref.tur === "finans" ? `finans:${ref.id ?? "-"}` : `${ref.tur}:${ref.id ?? "-"}`
}
