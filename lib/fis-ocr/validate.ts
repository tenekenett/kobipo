/**
 * Fiş çıkarımının DETERMİNİSTİK denetimleri.
 *
 * NEDEN: modelin kendi "guven" skoru iyimser olabiliyor — ölçümde Qwen 0,90 güven
 * verdiği fişte toplamı 525,58 yerine 613,18 okumuştu (KDV'yi KDV-dahil toplamın
 * üstüne eklemişti). Bu hatayı yakalayan şey modelin güveni değil, aritmetikti.
 *
 * Buradaki kontroller modelden ve sağlayıcıdan BAĞIMSIZ çalışır; model değişse de
 * kapı yerinde kalır. Hiçbiri "doğru" demez, yalnız "burada bir tutarsızlık var,
 * insana sor" der.
 */

import type { Fis } from "./schema"

export type DenetimDurumu = "gecti" | "patladi" | "olcelemedi"

export type Denetim = {
  anahtar: "kdv" | "vkn" | "satir" | "tarih" | "toplam"
  etiket: string
  durum: DenetimDurumu
  aciklama: string
}

const rakam = (v: unknown) => String(v ?? "").replace(/\D/g, "")
const sayi = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null)

/**
 * VKN kontrol basamağı.
 *
 * DİKKAT — bu bir güvence DEĞİL, elek: rastgele bir 10 hanelinin geçme olasılığı
 * ~1/10. Ölçümde model MERSIS'ten yanlış hane penceresi alıp 6600004943 üretti ve
 * o numara checksum'ı GEÇTİ. Yani hataların ~%90'ını yakalar, %10'unu kaçırır.
 * Gerçek emniyet, VKN'nin mevcut bir cariyle eşleşip eşleşmediğidir.
 */
export function vknGecerliMi(deger: string): boolean {
  if (!/^\d{10}$/.test(deger)) return false
  const d = deger.split("").map(Number)
  let toplam = 0
  for (let i = 0; i < 9; i++) {
    const t = (d[i] + 9 - i) % 10
    toplam += t === 9 ? 9 : (t * 2 ** (9 - i)) % 9
  }
  return (10 - (toplam % 10)) % 10 === d[9]
}

/** TCKN kontrol basamakları (şahıs firması fişlerinde 11 hane basılır). */
export function tcknGecerliMi(deger: string): boolean {
  if (!/^[1-9]\d{10}$/.test(deger)) return false
  const d = deger.split("").map(Number)
  const tek = d[0] + d[2] + d[4] + d[6] + d[8]
  const cift = d[1] + d[3] + d[5] + d[7]
  if (((tek * 7 - cift) % 10 + 10) % 10 !== d[9]) return false
  return d.slice(0, 10).reduce((a, b) => a + b, 0) % 10 === d[10]
}

