/**
 * Fatura çıkarımının DETERMİNİSTİK denetimleri — saf, istemcide her düzeltmede
 * yeniden koşar (fişteki desen: lib/fis-ocr/validate.ts).
 *
 * Hiçbiri "doğru" demez; "burada tutarsızlık var, insana sor" der. Karekodlu
 * belgede karekod KAYNAK, model DENETİM aracıdır: ikisi tutmazsa patlar.
 */

import { tcknGecerliMi, vknGecerliMi } from "@/lib/fis-ocr/validate"
import { computeInvoiceTotals } from "@/lib/invoice/document-totals"
import type { GibKarekodu } from "../girdi/karekod"
import type { Denetim, Yon } from "../turler"
import type { Fatura } from "./schema"

const rakam = (v: unknown) => String(v ?? "").replace(/\D/g, "")
const sayi = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null)
const r2 = (n: number) => Math.round(n * 100) / 100

export type FaturaDenetimBaglami = {
  /** Firmanın (şubede ana firmanın) VKN/TCKN'si */
  firmaVkn: string | null | undefined
  yon: Yon
  karekod?: GibKarekodu | null
  bugun?: Date
}

/** VKN/TCKN checksum rozeti — satıcı ve alıcı için ortak. */
function vknDenetimi(anahtar: string, etiket: string, deger: string | null): Denetim {
  const v = rakam(deger)
  if (!v) return { anahtar, etiket, durum: "olcelemedi", aciklama: "Numara okunamadı" }
  if (v.length === 10) {
    const g = vknGecerliMi(v)
    return { anahtar, etiket, durum: g ? "gecti" : "patladi", aciklama: g ? "VKN checksum tutuyor" : "VKN checksum tutmuyor — hane yanlış okunmuş" }
  }
  if (v.length === 11) {
    const g = tcknGecerliMi(v)
    return { anahtar, etiket, durum: g ? "gecti" : "patladi", aciklama: g ? "TCKN checksum tutuyor" : "TCKN checksum tutmuyor — hane yanlış okunmuş" }
  }
  return { anahtar, etiket, durum: "patladi", aciklama: `${v.length} hane — 10 (VKN) veya 11 (TCKN) olmalı` }
}

