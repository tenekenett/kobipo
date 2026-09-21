/**
 * Çek/senet denetimleri ve `/api/cek-senet` gövdesi — saf.
 */

import { tcknGecerliMi, vknGecerliMi } from "@/lib/fis-ocr/validate"
import type { Denetim, Yon } from "../turler"
import type { CekSenet } from "./schema"

const sayi = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null)
const rakam = (v: unknown) => String(v ?? "").replace(/\D/g, "")

export function cekTuruNormalize(v: unknown): "CEK" | "SENET" {
  const s = String(v ?? "").toUpperCase().replace(/[^A-Z]/g, "")
  return s === "SENET" || s === "BONO" ? "SENET" : "CEK"
}

export function cekDenetle(c: CekSenet, b: { firmaVkn: string | null | undefined; yon: Yon; bugun?: Date }): Denetim[] {
  const s: Denetim[] = []
  const bugun = b.bugun ?? new Date()
  const tur = cekTuruNormalize(c.tur)

  const t = sayi(c.tutar)
  s.push({ anahtar: "tutar", etiket: "Tutar", durum: t == null ? "olcelemedi" : t > 0 ? "gecti" : "patladi", aciklama: t == null ? "Tutar okunamadı" : t > 0 ? t.toFixed(2) : "Tutar 0 veya negatif" })

  s.push({
    anahtar: "no",
    etiket: tur === "CEK" ? "Çek no" : "Senet no",
    durum: c.seriNo ? "gecti" : "patladi",
    aciklama: c.seriNo ? c.seriNo : "Numara okunamadı — kayıt için zorunlu",
  })
  if (tur === "CEK") {
    s.push({ anahtar: "banka", etiket: "Banka", durum: c.banka ? "gecti" : "patladi", aciklama: c.banka ?? "Banka okunamadı — çek kaydı için zorunlu" })
  }

  // Yön: keşideci biz → verilen (GIVEN), lehtar biz → alınan (RECEIVED)
  const bizimVkn = rakam(b.firmaVkn)
  const kv = rakam(c.kesideciVknTckn)
  const lv = rakam(c.lehtarVknTckn)
  if (!bizimVkn || (!kv && !lv)) {
    s.push({ anahtar: "taraf", etiket: "Taraf", durum: "olcelemedi", aciklama: "VKN okunamadı; yön keşideci/lehtar adından belirlenir" })
  } else {
    // Çekte çoğu zaman yalnız keşidecinin VKN'si basılır (lehtar sadece ad).
    // Basılan VKN'ye bakılır: alınan çekte keşideci BİZ OLMAMALIYIZ, lehtar
    // basılmışsa biz olmalıyız; verilende tersi. "Basılmamış VKN bize eşit değil"
    // diye patlatmak her alınan çeki kırmızıya boyuyordu (ölçüldü).
    const uyum =
      b.yon === "SATIS"
        ? kv ? kv === bizimVkn : lv !== bizimVkn
        : lv ? lv === bizimVkn : kv !== bizimVkn
    s.push({
      anahtar: "taraf",
      etiket: "Taraf",
      durum: uyum ? "gecti" : "patladi",
      aciklama: uyum
        ? b.yon === "SATIS"
          ? kv ? "Keşideci biziz (verilen)" : "Lehtar biz değiliz (verilen)"
          : lv ? "Lehtar biziz (alınan)" : "Keşideci biz değiliz (alınan)"
        : "VKN'ler seçilen yönle uyuşmuyor",
    })
  }
  const karsi = b.yon === "SATIS" ? lv : kv
  if (karsi) {
    const g = karsi.length === 10 ? vknGecerliMi(karsi) : karsi.length === 11 ? tcknGecerliMi(karsi) : false
    s.push({ anahtar: "vkn", etiket: "Karşı taraf VKN", durum: g ? "gecti" : "patladi", aciklama: g ? "Checksum tutuyor" : "Checksum tutmuyor" })
  }

  const vade = c.vadeTarihi
  const keside = c.kesideTarihi
  if (!vade || !/^\d{4}-\d{2}-\d{2}/.test(vade)) s.push({ anahtar: "tarih", etiket: "Vade", durum: vade ? "patladi" : "olcelemedi", aciklama: vade ? `YYYY-MM-DD değil: ${vade}` : "Vade okunamadı — kayıt için zorunlu" })
  else {
    const once = keside && /^\d{4}-\d{2}-\d{2}/.test(keside) && vade.slice(0, 10) < keside.slice(0, 10)
    const cokEski = new Date(vade.slice(0, 10) + "T00:00:00Z").getTime() < bugun.getTime() - 366 * 86400000
    s.push({ anahtar: "tarih", etiket: "Vade", durum: once || cokEski ? "patladi" : "gecti", aciklama: once ? `Vade (${vade}) keşideden (${keside}) önce` : cokEski ? `Vade bir yıldan eski: ${vade}` : vade.slice(0, 10) })
  }
  return s
}

