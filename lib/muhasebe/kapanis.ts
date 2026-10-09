/**
 * DÖNEM KAPANIŞI — yıl sonu kapanış fişlerinin PLANI. Saf modül; uygulama
 * `kapanis.server.ts`.
 *
 * Sıra (her adım bir öncekinin bakiyeleri üzerinde kurulur):
 *   1. smm             Satılan malın maliyeti (aralıklı envanter): 153 bakiyesi − sayım
 *                      tutarı → B 621 · A 153. Sayım tutarı verilmezse adım atlanır.
 *   2. yansitma        7/A: 7. sınıf hesapları karşılığı 6. sınıf hesabına aktarılır
 *                      (770 → 632, 740 → 622, 760 → 631, 780 → 660, 71–73 → 620).
 *   3. gelir-kapanis   6. sınıfın bütün hesapları (690 hariç) 690'a kapanır.
 *   4. kar             690 → 590 Dönem Net Kârı ya da 591 Dönem Net Zararı.
 *   5. bilanco-kapanis 31 Aralık: bilanço hesapları (1–5. sınıf) sıfırlanır.
 *   6. acilis          1 Ocak (ertesi yıl): aynı bakiyeler yeniden açılır.
 *
 * Kapanış fişleri doğrudan ONAYLI yazılır (kullanıcı kapanışı açıkça başlatır) ve
 * dönem kilitlenir. Kâr dağıtımı (590 → 570/540…) genel kurul kararıdır, elle fişle.
 * Dönem vergi karşılığı (691/370) kapanıştan ÖNCE elle girilirse 3. adım 691'i de
 * 690'a kapatır ve 590'a vergi sonrası kâr geçer.
 *
 * Fiş yalnız YAPRAK hesaplara yazılır: hedef hesap (621, 632, 690, 590…) alt hesaplıysa
 * plan hata döner, kapanış yapılmaz.
 */

import { r2, type FisTuru } from "@/lib/muhasebe/fis"
import type { MizanSatiri } from "@/lib/muhasebe/mizan"
import { yansimaHesabi } from "@/lib/muhasebe/mali-tablolar"

export type KapanisSatiri = { taraf: "B" | "A"; tutar: number; kod: string; aciklama: string }
export type KapanisFisi = {
  anahtar: "smm" | "yansitma" | "gelir-kapanis" | "kar" | "bilanco-kapanis" | "acilis"
  aciklama: string
  tarih: Date
  tur: FisTuru
  satirlar: KapanisSatiri[]
}

export const KAPANIS_ADIMLARI = ["smm", "yansitma", "gelir-kapanis", "kar", "bilanco-kapanis", "acilis"] as const