export function denetle(fis: Fis, bugun = new Date()): Denetim[] {
  const sonuc: Denetim[] = []

  // 1) KDV aritmetiği: TOPKDV = TOPLAM x oran / (100 + oran)
  const toplam = sayi(fis.genelToplam)
  const kdv = sayi(fis.kdvToplam)
  const oranlar = Array.from(
    new Set(fis.kalemler.map((k) => sayi(k.kdvOrani)).filter((o): o is number => !!o))
  )
  if (toplam == null || kdv == null || toplam === 0) {
    sonuc.push({
      anahtar: "kdv",
      etiket: "KDV aritmetiği",
      durum: "olcelemedi",
      aciklama: "Toplam veya KDV okunamadı",
    })
  } else if (oranlar.length !== 1) {
    // Karma oranlı fişte tek formül geçmez (market fişi: %1 gıda + %20 deterjan).
    sonuc.push({
      anahtar: "kdv",
      etiket: "KDV aritmetiği",
      durum: "olcelemedi",
      aciklama:
        oranlar.length === 0 ? "Kalemlerde KDV oranı yok" : `Karma oran (${oranlar.join(", ")})`,
    })
  } else {
    const beklenen = (toplam * oranlar[0]) / (100 + oranlar[0])
    const gecti = Math.abs(beklenen - kdv) < 0.05
    sonuc.push({
      anahtar: "kdv",
      etiket: "KDV aritmetiği",
      durum: gecti ? "gecti" : "patladi",
      aciklama: gecti
        ? `%${oranlar[0]} için ${beklenen.toFixed(2)} bekleniyordu`
        : `%${oranlar[0]} için ${beklenen.toFixed(2)} bekleniyordu, ${kdv.toFixed(2)} okundu`,
    })
  }

  // 2) VKN/TCKN kontrol basamağı
  const vkn = rakam(fis.vknTckn)
  if (!vkn) {
    sonuc.push({
      anahtar: "vkn",
      etiket: "VKN/TCKN",
      durum: "olcelemedi",
      aciklama: "Numara okunamadı",
    })
  } else if (vkn.length === 10) {
    const gecti = vknGecerliMi(vkn)
    sonuc.push({
      anahtar: "vkn",
      etiket: "VKN kontrol basamağı",
      durum: gecti ? "gecti" : "patladi",
      aciklama: gecti ? "10 hane, checksum tutuyor" : "Checksum tutmuyor — hane yanlış okunmuş",
    })
  } else if (vkn.length === 11) {
    const gecti = tcknGecerliMi(vkn)
    sonuc.push({
      anahtar: "vkn",
      etiket: "TCKN kontrol basamağı",
      durum: gecti ? "gecti" : "patladi",
      aciklama: gecti ? "11 hane, checksum tutuyor" : "Checksum tutmuyor — hane yanlış okunmuş",
    })
  } else {
    sonuc.push({
      anahtar: "vkn",
      etiket: "VKN/TCKN",
      durum: "patladi",
      aciklama: `${vkn.length} hane — 10 (VKN) veya 11 (TCKN) olmalı`,
    })
  }

  // 3) Satır aritmetiği: miktar x birimFiyat = tutar
  const olculebilir = fis.kalemler.filter(
    (k) => sayi(k.miktar) != null && sayi(k.birimFiyat) != null && sayi(k.tutar) != null
  )
  if (olculebilir.length === 0) {
    sonuc.push({
      anahtar: "satir",
      etiket: "Satır aritmetiği",
      durum: "olcelemedi",
      aciklama: "Miktar/birim fiyat basılmamış (departman satırı)",
    })
  } else {
    // Tolerans satır başına 1 kuruş DEĞİL: akaryakıtta birim fiyat 3 ondalıklı
    // (74,130) ve fiş kendi içinde yuvarlıyor.
    const bozuk = olculebilir.filter(
      (k) => Math.abs(sayi(k.miktar)! * sayi(k.birimFiyat)! - sayi(k.tutar)!) > 0.05
    )
    sonuc.push({
      anahtar: "satir",
      etiket: "Satır aritmetiği",
      durum: bozuk.length === 0 ? "gecti" : "patladi",
      aciklama:
        bozuk.length === 0
          ? `${olculebilir.length} satırda miktar x fiyat = tutar`
          : `Tutmayan satır: ${bozuk.map((k) => k.ad).join(", ")}`,
    })
  }

  // 4) Tarih makul mü — gelecek tarihli fiş yoktur.
  if (!fis.tarih || !/^\d{4}-\d{2}-\d{2}/.test(fis.tarih)) {
    sonuc.push({
      anahtar: "tarih",
      etiket: "Tarih",
      durum: fis.tarih ? "patladi" : "olcelemedi",
      aciklama: fis.tarih ? `YYYY-MM-DD değil: ${fis.tarih}` : "Tarih okunamadı",
    })
  } else {
    const t = new Date(fis.tarih.slice(0, 10) + "T00:00:00Z")
    const yarin = new Date(bugun.getTime() + 86400000)
    const gecti = !Number.isNaN(t.getTime()) && t <= yarin
    sonuc.push({
      anahtar: "tarih",
      etiket: "Tarih",
      durum: gecti ? "gecti" : "patladi",
      aciklama: gecti ? fis.tarih.slice(0, 10) : `Gelecek tarih: ${fis.tarih}`,
    })
  }

  // 5) Kalem toplamı = genel toplam
  const tutarlar = fis.kalemler.map((k) => sayi(k.tutar))
  if (toplam == null || tutarlar.some((t) => t == null) || tutarlar.length === 0) {
    sonuc.push({
      anahtar: "toplam",
      etiket: "Kalem toplamı",
      durum: "olcelemedi",
      aciklama: "Kalem tutarları eksik",
    })
  } else {
    const kalemToplami = tutarlar.reduce((a, b) => a! + b!, 0)!
    const gecti = Math.abs(kalemToplami - toplam) < 0.05
    sonuc.push({
      anahtar: "toplam",
      etiket: "Kalem toplamı",
      durum: gecti ? "gecti" : "patladi",
      aciklama: gecti
        ? `${kalemToplami.toFixed(2)} = genel toplam`
        : `Kalemler ${kalemToplami.toFixed(2)}, genel toplam ${toplam.toFixed(2)}`,
    })
  }

  return sonuc
}

/** Fişin insana sorulması gerekiyor mu — patlayan tek denetim yeter. */
export function insanaSorulmali(denetimler: Denetim[], fis: Fis): boolean {
  if (denetimler.some((d) => d.durum === "patladi")) return true
  const g = fis.guven
  if (!g) return true
  return Math.min(g.satici, g.tarih, g.toplam, g.kalemler) < 0.8
}