export function cekInsanaSorulmali(d: Denetim[], c: CekSenet): boolean {
  if (d.some((x) => x.durum === "patladi")) return true
  const g = c.guven
  return !g || Math.min(g.taraflar, g.tarih, g.tutar) < 0.8
}

export type CekGovdesi = {
  type: "CHECK" | "PROMISSORY_NOTE"
  companyId: string
  checkNo?: string
  noteNo?: string
  bankName?: string
  branchName?: string
  accountNo?: string
  amount: number
  issueDate: string
  dueDate: string
  direction: "RECEIVED" | "GIVEN"
  customerId?: string | null
  supplierId?: string | null
  notes?: string
}

export type CekDonusumu = {
  body: CekGovdesi
  uyarilar: Array<{ anahtar: "keside" | "cari" | "no"; mesaj: string; agir?: boolean }>
}

export function cekToBody(
  c: CekSenet,
  s: { companyId: string; yon: Yon; customerId?: string | null; supplierId?: string | null; kaynak?: string; bugun?: Date }
): CekDonusumu {
  const uyarilar: CekDonusumu["uyarilar"] = []
  const tur = cekTuruNormalize(c.tur)
  const direction: "RECEIVED" | "GIVEN" = s.yon === "SATIS" ? "GIVEN" : "RECEIVED"
  const gun = (t: string | null) => (t && /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null)
  const vade = gun(c.vadeTarihi) ?? gun(c.kesideTarihi) ?? (s.bugun ?? new Date()).toISOString().slice(0, 10)
  let keside = gun(c.kesideTarihi)
  if (!keside) {
    // Çekte çoğu zaman tek tarih basılır (vade). Keşide zorunlu alan: vadeyle doldurulur, söylenir.
    keside = vade
    uyarilar.push({ anahtar: "keside", mesaj: "Keşide tarihi okunamadı; vade tarihi yazıldı." })
  }
  const no = (c.seriNo || "").trim()
  if (!no) uyarilar.push({ anahtar: "no", mesaj: "Numara okunamadı; belgedeki numarayı girin.", agir: true })
  const cari = direction === "GIVEN" ? s.supplierId : s.customerId
  if (!cari) uyarilar.push({ anahtar: "cari", mesaj: direction === "GIVEN" ? "Verilen çek/senet için tedarikçi seçin." : "Alınan çek/senet için müşteri seçin." })

  const notlar = [
    c.kesideci ? `Keşideci: ${c.kesideci}` : null,
    c.lehtar ? `Lehtar: ${c.lehtar}` : null,
    c.kesideYeri ? `Keşide yeri: ${c.kesideYeri}` : null,
    `Belge taramadan (${s.kaynak ?? "belge"}) ${(s.bugun ?? new Date()).toLocaleDateString("tr-TR")}`,
  ].filter(Boolean)

  const body: CekGovdesi = {
    type: tur === "CEK" ? "CHECK" : "PROMISSORY_NOTE",
    companyId: s.companyId,
    ...(tur === "CEK" ? { checkNo: no, bankName: c.banka ?? "", branchName: c.sube ?? undefined, accountNo: c.hesapNo ?? undefined } : { noteNo: no }),
    amount: typeof c.tutar === "number" ? Math.round(c.tutar * 100) / 100 : 0,
    issueDate: keside,
    dueDate: vade,
    direction,
    ...(direction === "GIVEN" ? { supplierId: s.supplierId || null } : { customerId: s.customerId || null }),
    notes: notlar.join("\n"),
  }
  return { body, uyarilar }
}
