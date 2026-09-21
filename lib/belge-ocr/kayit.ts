/**
 * document_scans satırı ↔ boru hattı sonucu. Saf (Prisma tipi yok): istemci
 * `TaramaSatiri`/`TaramaOzeti` tiplerini buradan okur.
 */

import type { BoruSonucu, BelgeCikarimi } from "./boru"
import type { NormalBelge } from "./sinif/normalize"
import type { Karekod } from "./girdi/karekod"
import type { HedefTuru, OkumaYolu, TaramaDurumu } from "./turler"

/** `extraction` JSON kolonunun biçimi */
export type TaramaCikarimi = {
  /** Okuma anındaki firma kimliği (şubede ana firmanın VKN'si) — kart denetimleri bununla yeniden koşar */
  firma: { vkn: string | null; unvan: string | null }
  yol: OkumaYolu
  belgeler: BelgeCikarimi[]
  karekod: Karekod | null
  karekodNotu: string | null
  xmlEkAdi: string | null
  metinKarakter: number | null
  saglayici: string
  kullanim: BoruSonucu["kullanim"]
}

/** `targets` JSON kolonunun elemanı — dosyadaki i. belge şu kayda dönüştü */
export type TaramaHedefi = { index: number; type: HedefTuru; id: string; no: string | null; slug?: string | null; at: string }

export type TaramaSatiri = {
  id: string
  companyId: string
  fileName: string
  mimeType: string
  pageCount: number
  status: TaramaDurumu
  classification: NormalBelge[] | null
  extraction: TaramaCikarimi | null
  error: string | null
  targets: TaramaHedefi[] | null
  model: string | null
  costUsd: number | null
  durationMs: number | null
  createdAt: string
  updatedAt: string
}

export function taramaSonucunuSatiraCevir(s: BoruSonucu, firma: { vkn: string | null; unvan: string | null }): { classification: NormalBelge[]; extraction: TaramaCikarimi } {
  return {
    classification: s.belgeler.map((b) => b.sinif),
    extraction: {
      firma,
      yol: s.yol,
      belgeler: s.belgeler,
      karekod: s.karekod,
      karekodNotu: s.karekodNotu,
      xmlEkAdi: s.xmlEkAdi,
      metinKarakter: s.metinKarakter,
      saglayici: s.saglayici,
      kullanim: s.kullanim,
    },
  }
}

export type TaramaOzeti = {
  id: string
  fileName: string
  mimeType: string
  pageCount: number
  status: TaramaDurumu
  error: string | null
  belgeler: Array<Pick<NormalBelge, "tur" | "yon" | "belgeNo" | "tarih" | "toplam" | "duzenleyenUnvan" | "muhatapUnvan">>
  targets: TaramaHedefi[]
  costUsd: number | null
  durationMs: number | null
  createdAt: string
  updatedAt: string
}

/** Liste satırı: JSON kolonlarından yalnız listede gereken alanlar. */
export function taramaOzeti(row: {
  id: string
  fileName: string
  mimeType: string
  pageCount: number
  status: string
  classification: unknown
  targets: unknown
  error: string | null
  costUsd: unknown
  durationMs: number | null
  createdAt: Date
  updatedAt: Date
}): TaramaOzeti {
  const sinif = Array.isArray(row.classification) ? (row.classification as NormalBelge[]) : []
  return {
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    pageCount: row.pageCount,
    status: row.status as TaramaDurumu,
    error: row.error,
    belgeler: sinif.map((b) => ({
      tur: b.tur,
      yon: b.yon,
      belgeNo: b.belgeNo,
      tarih: b.tarih,
      toplam: b.toplam,
      duzenleyenUnvan: b.duzenleyenUnvan,
      muhatapUnvan: b.muhatapUnvan,
    })),
    targets: Array.isArray(row.targets) ? (row.targets as TaramaHedefi[]) : [],
    costUsd: row.costUsd == null ? null : Number(row.costUsd),
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Tüm belgeler hedefe bağlandı mı (DIGER olanlar sayılmaz) */
export function tumBelgelerKaydedildiMi(sinif: NormalBelge[], targets: TaramaHedefi[]): boolean {
  const kaydedilen = new Set(targets.map((t) => t.index))
  return sinif.every((b, i) => b.tur === "DIGER" || kaydedilen.has(i))
}