export function kapanisPlani(g: {
  yil: number
  /** Yıl sonuna kadar (dahil) bütün onaylı fişlerin mizanı, tüm düzeyler. */
  mizan: MizanSatiri[]
  /** 153 Ticari Mallar için yıl sonu sayım tutarı (TL); verilmezse SMM adımı yok. */
  kapanisStoku?: number | null
}): { fisler: KapanisFisi[]; netKar: number; hatalar: string[]; uyarilar: string[] } {
  const hatalar: string[] = []
  const uyarilar: string[] = []
  const yilSonu = new Date(Date.UTC(g.yil, 11, 31))
  const yeniYil = new Date(Date.UTC(g.yil + 1, 0, 1))

  // Yaprak bakiyeler (borç − alacak) — adımlar ilerledikçe güncellenir.
  const kodlar = g.mizan.map((s) => s.kod)
  const yaprak = new Map<string, number>()
  for (const s of g.mizan) {
    if (s.duzey < 3) continue
    if (kodlar.some((k) => k.startsWith(`${s.kod}.`))) continue
    const v = r2(s.bakiyeBorc - s.bakiyeAlacak)
    if (v !== 0) yaprak.set(s.kod, v)
  }
  const altHesapliMi = (kod: string) => kodlar.some((k) => k.startsWith(`${kod}.`))
  const uygula = (fis: KapanisFisi) => {
    for (const s of fis.satirlar) yaprak.set(s.kod, r2((yaprak.get(s.kod) ?? 0) + (s.taraf === "B" ? s.tutar : -s.tutar)))
  }
  /** Bakiyeyi sıfırlayan satır: borç bakiyesine alacak, alacak bakiyesine borç. */
  const kapat = (kod: string, v: number, aciklama: string): KapanisSatiri => ({
    taraf: v > 0 ? "A" : "B",
    tutar: Math.abs(v),
    kod,
    aciklama,
  })
  const hedefKontrol = (kod: string) => {
    if (altHesapliMi(kod)) hatalar.push(`${kod} alt hesaplı; kapanış fişi ana hesaba yazamaz — kapanıştan önce kapanış hesabını sadeleştirin.`)
  }
  const fisler: KapanisFisi[] = []

  // 1. Satılan malın maliyeti.
  if (g.kapanisStoku != null) {
    const stok = r2(g.kapanisStoku)
    if (altHesapliMi("153")) {
      uyarilar.push("153 Ticari Mallar alt hesaplı: satılan malın maliyeti fişini elle girin.")
    } else {
      const bakiye = yaprak.get("153") ?? 0
      const smm = r2(bakiye - stok)
      if (smm !== 0) {
        hedefKontrol("621")
        const fis: KapanisFisi = {
          anahtar: "smm",
          aciklama: `${g.yil} satılan ticari mal maliyeti (sayım: ${stok.toFixed(2)})`,
          tarih: yilSonu,
          tur: "MAHSUP",
          satirlar:
            smm > 0
              ? [
                  { taraf: "B", tutar: smm, kod: "621", aciklama: "Satılan ticari mallar maliyeti" },
                  { taraf: "A", tutar: smm, kod: "153", aciklama: "Dönem sonu stok farkı" },
                ]
              : [
                  { taraf: "B", tutar: -smm, kod: "153", aciklama: "Dönem sonu stok farkı" },
                  { taraf: "A", tutar: -smm, kod: "621", aciklama: "Satılan ticari mallar maliyeti (düzeltme)" },
                ],
        }
        fisler.push(fis)
        uygula(fis)
      }
    }
  } else if ((yaprak.get("153") ?? 0) !== 0) {
    uyarilar.push("153 Ticari Mallar bakiyesi var ama sayım tutarı girilmedi: satılan malın maliyeti hesaplanmayacak (alışlar stokta kalır).")
  }

  // 2. 7/A yansıtma: 7. sınıfın her yaprağı karşılık 6. sınıf hesabına.
  {
    const satirlar: KapanisSatiri[] = []
    const hedefler = new Map<string, number>()
    for (const [kod, v] of [...yaprak].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (kod[0] !== "7" || v === 0) continue
      const hedef = yansimaHesabi(kod.split(".")[0])
      if (!hedef) {
        hatalar.push(`${kod} için yansıtma hesabı bilinmiyor.`)
        continue
      }
      satirlar.push(kapat(kod, v, `${kod} → ${hedef}`))
      hedefler.set(hedef, r2((hedefler.get(hedef) ?? 0) + v))
    }
    for (const [hedef, v] of hedefler) {
      hedefKontrol(hedef)
      if (v !== 0) satirlar.push({ taraf: v > 0 ? "B" : "A", tutar: Math.abs(v), kod: hedef, aciklama: "7/A yansıtma" })
    }
    if (satirlar.length) {
      const fis: KapanisFisi = { anahtar: "yansitma", aciklama: `${g.yil} maliyet hesaplarının yansıtılması (7/A)`, tarih: yilSonu, tur: "MAHSUP", satirlar }
      fisler.push(fis)
      uygula(fis)
    }
  }

  // 3. Gelir tablosu hesapları → 690.
  {
    const satirlar: KapanisSatiri[] = []
    let toplam = 0
    for (const [kod, v] of [...yaprak].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (kod[0] !== "6" || kod.startsWith("690") || v === 0) continue
      satirlar.push(kapat(kod, v, "Gelir tablosu hesabının kapanışı"))
      toplam = r2(toplam + v)
    }
    if (satirlar.length) {
      hedefKontrol("690")
      if (toplam !== 0) satirlar.push({ taraf: toplam > 0 ? "B" : "A", tutar: Math.abs(toplam), kod: "690", aciklama: "Dönem kârı veya zararı" })
      const fis: KapanisFisi = { anahtar: "gelir-kapanis", aciklama: `${g.yil} gelir tablosu hesaplarının kapanışı`, tarih: yilSonu, tur: "KAPANIS", satirlar }
      fisler.push(fis)
      uygula(fis)
    }
  }

  // 4. 690 → 590 / 591.
  const sonuc = yaprak.get("690") ?? 0 // borç bakiyesi = zarar
  const netKar = r2(-sonuc)
  if (sonuc !== 0) {
    const kar = sonuc < 0
    const hedef = kar ? "590" : "591"
    hedefKontrol(hedef)
    const tutar = Math.abs(sonuc)
    const fis: KapanisFisi = {
      anahtar: "kar",
      aciklama: `${g.yil} dönem net ${kar ? "kârı" : "zararı"}`,
      tarih: yilSonu,
      tur: "KAPANIS",
      satirlar: kar
        ? [
            { taraf: "B", tutar, kod: "690", aciklama: "Dönem kârı" },
            { taraf: "A", tutar, kod: "590", aciklama: "Dönem net kârı" },
          ]
        : [
            { taraf: "B", tutar, kod: "591", aciklama: "Dönem net zararı" },
            { taraf: "A", tutar, kod: "690", aciklama: "Dönem zararı" },
          ],
    }
    fisler.push(fis)
    uygula(fis)
  }

  // Kapanıştan sonra 6/7. sınıfta bakiye kalmamalı.
  for (const [kod, v] of yaprak) {
    if ((kod[0] === "6" || kod[0] === "7") && r2(v) !== 0) hatalar.push(`${kod} kapanıştan sonra ${r2(v).toFixed(2)} bakiye taşıyor.`)
  }

  // 5–6. Bilanço kapanış ve yeni yıl açılış fişleri.
  const bilanco = [...yaprak].filter(([kod, v]) => "12345".includes(kod[0]) && r2(v) !== 0).sort((a, b) => a[0].localeCompare(b[0]))
  if (bilanco.length) {
    fisler.push({
      anahtar: "bilanco-kapanis",
      aciklama: `${g.yil} yıl sonu kapanış fişi`,
      tarih: yilSonu,
      tur: "KAPANIS",
      satirlar: bilanco.map(([kod, v]) => kapat(kod, v, "Kapanış")),
    })
    fisler.push({
      anahtar: "acilis",
      aciklama: `${g.yil + 1} açılış fişi`,
      tarih: yeniYil,
      tur: "ACILIS",
      satirlar: bilanco.map(([kod, v]) => ({ taraf: v > 0 ? "B" : "A", tutar: Math.abs(v), kod, aciklama: "Açılış" })),
    })
  }

  for (const f of fisler) {
    const b = r2(f.satirlar.filter((s) => s.taraf === "B").reduce((a, s) => a + s.tutar, 0))
    const a = r2(f.satirlar.filter((s) => s.taraf === "A").reduce((a2, s) => a2 + s.tutar, 0))
    if (b !== a) hatalar.push(`${f.aciklama}: dengesiz (${b} ≠ ${a}).`)
  }
  return { fisler, netKar, hatalar, uyarilar }
}

