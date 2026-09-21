/**
 * Okunan irsaliyeyi `/api/irsaliye` gövdesine çevirir — saf.
 *
 * ALIS → type PURCHASE + supplierId (uç zorunlu tutar), SATIS → SALES + customerId.
 * `waybillNo` belgeden: alışta tedarikçinin numarası (uç elle numarayı öncelikli
 * alır), satışta matbu irsaliyenin numarası. Kayıt DRAFT açılır; "Teslim alındı"
 * anahtarı kartta ayrı bir PUT ile DELIVERED yapar (stok o zaman girer).
 */

import type { Yon } from "../turler"
import type { Irsaliye } from "./schema"

const sayi = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)

export type IrsaliyeKalemGovdesi = {
  productId?: string
  description: string
  quantity: number
  unit: string | null
}

export type IrsaliyeGovdesi = {
  companyId: string
  type: "PURCHASE" | "SALES"
  supplierId?: string | null
  customerId?: string | null
  waybillNo: string
  date: string
  deliveryDate?: string
  carrier?: string
  vehicleNo?: string
  driverName?: string
  deliveryAddress?: string
  notes: string
  items: IrsaliyeKalemGovdesi[]
}

export type IrsaliyeUyarisi = { anahtar: "kalem" | "urun" | "no" | "cari"; mesaj: string; agir?: boolean }

export type IrsaliyeDonusumu = { body: IrsaliyeGovdesi; uyarilar: IrsaliyeUyarisi[] }

function toGunString(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function irsaliyeToWaybillBody(
  i: Irsaliye,
  s: {
    companyId: string
    yon: Yon
    supplierId?: string | null
    customerId?: string | null
    urunEslesme?: Map<number, string>
    kaynak?: string
    bugun?: Date
  }
): IrsaliyeDonusumu {
  const uyarilar: IrsaliyeUyarisi[] = []
  const type = s.yon === "SATIS" ? "SALES" : "PURCHASE"
  const items: IrsaliyeKalemGovdesi[] = []
  let eslesmeyen = 0
  i.kalemler.forEach((k, idx) => {
    const ad = (k.ad || "").trim()
    const miktar = sayi(k.miktar)
    if (!ad || miktar == null || miktar <= 0) {
      uyarilar.push({ anahtar: "kalem", mesaj: `"${ad || "?"}" satırı miktarsız, irsaliyeye alınmadı.`, agir: true })
      return
    }
    const productId = s.urunEslesme?.get(idx)
    if (!productId) eslesmeyen++
    items.push({
      ...(productId ? { productId } : {}),
      description: ad,
      quantity: Math.round(miktar * 100) / 100,
      unit: k.birim ? k.birim.trim().toLocaleUpperCase("tr") : null,
    })
  })
  if (eslesmeyen > 0) {
    // Ağır DEĞİL: irsaliye kaydedilir, ama ürünle eşleşmeyen satır "Teslim alındı"da
    // stoğa GİRMEZ. Kullanıcı görmeli, kayıt kilitlenmemeli.
    uyarilar.push({ anahtar: "urun", mesaj: `${eslesmeyen} satır ürün kartıyla eşleşmedi — teslim alındığında stoğa girmeyecek.` })
  }

  const karsi = type === "PURCHASE" ? s.supplierId : s.customerId
  if (!karsi) {
    uyarilar.push({ anahtar: "cari", mesaj: type === "PURCHASE" ? "Tedarikçi seçilmeden alış irsaliyesi kaydedilemez." : "Müşteri seçilmeden satış irsaliyesi kaydedilemez.", agir: true })
  }
  const no = (i.irsaliyeNo || "").trim()
  if (!no) uyarilar.push({ anahtar: "no", mesaj: "İrsaliye numarası okunamadı; belgedeki numarayı girin (boşsa sistem üretir).", agir: true })

  const notSatirlari = [
    i.ettn ? `ETTN: ${i.ettn}` : null,
    i.faturaNoAtfi ? `Fatura No: ${i.faturaNoAtfi}` : null,
    `Belge taramadan (${s.kaynak ?? "belge"}) ${(s.bugun ?? new Date()).toLocaleDateString("tr-TR")}`,
  ].filter(Boolean)

  const gun = (t: string | null) => (t && /^\d{4}-\d{2}-\d{2}/.test(t) ? t.slice(0, 10) : null)
  return {
    body: {
      companyId: s.companyId,
      type,
      ...(type === "PURCHASE" ? { supplierId: s.supplierId || null } : { customerId: s.customerId || null }),
      waybillNo: no,
      date: gun(i.duzenlemeTarihi) ?? toGunString(s.bugun ?? new Date()),
      ...(gun(i.sevkTarihi) ? { deliveryDate: gun(i.sevkTarihi)! } : {}),
      ...(i.tasiyici ? { carrier: i.tasiyici } : {}),
      ...(i.plaka ? { vehicleNo: i.plaka } : {}),
      ...(i.sofor ? { driverName: i.sofor } : {}),
      ...(i.sevkAdresi ? { deliveryAddress: i.sevkAdresi } : {}),
      notes: notSatirlari.join("\n"),
      items,
    },
    uyarilar,
  }
}
