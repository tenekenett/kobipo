/**
 * AYLIK KDV MAHSUBU — ay sonunda hesaplanan KDV (391) ile indirilecek KDV'nin (191)
 * kapatılması. Saf modül; uygulama `kdv-mahsup.server.ts`, ekran `/muhasebe/kdv`.
 *
 *   X = 391'in alacak bakiyesi (satışlarda hesaplanan KDV)
 *   Y = 191'in borç bakiyesi  (alışlarda indirilecek KDV)
 *   D = 190'ın borç bakiyesi  (önceki aydan devreden KDV)
 *
 *   X ≥ Y + D → B 391 X · A 191 Y · A 190 D · A 360 (X − Y − D)   ödenecek KDV
 *   X < Y + D → B 391 X · A 191 Y · 190'a net (Y + D − X) − D     yeni devreden
 *
 * Bakiyeler ay SONUNDAKİ birikmiş bakiyedir (önceki aylar mahsup edildiyse yalnız bu
 * ayınki kalır); 391/191'in alt hesapları (oran başına 391.01 …) yaprak yaprak
 * kapatılır. Sorumlu sıfatıyla ödenecek KDV (tevkifat, KDV-2) zaten 360'tadır ve
 * mahsuba girmez — beyanname de öyle.
 *
 * Fiş yalnız YAPRAK hesaba yazılır: 360 ya da 190 alt hesaplıysa hangi alt hesaba
 * yazılacağını kullanıcı seçer (müşavirlerin çoğu 360.01 KDV, 360.02 Muhtasar diye
 * ayırır); seçilmediyse plan hata döner.
 */

import { r2 } from "@/lib/muhasebe/fis"

export type YaprakBakiye = { kod: string; bakiye: number } // borç − alacak

export type MahsupSatiri = { taraf: "B" | "A"; kod: string; tutar: number; aciklama: string }

export type KdvMahsupPlani = {
  ay: string
  /** 391 alacak bakiyesi. */
  hesaplanan: number
  /** 191 borç bakiyesi. */
  indirilecek: number
  /** Önceki aydan devreden (190, mahsuptan önce). */
  devredenOnceki: number
  /** Bu ay ödenecek KDV (360'a); devredense 0. */
  odenecek: number
  /** Sonraki aya devreden KDV (mahsuptan sonra 190); ödenecekse 0. */
  devredenSonraki: number
  satirlar: MahsupSatiri[]
  hatalar: string[]
}

export function kdvMahsupPlani(g: {
  ay: string
  /** 391 yaprakları. */
  hesaplanan: YaprakBakiye[]
  /** 191 yaprakları. */
  indirilecek: YaprakBakiye[]
  /** 190'ın (devreden KDV) mahsup öncesi bakiyesi — bütün yaprakların toplamı. */
  devreden: number
  /** Ödenecek KDV'nin yazılacağı yaprak (360 ya da seçilen alt hesabı); yoksa null. */
  odenecekHesabi: string | null
  /** Devreden KDV'nin yazılacağı yaprak (190 ya da seçilen alt hesabı); yoksa null. */
  devredenHesabi: string | null
}): KdvMahsupPlani {
  const satirlar: MahsupSatiri[] = []
  const hatalar: string[] = []
  // 391 alacak bakiyelidir: kapatmak için BORÇ. Ters bakiyeli yaprak (iade fazlası) alacağa.
  for (const h of g.hesaplanan) {
    const v = r2(h.bakiye)
    if (v === 0) continue
    satirlar.push({ taraf: v < 0 ? "B" : "A", kod: h.kod, tutar: Math.abs(v), aciklama: "Hesaplanan KDV kapatıldı" })
  }
  for (const h of g.indirilecek) {
    const v = r2(h.bakiye)
    if (v === 0) continue
    satirlar.push({ taraf: v > 0 ? "A" : "B", kod: h.kod, tutar: Math.abs(v), aciklama: "İndirilecek KDV kapatıldı" })
  }
  const X = r2(-g.hesaplanan.reduce((a, h) => a + h.bakiye, 0))
  const Y = r2(g.indirilecek.reduce((a, h) => a + h.bakiye, 0))
  const D = r2(g.devreden)
  const fark = r2(X - Y - D)
  let odenecek = 0
  let devredenSonraki = 0
  if (fark > 0) {
    odenecek = fark
    if (D !== 0) {
      if (!g.devredenHesabi) hatalar.push("Devreden KDV (190) alt hesaplı; kullanılacak alt hesabı seçin.")
      else satirlar.push({ taraf: D > 0 ? "A" : "B", kod: g.devredenHesabi, tutar: Math.abs(D), aciklama: "Önceki aydan devreden KDV kullanıldı" })
    }
    if (!g.odenecekHesabi) hatalar.push("Ödenecek vergi hesabı (360) alt hesaplı; ödenecek KDV'nin yazılacağı alt hesabı seçin.")
    else satirlar.push({ taraf: "A", kod: g.odenecekHesabi, tutar: fark, aciklama: "Ödenecek KDV" })
  } else {
    devredenSonraki = r2(-fark)
    const degisim = r2(devredenSonraki - D)
    if (degisim !== 0) {
      if (!g.devredenHesabi) hatalar.push("Devreden KDV (190) alt hesaplı; devreden KDV'nin yazılacağı alt hesabı seçin.")
      else
        satirlar.push({
          taraf: degisim > 0 ? "B" : "A",
          kod: g.devredenHesabi,
          tutar: Math.abs(degisim),
          aciklama: degisim > 0 ? "Sonraki aya devreden KDV" : "Önceki aydan devreden KDV kullanıldı",
        })
    }
  }
  if (satirlar.length === 0 && hatalar.length === 0) hatalar.push("Bu ay kapatılacak KDV bakiyesi yok.")
  const borc = r2(satirlar.filter((s) => s.taraf === "B").reduce((a, s) => a + s.tutar, 0))
  const alacak = r2(satirlar.filter((s) => s.taraf === "A").reduce((a, s) => a + s.tutar, 0))
  if (hatalar.length === 0 && borc !== alacak) hatalar.push(`Mahsup fişi dengesiz (borç ${borc} ≠ alacak ${alacak}).`)
  return { ay: g.ay, hesaplanan: X, indirilecek: Y, devredenOnceki: D, odenecek, devredenSonraki, satirlar, hatalar }
}

/** "2026-09" → ayın ilk ve son günü (00:00 UTC). */
export function ayAraligi(ay: string): { bas: Date; son: Date } {
  const [y, m] = ay.split("-").map(Number)
  return { bas: new Date(Date.UTC(y, m - 1, 1)), son: new Date(Date.UTC(y, m, 0)) }
}

/** Başlangıç ayından (dahil) `sonAy`a (dahil) "YYYY-AA" listesi. */
export function aylar(baslangic: Date, sonAy: string): string[] {
  const liste: string[] = []
  let y = baslangic.getUTCFullYear()
  let m = baslangic.getUTCMonth() + 1
  const [sy, sm] = sonAy.split("-").map(Number)
  while (y < sy || (y === sy && m <= sm)) {
    liste.push(`${y}-${String(m).padStart(2, "0")}`)
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return liste
}

/** İstanbul takvimiyle bir önceki ay ("YYYY-AA") — mahsup yalnız biten aylar için yapılır. */
export function gecenAy(simdi: Date = new Date()): string {
  const t = new Date(simdi.getTime() + 3 * 3_600_000)
  const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() - 1, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}