const AY_ADLARI = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"]

/**
 * Kapanıştan önce bilinmesi gerekenler — ENGEL değil, uyarı (2026-10-09). Kapanış satılan malın
 * maliyetini sayım tutarıyla (153 − sayım) kurar; yılın aylık maliyeti yazılmamış aylarda bu,
 * o ayların FATURASIZ stok girişini de maliyete katar (aylık hesap onu 397'ye ayırırdı —
 * stok-maliyeti.ts). 397'de kalan faturasız giriş ise kapanışla aktarılmaz: geç girilmiş açılış
 * stoğu mu (sermaye / geçmiş yıl kârı), sayım fazlası mı (679) — müşavirin kararıdır.
 */
export function kapanisAySonuUyarilari(g: {
  yil: number
  /** Kobipo'da stok hareketi var mı (yoksa aylık maliyet zaten "gerekmez"). */
  stokTakibi: boolean
  /** Yılın maliyeti yazılmamış ya da güncel olmayan ayları ("YYYY-AA"). */
  smmBekleyen: string[]
  /** 397 Sayım ve Tesellüm Fazlaları'nın yıl sonu alacak bakiyesi. */
  fazla397: number
}): string[] {
  const u: string[] = []
  const aylar = g.smmBekleyen.filter((a) => a.startsWith(`${g.yil}-`)).sort()
  if (g.stokTakibi && aylar.length > 0) {
    const adlar = aylar.map((a) => AY_ADLARI[Number(a.slice(5, 7)) - 1])
    u.push(
      `${adlar.join(", ")} için satılan malın maliyeti yazılmadı ya da güncel değil. Kapanış maliyeti sayım tutarıyla kurar ve bu ayların faturasız stok girişini (ürün kartından açılış stoğu, elle düzeltme) de maliyete katar — kâr olduğundan düşük görünür. Önce Ay Sonu İşlemleri'nde bu ayları yazın.`,
    )
  }
  const fazla = r2(g.fazla397)
  if (fazla > 0) {
    u.push(
      `397 Sayım ve Tesellüm Fazlaları'nda ${fazla.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ₺ faturasız stok girişi duruyor; kapanış bunu aktarmaz. Muhasebecinizle karar verip elle fişle aktarın: geç girilmiş açılış stoğuysa sermaye ya da geçmiş yıl kârına, sayım fazlasıysa 679 Diğer Olağandışı Gelir ve Kârlar'a.`,
    )
  }
  return u
}