export function faturaDenetle(f: Fatura, b: FaturaDenetimBaglami): Denetim[] {
  const s: Denetim[] = []
  const bugun = b.bugun ?? new Date()

  // 1) Bu belge BU firmaya mı? Alışta alıcı, satışta satıcı biz olmalıyız.
  const bizimVkn = rakam(b.firmaVkn)
  const bizimTaraf = b.yon === "SATIS" ? rakam(f.saticiVknTckn) : rakam(f.aliciVknTckn)
  const tarafEtiketi = b.yon === "SATIS" ? "Satıcı biz" : "Alıcı biz"
  if (!bizimVkn) {
    s.push({ anahtar: "taraf", etiket: tarafEtiketi, durum: "olcelemedi", aciklama: "Firmanın VKN'si kayıtlı değil" })
  } else if (!bizimTaraf) {
    s.push({ anahtar: "taraf", etiket: tarafEtiketi, durum: "olcelemedi", aciklama: "Belgede VKN okunamadı" })
  } else {
    const g = bizimTaraf === bizimVkn
    s.push({
      anahtar: "taraf",
      etiket: tarafEtiketi,
      durum: g ? "gecti" : "patladi",
      aciklama: g ? `VKN ${bizimVkn} belgedekiyle aynı` : `Belgedeki ${bizimTaraf} ≠ firma ${bizimVkn} — bu belge bu firmaya kesilmemiş olabilir`,
    })
  }

  // 2) Karşı tarafın VKN/TCKN checksum'ı
  const karsi = b.yon === "SATIS" ? f.aliciVknTckn : f.saticiVknTckn
  s.push(vknDenetimi("vkn", b.yon === "SATIS" ? "Müşteri VKN" : "Tedarikçi VKN", karsi))

  // 3) Satır aritmetiği: miktar × birimFiyat − iskonto = satirTutar
  const olculebilir = f.kalemler.filter(
    (k) => sayi(k.miktar) != null && sayi(k.birimFiyat) != null && sayi(k.satirTutar) != null
  )
  if (olculebilir.length === 0) {
    s.push({ anahtar: "satir", etiket: "Satır aritmetiği", durum: "olcelemedi", aciklama: "Miktar/birim fiyat/tutar üçlüsü okunamadı" })
  } else {
    const bozuk = olculebilir.filter((k) => {
      const beklenen = sayi(k.miktar)! * sayi(k.birimFiyat)! - (sayi(k.iskontoTutar) ?? 0)
      // Birim fiyat 6 ondalık basılabiliyor; belge kendi içinde kuruşa yuvarlıyor.
      return Math.abs(beklenen - sayi(k.satirTutar)!) > 0.05
    })
    s.push({
      anahtar: "satir",
      etiket: "Satır aritmetiği",
      durum: bozuk.length === 0 ? "gecti" : "patladi",
      aciklama:
        bozuk.length === 0
          ? `${olculebilir.length} satırda miktar × fiyat − iskonto = tutar`
          : `Tutmayan satır: ${bozuk.map((k) => k.ad).slice(0, 4).join(", ")}${bozuk.length > 4 ? "…" : ""}`,
    })
  }

  // 4) KDV kırılımı: oran başına Σ satır net × oran ≈ okunan KDV(oran)
  const oranNet = new Map<number, number>()
  for (const k of f.kalemler) {
    const oran = sayi(k.kdvOrani)
    const net = sayi(k.satirTutar)
    if (oran == null || net == null) continue
    oranNet.set(oran, (oranNet.get(oran) ?? 0) + net)
  }
  if (oranNet.size === 0) {
    s.push({ anahtar: "kdv", etiket: "KDV aritmetiği", durum: "olcelemedi", aciklama: "Kalemlerde oran/tutar yok" })
  } else {
    const genelIskonto = sayi(f.genelIskonto) ?? 0
    const matrahToplam = [...oranNet.values()].reduce((a, b) => a + b, 0)
    const tutmayan: string[] = []
    let olculen = 0
    for (const [oran, net] of oranNet) {
      // Genel iskonto satırlara matrah oranında dağılır (document-totals ile aynı kural).
      const pay = matrahToplam > 0 ? (net / matrahToplam) * genelIskonto : 0
      const beklenen = ((net - pay) * oran) / 100
      const okunan = f.kdvKirilimi.find((x) => x.oran === oran)?.kdv ?? null
      if (okunan == null) continue
      olculen++
      if (Math.abs(beklenen - okunan) > Math.max(0.05, 0.005 * Math.abs(okunan))) {
        tutmayan.push(`%${oran}: ${beklenen.toFixed(2)} bekleniyordu, ${okunan.toFixed(2)} okundu`)
      }
    }
    if (olculen === 0) {
      s.push({ anahtar: "kdv", etiket: "KDV aritmetiği", durum: "olcelemedi", aciklama: "Belgede KDV kırılımı okunamadı" })
    } else {
      s.push({
        anahtar: "kdv",
        etiket: "KDV aritmetiği",
        durum: tutmayan.length === 0 ? "gecti" : "patladi",
        aciklama: tutmayan.length === 0 ? `${olculen} oranda kalem × oran = KDV` : tutmayan.join(" · "),
      })
    }
  }

  // 5) Dip toplam: computeInvoiceTotals(kalemler) + kdvsizEk ≈ odenecek
  const odenecek = sayi(f.odenecek)
  const hesapKalemler = f.kalemler
    .filter((k) => sayi(k.satirTutar) != null || (sayi(k.miktar) != null && sayi(k.birimFiyat) != null))
    .map((k) => ({
      quantity: sayi(k.miktar) ?? 1,
      unitPrice:
        sayi(k.birimFiyat) ?? (sayi(k.satirTutar)! + (sayi(k.iskontoTutar) ?? 0)) / (sayi(k.miktar) || 1),
      discountAmount: sayi(k.iskontoTutar) ?? 0,
      discountMode: "AMOUNT",
      vatRate: sayi(k.kdvOrani) ?? 0,
      withholdingRate: sayi(k.tevkifatOrani) != null ? sayi(k.tevkifatOrani)! * 100 : 0,
    }))
  if (odenecek == null || hesapKalemler.length === 0) {
    s.push({ anahtar: "toplam", etiket: "Dip toplam", durum: "olcelemedi", aciklama: odenecek == null ? "Ödenecek tutar okunamadı" : "Kalem yok" })
  } else {
    const t = computeInvoiceTotals(hesapKalemler, { globalDiscountAmount: sayi(f.genelIskonto) ?? 0 })
    const hesaplanan = r2(t.total + (sayi(f.kdvsizEk) ?? 0))
    const fark = r2(odenecek - hesaplanan)
    const g = Math.abs(fark) < 0.5
    s.push({
      anahtar: "toplam",
      etiket: "Dip toplam",
      durum: g ? "gecti" : "patladi",
      aciklama: g
        ? fark === 0
          ? `Kalemlerden ${hesaplanan.toFixed(2)} = ödenecek`
          : `Kalemlerden ${hesaplanan.toFixed(2)}, ödenecek ${odenecek.toFixed(2)} (${fark > 0 ? "+" : ""}${fark.toFixed(2)} kuruş farkı yuvarlamaya yazılır)`
        : `Kalemlerden ${hesaplanan.toFixed(2)}, belgede ${odenecek.toFixed(2)} — ${Math.abs(fark).toFixed(2)} TL fark`,
    })
  }

  // 6) Karekod ↔ model çapraz (varsa)
  if (b.karekod) {
    const k = b.karekod
    const sapma: string[] = []
    if (k.belgeNo && f.faturaNo && k.belgeNo.trim().toUpperCase() !== f.faturaNo.trim().toUpperCase()) sapma.push(`no ${f.faturaNo} ≠ ${k.belgeNo}`)
    if (k.tarih && f.tarih && k.tarih.slice(0, 10) !== f.tarih.slice(0, 10)) sapma.push(`tarih ${f.tarih} ≠ ${k.tarih}`)
    if (k.odenecek != null && odenecek != null && Math.abs(k.odenecek - odenecek) > 0.01) sapma.push(`ödenecek ${odenecek} ≠ ${k.odenecek}`)
    if (k.saticiVkn && rakam(f.saticiVknTckn) && k.saticiVkn !== rakam(f.saticiVknTckn)) sapma.push(`satıcı VKN ${rakam(f.saticiVknTckn)} ≠ ${k.saticiVkn}`)
    if (k.aliciVkn && rakam(f.aliciVknTckn) && k.aliciVkn !== rakam(f.aliciVknTckn)) sapma.push(`alıcı VKN ${rakam(f.aliciVknTckn)} ≠ ${k.aliciVkn}`)
    s.push({
      anahtar: "karekod",
      etiket: "Karekod ↔ okuma",
      durum: sapma.length === 0 ? "gecti" : "patladi",
      aciklama: sapma.length === 0 ? "Başlık karekodla aynı" : sapma.join(" · "),
    })
  }

  // 7) Tarih makul mü; vade ≥ tarih
  if (!f.tarih || !/^\d{4}-\d{2}-\d{2}/.test(f.tarih)) {
    s.push({ anahtar: "tarih", etiket: "Tarih", durum: f.tarih ? "patladi" : "olcelemedi", aciklama: f.tarih ? `YYYY-MM-DD değil: ${f.tarih}` : "Tarih okunamadı" })
  } else {
    const t = new Date(f.tarih.slice(0, 10) + "T00:00:00Z")
    const yarin = new Date(bugun.getTime() + 86400000)
    const gecti = !Number.isNaN(t.getTime()) && t <= yarin
    const vadeSorunu = f.vade && /^\d{4}-\d{2}-\d{2}/.test(f.vade) && f.vade.slice(0, 10) < f.tarih.slice(0, 10)
    s.push({
      anahtar: "tarih",
      etiket: "Tarih",
      durum: gecti && !vadeSorunu ? "gecti" : "patladi",
      aciklama: !gecti ? `Gelecek tarih: ${f.tarih}` : vadeSorunu ? `Vade (${f.vade}) tarihten önce` : f.tarih.slice(0, 10),
    })
  }

  return s
}

/** İnsana sorulmalı mı — patlayan tek denetim ya da düşük güven yeter. */
export function faturaInsanaSorulmali(denetimler: Denetim[], f: Fatura): boolean {
  if (denetimler.some((d) => d.durum === "patladi")) return true
  const g = f.guven
  if (!g) return true
  return Math.min(g.satici, g.alici, g.tarih, g.toplam, g.kalemler) < 0.8
}
