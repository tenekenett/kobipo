/**
 * İrsaliye denetimleri — saf. Alışta alıcı biz, satışta satıcı biz; karşı taraf
 * ZORUNLU (uç 400 döner — kart kilitler); miktar > 0; sevk ≥ düzenleme.
 */

import { tcknGecerliMi, vknGecerliMi } from "@/lib/fis-ocr/validate"
import type { Denetim, Yon } from "../turler"
import type { Irsaliye } from "./schema"

const rakam = (v: unknown) => String(v ?? "").replace(/\D/g, "")
const sayi = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null)

export function irsaliyeDenetle(
  i: Irsaliye,
  b: { firmaVkn: string | null | undefined; yon: Yon; bugun?: Date }
): Denetim[] {
  const s: Denetim[] = []
  const bugun = b.bugun ?? new Date()

  const bizimVkn = rakam(b.firmaVkn)
  const bizimTaraf = b.yon === "SATIS" ? rakam(i.saticiVknTckn) : rakam(i.aliciVknTckn)
  const tarafEtiketi = b.yon === "SATIS" ? "Satıcı biz" : "Alıcı biz"
  if (!bizimVkn) s.push({ anahtar: "taraf", etiket: tarafEtiketi, durum: "olcelemedi", aciklama: "Firmanın VKN'si kayıtlı değil" })
  else if (!bizimTaraf) s.push({ anahtar: "taraf", etiket: tarafEtiketi, durum: "olcelemedi", aciklama: "Belgede VKN okunamadı" })
  else {
    const g = bizimTaraf === bizimVkn
    s.push({ anahtar: "taraf", etiket: tarafEtiketi, durum: g ? "gecti" : "patladi", aciklama: g ? `VKN ${bizimVkn} belgedekiyle aynı` : `Belgedeki ${bizimTaraf} ≠ firma ${bizimVkn}` })
  }

  const karsi = rakam(b.yon === "SATIS" ? i.aliciVknTckn : i.saticiVknTckn)
  const karsiEtiket = b.yon === "SATIS" ? "Müşteri VKN" : "Tedarikçi VKN"
  if (!karsi) s.push({ anahtar: "vkn", etiket: karsiEtiket, durum: "olcelemedi", aciklama: "Numara okunamadı" })
  else if (karsi.length === 10) s.push({ anahtar: "vkn", etiket: karsiEtiket, durum: vknGecerliMi(karsi) ? "gecti" : "patladi", aciklama: vknGecerliMi(karsi) ? "VKN checksum tutuyor" : "VKN checksum tutmuyor" })
  else if (karsi.length === 11) s.push({ anahtar: "vkn", etiket: karsiEtiket, durum: tcknGecerliMi(karsi) ? "gecti" : "patladi", aciklama: tcknGecerliMi(karsi) ? "TCKN checksum tutuyor" : "TCKN checksum tutmuyor" })
  else s.push({ anahtar: "vkn", etiket: karsiEtiket, durum: "patladi", aciklama: `${karsi.length} hane` })

  const miktarsiz = i.kalemler.filter((k) => !(sayi(k.miktar)! > 0))
  s.push({
    anahtar: "miktar",
    etiket: "Miktarlar",
    durum: i.kalemler.length === 0 ? "patladi" : miktarsiz.length === 0 ? "gecti" : "patladi",
    aciklama:
      i.kalemler.length === 0
        ? "Kalem okunamadı"
        : miktarsiz.length === 0
          ? `${i.kalemler.length} kalem, hepsinde miktar > 0`
          : `Miktarsız satır: ${miktarsiz.map((k) => k.ad).slice(0, 4).join(", ")}`,
  })

  const t = i.duzenlemeTarihi
  if (!t || !/^\d{4}-\d{2}-\d{2}/.test(t)) {
    s.push({ anahtar: "tarih", etiket: "Tarih", durum: t ? "patladi" : "olcelemedi", aciklama: t ? `YYYY-MM-DD değil: ${t}` : "Tarih okunamadı" })
  } else {
    const d = new Date(t.slice(0, 10) + "T00:00:00Z")
    const yarin = new Date(bugun.getTime() + 86400000)
    const gelecek = Number.isNaN(d.getTime()) || d > yarin
    const sevkOnce = i.sevkTarihi && /^\d{4}-\d{2}-\d{2}/.test(i.sevkTarihi) && i.sevkTarihi.slice(0, 10) < t.slice(0, 10)
    s.push({
      anahtar: "tarih",
      etiket: "Tarih",
      durum: !gelecek && !sevkOnce ? "gecti" : "patladi",
      aciklama: gelecek ? `Gelecek tarih: ${t}` : sevkOnce ? `Sevk (${i.sevkTarihi}) düzenlemeden önce` : t.slice(0, 10),
    })
  }
  return s
}

export function irsaliyeInsanaSorulmali(d: Denetim[], i: Irsaliye): boolean {
  if (d.some((x) => x.durum === "patladi")) return true
  const g = i.guven
  return !g || Math.min(g.satici, g.alici, g.tarih, g.kalemler) < 0.8
}
