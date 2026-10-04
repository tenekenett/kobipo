/**
 * FİŞ SATIRI → FİRMANIN HESABI. Saf modül; veritabanı okuması `senkron.server.ts`te.
 *
 * Sıra (ilk tutan kazanır):
 *   1. KULLANICI  taslakta elle seçilmiş hesap — yeniden üretimde korunur (USER)
 *   2. ALT HESAP  cari / kasa / personel satırı → o kaydın alt hesabı (CARI)
 *   3. KURAL      motorun önerdiği kod: öğrenilmiş (LEARNED) ya da varsayılan (DEFAULT)
 *   4. YOK        hesapsız (NONE) — fiş onaylanamaz
 *
 * Yalnız AKTİF ve YAPRAK (altı olmayan) hesaba yazılır. Varsayılan 600'ün altında
 * 600.01 açılmışsa satır hesapsız kalır: hangi alt hesap olduğunu motor bilemez,
 * ana hesaba yazmak ise mizanı alt kırılımsız bırakırdı.
 */

import { TAHMIN_ROLLERI, type FisSatiri, type HazirFis } from "@/lib/muhasebe/fis"
import { altAnahtar } from "@/lib/muhasebe/hesap-plani"

export type HesapKaynagiDb = "USER" | "CARI" | "LEARNED" | "DEFAULT" | "NONE"

export type PlanKaydi = { id: string; kod: string; aktif: boolean; yaprak: boolean }

export type CozulmusSatir = FisSatiri & {
  accountId: string | null
  accountSource: HesapKaynagiDb
}

/** Taslakta kullanıcının seçtiği hesabı yeniden üretimde bulmak için satırın kimliği. */
export function satirAnahtari(s: Pick<FisSatiri, "rol" | "taraf" | "aciklama" | "anahtarlar">): string {
  return `${s.rol}|${s.taraf}|${s.aciklama}|${[...s.anahtarlar].sort().join(",")}`
}

const kullanilabilir = (h: PlanKaydi | undefined): h is PlanKaydi => Boolean(h && h.aktif && h.yaprak)

/** Satır toplu onaya engel mi (hesapsız ya da tahmin olan varsayılan). */
export function cozulmusEminMi(s: Pick<CozulmusSatir, "accountId" | "accountSource" | "rol">): boolean {
  if (!s.accountId) return false
  return !(s.accountSource === "DEFAULT" && TAHMIN_ROLLERI.has(s.rol))
}

export function satirlariCoz(
  satirlar: FisSatiri[],
  ctx: {
    /** Firmanın planı, koda göre. */
    plan: ReadonlyMap<string, PlanKaydi>
    /** Alt hesaplar, `altAnahtar` ile. */
    alt: ReadonlyMap<string, PlanKaydi>
    /** Önceki taslakta elle seçilmiş hesaplar, `satirAnahtari` ile. */
    kullanici?: ReadonlyMap<string, PlanKaydi>
  },
): { satirlar: CozulmusSatir[]; emin: boolean } {
  const sonuc = satirlar.map((s): CozulmusSatir => {
    const elle = ctx.kullanici?.get(satirAnahtari(s))
    if (kullanilabilir(elle)) return { ...s, hesapKodu: elle.kod, accountId: elle.id, accountSource: "USER" }

    if (s.alt) {
      const alt = ctx.alt.get(altAnahtar(s.alt))
      if (kullanilabilir(alt)) return { ...s, hesapKodu: alt.kod, accountId: alt.id, accountSource: "CARI" }
      return { ...s, hesapKodu: null, accountId: null, accountSource: "NONE" }
    }

    if (s.hesapKodu) {
      const h = ctx.plan.get(s.hesapKodu)
      if (kullanilabilir(h)) {
        return { ...s, accountId: h.id, accountSource: s.kaynak === "ogrenilen" ? "LEARNED" : "DEFAULT" }
      }
      // Öğrenilmiş hesap pasife alınmış/alt hesap açılmışsa varsayılana düşmek yerine
      // hesapsız kalır: varsayılan zaten bir kez reddedilmişti.
    }
    return { ...s, hesapKodu: null, accountId: null, accountSource: "NONE" }
  })
  return { satirlar: sonuc, emin: sonuc.every(cozulmusEminMi) }
}

/**
 * Kaynağın PARMAK İZİ — fişe giren alanların özeti. Hesap kodu ve kaynağı İZE
 * GİRMEZ: yeni bir eşleşme öğrenilmesi belgenin değiştiği anlamına gelmez.
 */
export function parmakIzi(fis: HazirFis): string {
  const govde = {
    t: fis.tarih.toISOString().slice(0, 10),
    a: fis.aciklama,
    k: fis.tur,
    s: fis.satirlar.map((s) => [
      s.taraf,
      s.tutar.toFixed(2),
      s.rol,
      s.oneriKodu,
      [...s.anahtarlar].sort(),
      s.aciklama,
      s.alt ? altAnahtar(s.alt) : null,
    ]),
  }
  return ozet(JSON.stringify(govde))
}

/**
 * Kısa, kararlı özet (iki tohumlu 53 bit — cyrb53). Kriptografik DEĞİL; amaç
 * "kaynak değişti mi" sorusudur. `node:crypto` kullanılmadı: modül istemcide de okunur.
 */
function ozet(str: string): string {
  const tur = (tohum: number) => {
    let h1 = 0xdeadbeef ^ tohum
    let h2 = 0x41c6ce57 ^ tohum
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i)
      h1 = Math.imul(h1 ^ ch, 2654435761)
      h2 = Math.imul(h2 ^ ch, 1597334677)
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0")
  }
  return tur(0) + tur(0x9e3779b9)
}
