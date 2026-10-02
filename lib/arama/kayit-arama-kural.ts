/**
 * GENEL KAYIT ARAMASI — saf kurallar (Prisma yok, testli).
 *
 * Üst çubuktaki arama kutusu menü sayfalarının yanında KAYIT da bulur: cari,
 * belge numarası, ürün, teklif, çek/senet, personel. Sorgu `kayit-arama.ts`te,
 * uç `app/api/arama`.
 *
 * YETKİ: bir kayıt ancak kullanıcı onu AÇABİLİYORSA listelenir. İki soru
 * birden sorulur: kaydın LİSTE sayfası (rol + kısıt + modül; ör. alış faturası
 * için `/alis/fatura`) ve gideceği DETAY sayfası (`canAccessRoute`). Yalnız
 * detaya bakmak yetmez: fatura önizlemesinin sahibi satış VE alış listesidir,
 * yalnız alışı gören kullanıcı satış faturası numarasını bulmamalı. Cari
 * görünürlüğü (kısıtlı çalışan yalnız kendi carisini görür) sorguda uygulanır.
 */

import { canAccessRoute, type PagePermissions } from "@/lib/page-access"
import { moduleKeyForPath } from "@/lib/nav/pages"
import { trFold } from "@/lib/text/tr-fold"

/** Bundan kısa terimle kayıt aranmaz: "a" her tabloda her satırı bulur. */
export const EN_AZ_KARAKTER = 2
/** Terim tavanı — daha uzunu bir belge no ya da ad değildir. */
export const EN_FAZLA_KARAKTER = 80
/** Grup başına gösterilen sonuç. */
export const GRUP_BASINA = 5

export type KayitTuru = "cari" | "belge" | "urun" | "teklif" | "cek-senet" | "personel"

/** Grupların ekrandaki sırası ve adı. */
export const GRUPLAR: Array<{ tur: KayitTuru; etiket: string }> = [
  { tur: "cari", etiket: "Cariler" },
  { tur: "belge", etiket: "Faturalar ve fişler" },
  { tur: "urun", etiket: "Ürün ve hizmetler" },
  { tur: "teklif", etiket: "Teklifler" },
  { tur: "cek-senet", etiket: "Çek ve senetler" },
  { tur: "personel", etiket: "Personel" },
]

export type AramaSonucu = {
  tur: KayitTuru
  id: string
  baslik: string
  /** Tek satırlık açıklama: tür · cari · tarih · tutar. */
  alt: string
  /** Detay sayfası — ÇIPLAK yol; `?company=` istemcide eklenir (withCompanyHref). */
  href: string
  /** Küçük rozet: "Arşivde", "Pasif", "Ayrıldı". */
  rozet?: string
}

export type AramaGrubu = { tur: KayitTuru; etiket: string; sonuclar: AramaSonucu[] }

/** Ham sorgu dizgesi → aranacak terim; aranmayacaksa null. */
export function aramaTerimi(ham: unknown): string | null {
  if (typeof ham !== "string") return null
  const terim = ham.replace(/\s+/g, " ").trim().slice(0, EN_FAZLA_KARAKTER)
  return trFold(terim).length >= EN_AZ_KARAKTER ? terim : null
}

/** Kayıt bu kullanıcıya açık mı: liste sayfası (rol + kısıt + modül) VE detay sayfası. */
export function kayitAcikMi(
  perms: PagePermissions,
  disabledModules: readonly string[],
  hedef: { liste: string; path: string },
): boolean {
  const modul = moduleKeyForPath(hedef.liste)
  if (modul && disabledModules.includes(modul)) return false
  return canAccessRoute(perms, hedef.liste) && canAccessRoute(perms, hedef.path)
}

export type BelgeKaydi = {
  id: string
  type: string
  returnKind: string | null
  isReceipt: boolean
}

/**
 * Belgenin gideceği sayfa, sahibi olan liste ve türünün adı. Fiş fatura
 * önizlemesinde açılmaz ("Satış Faturası" başlığıyla görünürdü — bkz.
 * `BelgeLink`); iade kendi ailesinin listesindedir.
 */
export function belgeHedefi(b: BelgeKaydi): { path: string; liste: string; turAdi: string } {
  const tip = String(b.type || "").toUpperCase()
  const iade = tip === "RETURN"
  const alis = tip === "PURCHASE" || (iade && String(b.returnKind || "").toUpperCase() === "PURCHASE")
  if (b.isReceipt) {
    return {
      path: `/fisler/${b.id}`,
      liste: alis ? "/alis/fisler" : "/satis/fisler",
      turAdi: alis ? "Alış fişi" : "Satış fişi",
    }
  }
  return {
    path: `/faturalar/${b.id}/onizleme`,
    liste: alis ? "/alis/fatura" : "/satis/fatura",
    turAdi: iade ? (alis ? "Alış iadesi" : "Satış iadesi") : alis ? "Alış faturası" : "Satış faturası",
  }
}

/** Tutar: TL'de "₺1.234,50", dövizde "1.234,50 USD". */
export function tutarMetni(tutar: unknown, paraBirimi?: string | null): string {
  const n = Number(tutar)
  if (!Number.isFinite(n)) return ""
  const metin = n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const pb = (paraBirimi || "TRY").toUpperCase()
  return pb === "TRY" ? `₺${metin}` : `${metin} ${pb}`
}

/** Gün: İstanbul takvimiyle "12.09.2026". */
export function gunMetni(tarih: Date | string | null | undefined): string {
  if (!tarih) return ""
  const d = new Date(tarih)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" })
}

/** Boş parçaları atıp " · " ile birleştirir. */
export function altSatir(...parcalar: Array<string | null | undefined | false>): string {
  return parcalar.filter((p): p is string => Boolean(p && p.trim())).join(" · ")
}
