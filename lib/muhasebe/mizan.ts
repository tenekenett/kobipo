/**
 * MİZAN — hesap başına borç/alacak toplamları, alt hesaptan sınıfa kadar toplanmış.
 * Saf modül; satırlar `defter-sorgu.server.ts`ten gelir.
 *
 * Sütunlar: devir (dönem başından önceki), dönem içi, toplam ve bakiye. Bir alt
 * hesabın hareketi bütün üstlerine eklenir (120.01.0001 → 120.01 → 120 → 12 → 1).
 * Doğrulama: aynı düzeydeki satırların borç toplamı = alacak toplamı (çift taraflı
 * kayıt). Ekran bu eşitliği yazar; tutmuyorsa fişlerde değil sorguda hata vardır.
 */

import { r2 } from "@/lib/muhasebe/fis"
import { hesapDuzeyi, ustHesapKodu } from "@/lib/muhasebe/hesap-plani"
import { normalBakiye, tekduzenHesabi } from "@/lib/muhasebe/tekduzen"
import { hesapTuruKoddan } from "@/lib/muhasebe/hesap-plani"

export type MizanHareketi = {
  /** Fişin yazıldığı hesabın kodu (yaprak). */
  kod: string
  devirBorc: number
  devirAlacak: number
  donemBorc: number
  donemAlacak: number
}

export type MizanSatiri = {
  kod: string
  ad: string
  duzey: number
  devirBorc: number
  devirAlacak: number
  donemBorc: number
  donemAlacak: number
  toplamBorc: number
  toplamAlacak: number
  /** Borç bakiyesi (borç > alacak ise fark), değilse 0. */
  bakiyeBorc: number
  bakiyeAlacak: number
  /** Bakiye hesabın normal yönünün TERSİNDE mi (ör. kasada alacak bakiyesi). */
  tersBakiye: boolean
}

export function mizanKur(
  hareketler: MizanHareketi[],
  adlar: ReadonlyMap<string, string>,
): MizanSatiri[] {
  const toplam = new Map<string, Omit<MizanHareketi, "kod">>()
  for (const h of hareketler) {
    let kod: string | null = h.kod
    while (kod) {
      const t = toplam.get(kod) ?? { devirBorc: 0, devirAlacak: 0, donemBorc: 0, donemAlacak: 0 }
      t.devirBorc += h.devirBorc
      t.devirAlacak += h.devirAlacak
      t.donemBorc += h.donemBorc
      t.donemAlacak += h.donemAlacak
      toplam.set(kod, t)
      kod = ustHesapKodu(kod)
    }
  }
  const satirlar: MizanSatiri[] = []
  for (const [kod, t] of toplam) {
    const toplamBorc = r2(t.devirBorc + t.donemBorc)
    const toplamAlacak = r2(t.devirAlacak + t.donemAlacak)
    const fark = r2(toplamBorc - toplamAlacak)
    const kebir = tekduzenHesabi(kod.split(".")[0])
    const normal = kebir ? normalBakiye(kebir) : normalBakiye({ tur: hesapTuruKoddan(kod), ters: false })
    satirlar.push({
      kod,
      ad: adlar.get(kod) ?? kebir?.ad ?? kod,
      duzey: hesapDuzeyi(kod),
      devirBorc: r2(t.devirBorc),
      devirAlacak: r2(t.devirAlacak),
      donemBorc: r2(t.donemBorc),
      donemAlacak: r2(t.donemAlacak),
      toplamBorc,
      toplamAlacak,
      bakiyeBorc: fark > 0 ? fark : 0,
      bakiyeAlacak: fark < 0 ? -fark : 0,
      tersBakiye: fark !== 0 && (fark > 0 ? normal === "A" : normal === "B"),
    })
  }
  return satirlar.sort((a, b) => kodKarsilastir(a.kod, b.kod))
}

/** Hesap kodu sırası: "1" < "10" < "100" < "100.01" < "100.01.0001" < "101". */
export function kodKarsilastir(a: string, b: string): number {
  const pa = a.split(".")
  const pb = b.split(".")
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1
    if (pb[i] === undefined) return 1
    if (i === 0) {
      // İlk parça önek sıralı: "1" < "10" < "100" < "101" < "11".
      if (pa[0] !== pb[0]) return pa[0] < pb[0] ? -1 : 1
    } else if (pa[i] !== pb[i]) {
      return Number(pa[i]) - Number(pb[i]) || (pa[i] < pb[i] ? -1 : 1)
    }
  }
  return 0
}

/** Düzey süzgeci: `duzey` verilirse yalnız o düzey; "detay" 3 ve altı. */
export function mizanDuzeyi(satirlar: MizanSatiri[], duzey: number | "detay"): MizanSatiri[] {
  if (duzey === "detay") return satirlar.filter((s) => s.duzey >= 3)
  return satirlar.filter((s) => s.duzey === duzey)
}

/** Seçili düzeyin dip toplamı — borç = alacak olmalı. */
export function mizanToplami(satirlar: MizanSatiri[], duzey: number) {
  const ayni = satirlar.filter((s) => s.duzey === duzey)
  const t = (f: keyof MizanSatiri) => r2(ayni.reduce((a, s) => a + (s[f] as number), 0))
  return {
    devirBorc: t("devirBorc"),
    devirAlacak: t("devirAlacak"),
    donemBorc: t("donemBorc"),
    donemAlacak: t("donemAlacak"),
    toplamBorc: t("toplamBorc"),
    toplamAlacak: t("toplamAlacak"),
    bakiyeBorc: t("bakiyeBorc"),
    bakiyeAlacak: t("bakiyeAlacak"),
  }
}
