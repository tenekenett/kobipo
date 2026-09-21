/**
 * document_scans (kind=MENU) satırı ↔ boru hattı sonucu ve oturum görünümleri.
 * Saf (Prisma tipi yok): istemci de bu tipleri okur.
 *
 * Bir menü = bir OTURUM = aynı `sessionId`li N satır (dosya başına bir satır).
 * Oturum düzeyi bilgiler (varsayılan KDV, "tamamı mı", hedef izleri) oturumun
 * BAŞ satırında durur: en eski `createdAt`, eşitlikte küçük `id`. Sıra
 * deterministik, satırlar okunduktan sonra değişmez.
 */

import type { MenuBoruSonucu } from "./boru"
import type { MenuHedefi, MenuOkuma, MenuOturumOzeti, OkumaYolu } from "./turler"
import { oturumBirlestir, type OturumDosyasi } from "./tekillestir"

/** `extraction` JSON kolonunun biçimi (kind=MENU) */
export type MenuTaramaCikarimi = {
  yol: OkumaYolu
  sayfalar: MenuOkuma[]
  metinKarakter: number | null
  /** Yükleme anında seçilen oturum oranı — yeni ürünün KDV'si (karar B) */
  varsayilanKdv: number
  /** "Bu yüklenenler menünün TAMAMI" (karar H) */
  tamMenu: boolean
  saglayici: string
  kullanim: MenuBoruSonucu["kullanim"]
}

export function menuSonucunuSatiraCevir(s: MenuBoruSonucu, ayar: { varsayilanKdv: number; tamMenu: boolean }): MenuTaramaCikarimi {
  return {
    yol: s.yol,
    sayfalar: s.sayfalar,
    metinKarakter: s.metinKarakter,
    varsayilanKdv: ayar.varsayilanKdv,
    tamMenu: ayar.tamMenu,
    saglayici: s.saglayici,
    kullanim: s.kullanim,
  }
}

/** Oturum satırlarının ortak alt kümesi — Prisma satırı da, seçili select de uyar. */
export type MenuSatiri = {
  id: string
  sessionId: string | null
  fileName: string
  pageCount: number
  status: string
  extraction: unknown
  targets: unknown
  error: string | null
  costUsd: unknown
  createdAt: Date
  updatedAt: Date
}

export function oturumSirala<T extends Pick<MenuSatiri, "id" | "createdAt">>(satirlar: T[]): T[] {
  return [...satirlar].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/** Oturumun baş satırı — hedef izleri ve oturum ayarları burada. */
export function oturumBasi<T extends Pick<MenuSatiri, "id" | "createdAt">>(satirlar: T[]): T | null {
  return oturumSirala(satirlar)[0] ?? null
}

export function cikarimOku(v: unknown): MenuTaramaCikarimi | null {
  if (!v || typeof v !== "object") return null
  const c = v as Partial<MenuTaramaCikarimi>
  if (!Array.isArray(c.sayfalar)) return null
  return {
    yol: (c.yol as OkumaYolu) ?? "gorsel",
    sayfalar: c.sayfalar,
    metinKarakter: typeof c.metinKarakter === "number" ? c.metinKarakter : null,
    varsayilanKdv: typeof c.varsayilanKdv === "number" ? c.varsayilanKdv : 10,
    tamMenu: c.tamMenu === true,
    saglayici: typeof c.saglayici === "string" ? c.saglayici : "?",
    kullanim: c.kullanim ?? { girdiToken: 0, ciktiToken: 0, dusunmeToken: 0, maliyetUsd: null },
  }
}

export function hedefleriOku(v: unknown): MenuHedefi[] {
  return Array.isArray(v) ? (v as MenuHedefi[]) : []
}

/** Oturumun okunmuş dosyaları → birleştirme girdisi (FAILED/READING satır kalem taşımaz). */
export function oturumDosyalari(satirlar: MenuSatiri[]): OturumDosyasi[] {
  return oturumSirala(satirlar)
    .map((s) => ({ scanId: s.id, dosya: s.fileName, sayfalar: cikarimOku(s.extraction)?.sayfalar ?? [] }))
    .filter((d) => d.sayfalar.length > 0)
}

/**
 * Oturum durumu satırlardan türer: biri okunuyorsa READING; onay bekleyen varsa
 * AWAITING_APPROVAL; hepsi kaydedildiyse SAVED; hepsi reddedildiyse REJECTED;
 * hiç okunan yoksa FAILED.
 */
export function oturumDurumu(satirlar: Array<Pick<MenuSatiri, "status">>): MenuOturumOzeti["status"] {
  const d = new Set(satirlar.map((s) => s.status))
  if (d.has("READING") || d.has("PENDING")) return "READING"
  if (d.has("AWAITING_APPROVAL")) return "AWAITING_APPROVAL"
  if (d.has("SAVED")) return "SAVED"
  if (d.has("REJECTED")) return "REJECTED"
  return "FAILED"
}

export function oturumOzetleri(satirlar: MenuSatiri[]): MenuOturumOzeti[] {
  const gruplar = new Map<string, MenuSatiri[]>()
  for (const s of satirlar) {
    // sessionId'siz satır olmamalı (POST her zaman yazar); olursa kendi başına oturum.
    const k = s.sessionId ?? s.id
    const g = gruplar.get(k)
    if (g) g.push(s)
    else gruplar.set(k, [s])
  }
  const ozetler: MenuOturumOzeti[] = []
  for (const [sessionId, grup] of gruplar) {
    const sirali = oturumSirala(grup)
    const bas = sirali[0]
    const birlesim = oturumBirlestir(oturumDosyalari(sirali))
    const maliyet = sirali.reduce((a, s) => (s.costUsd == null ? a : (a ?? 0) + Number(s.costUsd)), null as number | null)
    ozetler.push({
      sessionId,
      status: oturumDurumu(sirali),
      dosyalar: sirali.map((s) => ({ id: s.id, fileName: s.fileName, status: s.status, error: s.error, pageCount: s.pageCount })),
      sayfa: sirali.reduce((a, s) => a + s.pageCount, 0),
      kalem: birlesim.kalemler.length,
      tamMenu: cikarimOku(bas.extraction)?.tamMenu ?? false,
      hedef: hedefleriOku(bas.targets).filter((h) => !h.geriAlma).length,
      costUsd: maliyet,
      createdAt: bas.createdAt.toISOString(),
      updatedAt: sirali.reduce((a, s) => (s.updatedAt > a ? s.updatedAt : a), bas.updatedAt).toISOString(),
    })
  }
  return ozetler.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
}
