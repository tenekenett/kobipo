/**
 * Sınıflandırıcı çıktısını kümeye zorlar ve YÖNÜ türetir. SAF — istemci de çağırır
 * (kartta tür/yön değiştirilince aynı kural koşar).
 */

import { trFold } from "@/lib/text/tr-fold"
import { BELGE_TURLERI, type BelgeTuru, type Yon } from "../turler"
import type { SinifBelgesi } from "./schema"

export type Firma = {
  /** Firmanın VKN/TCKN'si; şubede ana firmanın numarası (bkz. plan §3.7) */
  vkn: string | null | undefined
  unvan: string | null | undefined
}

const rakam = (v: unknown) => String(v ?? "").replace(/\D/g, "")

/** Küme dışı tür → DIGER; büyük/küçük harf ve Türkçe karakter farkı yok sayılır. */
export function turNormalize(ham: unknown): BelgeTuru {
  const s = trFold(String(ham ?? "")).replace(/[^a-z]/g, "")
  const bul = BELGE_TURLERI.find((t) => trFold(t) === s)
  return bul ?? "DIGER"
}

/**
 * Ünvan karşılaştırması: VKN yoksa (çek, dekont, kâğıt belge) tek ipucu ad.
 * Katlanmış (trFold) metinde "içerir" ilişkisi — "REYPO BİLİŞİM A.Ş." ile
 * "Reypo Bilisim Anonim Sirketi" birbirini içermez ama ilk iki kelime tutar;
 * bu yüzden ilk 2 anlamlı kelime karşılaştırılır. Yanlış pozitif riski var,
 * o yüzden ad eşleşmesi VKN eşleşmesinden ZAYIF sayılır (güven düşer).
 */
export function unvanEslesiyorMu(a: string | null | undefined, b: string | null | undefined): boolean {
  const kelime = (s: string | null | undefined) =>
    trFold(s ?? "")
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((k) => k.length >= 3 && !["ltd", "sti", "as", "anonim", "limited", "sirketi", "tic", "san", "ve"].includes(k))
  const ka = kelime(a)
  const kb = kelime(b)
  if (ka.length === 0 || kb.length === 0) return false
  const n = Math.min(2, ka.length, kb.length)
  for (let i = 0; i < n; i++) if (ka[i] !== kb[i]) return false
  return true
}

export type YonKarari = {
  yon: Yon
  /** vkn: kesin · unvan: zayıf · yok: belirsiz */
  dayanak: "vkn" | "unvan" | "yok"
  /** Belge bu firmaya ait görünmüyor: iki taraf da firma değil (VKN'ler okunmuş ama tutmuyor) */
  yabanci: boolean
}

export function yonBul(b: Pick<SinifBelgesi, "duzenleyenVknTckn" | "duzenleyenUnvan" | "muhatapVknTckn" | "muhatapUnvan">, firma: Firma): YonKarari {
  const fv = rakam(firma.vkn)
  const dv = rakam(b.duzenleyenVknTckn)
  const mv = rakam(b.muhatapVknTckn)
  if (fv) {
    if (dv && dv === fv) return { yon: "SATIS", dayanak: "vkn", yabanci: false }
    if (mv && mv === fv) return { yon: "ALIS", dayanak: "vkn", yabanci: false }
  }
  if (unvanEslesiyorMu(b.duzenleyenUnvan, firma.unvan)) return { yon: "SATIS", dayanak: "unvan", yabanci: false }
  if (unvanEslesiyorMu(b.muhatapUnvan, firma.unvan)) return { yon: "ALIS", dayanak: "unvan", yabanci: false }
  // İki VKN de okunmuş ve ikisi de biz değilsek belge başka firmanın.
  const yabanci = !!fv && !!dv && !!mv && dv !== fv && mv !== fv
  return { yon: "BELIRSIZ", dayanak: "yok", yabanci }
}

export type NormalBelge = Omit<SinifBelgesi, "tur"> & {
  tur: BelgeTuru
  yon: Yon
  yonDayanagi: YonKarari["dayanak"]
  yabanci: boolean
}

/** Ham sınıflandırıcı çıktısı → küme içi tür + yön. Boş/bozuk nesneler DIGER olur, atılmaz. */
export function sinifNormalize(ham: any, firma: Firma): NormalBelge[] {
  const liste: any[] = Array.isArray(ham) ? ham : Array.isArray(ham?.belgeler) ? ham.belgeler : ham ? [ham] : []
  return liste.map((b) => {
    const belge: SinifBelgesi = {
      tur: String(b?.tur ?? ""),
      sayfalar: Array.isArray(b?.sayfalar)
        ? b.sayfalar.map((n: unknown) => Number(n)).filter((n: number) => Number.isInteger(n) && n >= 1)
        : [],
      duzenleyenUnvan: b?.duzenleyenUnvan ?? null,
      duzenleyenVknTckn: rakam(b?.duzenleyenVknTckn) || null,
      muhatapUnvan: b?.muhatapUnvan ?? null,
      muhatapVknTckn: rakam(b?.muhatapVknTckn) || null,
      belgeNo: b?.belgeNo ?? null,
      tarih: typeof b?.tarih === "string" ? b.tarih.slice(0, 10) : null,
      toplam: typeof b?.toplam === "number" && Number.isFinite(b.toplam) ? b.toplam : null,
      guven: typeof b?.guven === "number" ? Math.max(0, Math.min(1, b.guven)) : 0,
      not: b?.not ?? null,
    }
    const y = yonBul(belge, firma)
    return {
      ...belge,
      tur: turNormalize(belge.tur),
      sayfalar: belge.sayfalar.length ? belge.sayfalar : [1],
      yon: y.yon,
      yonDayanagi: y.dayanak,
      yabanci: y.yabanci,
    }
  })
}
