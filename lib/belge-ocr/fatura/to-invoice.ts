/**
 * Okunan faturayı `/api/e-donusum/invoices` gövdesine çevirir — saf; onay kartı
 * (önizleme) ve sunucu aynı modülü çağırır ki ekranda görünen ile kaydedilen
 * ayrışmasın (fişteki desen: lib/fis-ocr/to-invoice.ts).
 *
 * Fişten FARKI: fatura KDV HARİÇ basılır, çapa satır neti ve birim fiyattır;
 * tutardan geri çözüm yok. Dip toplam `computeInvoiceTotals` (resmî kural,
 * satır yuvarlamalı) ile kurulur — CLAUDE.md "Fatura dip toplamı YALNIZ
 * document-totals.ts'ten". Belgenin ödenecek tutarıyla kuruş farkı
 * `payableRoundingAmount`a yazılır; 50 kuruşu aşan fark ağır uyarıdır.
 *
 * YÖN: ALIS → PURCHASE + supplierId, SATIS → SALES + customerId. İkisinde de
 * `invoiceType: MANUAL` (kâğıt/dış belge; e-belge biz kesmedik) ve numara
 * BELGEDEN gelir: alışta tedarikçinin numarası, satışta matbu faturanın numarası.
 */

import { computeInvoiceTotals } from "@/lib/invoice/document-totals"
import type { Yon } from "../turler"
import type { Fatura } from "./schema"

const sayi = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)
const r2 = (n: number) => Math.round(n * 100) / 100
const r6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000

export type FaturaKalemGovdesi = {
  productId?: string
  description: string
  unit: string
  quantity: number
  /** KDV HARİÇ birim fiyat */
  unitPrice: number
  discountAmount: number
  discountMode: "AMOUNT"
  vatRate: number
  withholdingRate: number
}

export type FaturaUyarisi = {
  anahtar: "kalem" | "oran" | "yuvarlama" | "toplam" | "no" | "doviz" | "kdvsiz" | "tevkifat"
  mesaj: string
  agir?: boolean
}

export type FaturaGovdesi = {
  companyId: string
  type: "PURCHASE" | "SALES"
  invoiceType: "MANUAL"
  isReceipt: false
  supplierId?: string | null
  customerId?: string | null
  invoiceNo: string
  date: string
  dueDate?: string
  currency: string
  notes: string
  items: FaturaKalemGovdesi[]
  globalDiscountAmount?: number
  payableRoundingAmount?: number
  waybillIds?: string[]
  warehouseId?: string
  sendInvoice: false
}

export type FaturaDonusumu = {
  body: FaturaGovdesi
  uyarilar: FaturaUyarisi[]
  /** Sunucunun yazacağı toplam — ekranda "kaydedilecek tutar" */
  beklenenToplam: number
}

export type FaturaDonusumSecenegi = {
  companyId: string
  yon: Yon
  supplierId?: string | null
  customerId?: string | null
  /** Kalem sırası → productId (kartta yapılan/öğrenilen eşleme) */
  urunEslesme?: Map<number, string>
  warehouseId?: string | null
  waybillIds?: string[]
  /** Nota yazılacak kaynak: "e-Arşiv PDF (karekod)", "kâğıt fatura" */
  kaynak?: string
  bugun?: Date
}

function toGunString(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Belgedeki birim → uygulamanın birim kodu (büyük harf, boşsa ADET). */
function birimNormalize(b: string | null): string {
  const s = (b ?? "").trim().toLocaleUpperCase("tr")
  if (!s) return "ADET"
  const harita: Record<string, string> = { AD: "ADET", ADET: "ADET", PCS: "ADET", C62: "ADET", KGM: "KG", KG: "KG", LTR: "LT", LT: "LT", L: "LT", MTR: "M", M: "M", MTK: "M2", M2: "M2", MTQ: "M3", M3: "M3", HUR: "SAAT", SAAT: "SAAT", DAY: "GUN", GÜN: "GUN", GUN: "GUN", MON: "AY", AY: "AY", PA: "PAKET", PAKET: "PAKET", KWH: "KWH", KWT: "KWH" }
  return harita[s] ?? s
}

export function faturaToInvoiceBody(f: Fatura, s: FaturaDonusumSecenegi): FaturaDonusumu {
  const uyarilar: FaturaUyarisi[] = []
  const items: FaturaKalemGovdesi[] = []
  const type = s.yon === "SATIS" ? "SALES" : "PURCHASE"

  f.kalemler.forEach((k, i) => {
    const ad = (k.ad || "").trim() || "Mal/Hizmet"
    const miktarHam = sayi(k.miktar)
    const miktar = miktarHam != null && miktarHam > 0 ? r2(miktarHam) : 1
    const iskonto = Math.max(0, sayi(k.iskontoTutar) ?? 0)
    let birimFiyat = sayi(k.birimFiyat)
    const net = sayi(k.satirTutar)
    if (birimFiyat == null) {
      // Birim fiyat basılmamışsa satır netinden geri türet (KDV hariç çapa).
      if (net == null) {
        uyarilar.push({ anahtar: "kalem", mesaj: `"${ad}" satırında ne birim fiyat ne tutar okundu; faturaya alınmadı.`, agir: true })
        return
      }
      birimFiyat = (net + iskonto) / miktar
    }
    if (birimFiyat === 0 && (net ?? 0) === 0) {
      uyarilar.push({ anahtar: "kalem", mesaj: `"${ad}" satırı 0 TL, faturaya alınmadı.` })
      return
    }
    let oran = sayi(k.kdvOrani)
    if (oran == null || oran < 0) {
      // Fatura satırında oran yoksa 0 varsayılır ve söylenir: %20 tahmin etmek KDV'yi uydurmak olur.
      oran = 0
      uyarilar.push({ anahtar: "oran", mesaj: `"${ad}" satırında KDV oranı okunamadı, %0 yazıldı — kontrol edin.`, agir: true })
    }
    const tevkifat = sayi(k.tevkifatOrani)
    const eslesen = s.urunEslesme?.get(i)
    items.push({
      ...(eslesen ? { productId: eslesen } : {}),
      description: ad,
      unit: birimNormalize(k.birim),
      quantity: miktar,
      unitPrice: r6(birimFiyat),
      discountAmount: r2(iskonto),
      discountMode: "AMOUNT",
      vatRate: oran,
      withholdingRate: tevkifat != null && tevkifat > 0 ? r2(tevkifat * 100) : 0,
    })
  })

  // KDV'siz ekler (damga vergisi, gecikme zammı) matraha %0 KDV'li satır olarak girer:
  // ödenecek tutar belgeyle aynı kalır, KDV'ye dokunulmaz, gider olarak izlenir.
  const kdvsiz = sayi(f.kdvsizEk)
  if (kdvsiz != null && kdvsiz !== 0) {
    items.push({
      description: "KDV'siz ek (damga vergisi / gecikme zammı vb.)",
      unit: "ADET",
      quantity: 1,
      unitPrice: r6(kdvsiz),
      discountAmount: 0,
      discountMode: "AMOUNT",
      vatRate: 0,
      withholdingRate: 0,
    })
    uyarilar.push({ anahtar: "kdvsiz", mesaj: `${kdvsiz.toFixed(2)} TL KDV'siz ek, %0 KDV'li ayrı satır olarak yazıldı.` })
  }

  if (items.some((it) => it.withholdingRate > 0)) {
    uyarilar.push({ anahtar: "tevkifat", mesaj: "Tevkifatlı satır var: ödenecek tutar KDV'nin tevkif edilen kısmı düşülerek hesaplanır." })
  }

  const genelIskonto = Math.max(0, sayi(f.genelIskonto) ?? 0)
  const hesap = computeInvoiceTotals(items, { globalDiscountAmount: genelIskonto })
  const odenecek = sayi(f.odenecek)
  let yuvarlama = 0
  if (odenecek == null) {
    uyarilar.push({ anahtar: "toplam", mesaj: "Belgenin ödenecek tutarı okunamadı; kalemlerden hesaplanan tutar kaydedilecek.", agir: true })
  } else {
    yuvarlama = r2(odenecek - hesap.total)
    if (Math.abs(yuvarlama) >= 0.5) {
      uyarilar.push({
        anahtar: "yuvarlama",
        mesaj: `Kalemlerden ${hesap.total.toFixed(2)} TL, belgede ${odenecek.toFixed(2)} TL — ${Math.abs(yuvarlama).toFixed(2)} TL fark. Kalemleri kontrol edin.`,
        agir: true,
      })
    }
  }

  const paraBirimi = (f.paraBirimi || "TRY").toUpperCase()
  if (paraBirimi !== "TRY") {
    uyarilar.push({ anahtar: "doviz", mesaj: `Belge ${paraBirimi} cinsinden; kur bilgisi okunmadı, kaydı düzenleyip kur girin.`, agir: true })
  }

  const faturaNo = (f.faturaNo || "").trim()
  if (!faturaNo) {
    uyarilar.push({
      anahtar: "no",
      mesaj:
        type === "PURCHASE"
          ? "Fatura numarası okunamadı; tedarikçinin numarasını girin (boş bırakılırsa sistem numara üretir)."
          : "Fatura numarası okunamadı; kâğıt faturanın numarasını girin (boş bırakılırsa seri numarası üretilir ve belgeyle eşleşmez).",
      agir: true,
    })
  }

  const notSatirlari = [
    f.ettn ? `ETTN: ${f.ettn}` : null,
    f.senaryo && f.senaryo !== "KAGIT" ? `Senaryo: ${f.senaryo}${f.tip ? " / " + f.tip : ""}` : null,
    f.irsaliyeNoListesi.length ? `İrsaliye No: ${f.irsaliyeNoListesi.join(", ")}` : null,
    f.odemeNotu ? `Ödeme: ${f.odemeNotu}` : null,
    `Belge taramadan (${s.kaynak ?? "belge"}) ${(s.bugun ?? new Date()).toLocaleDateString("tr-TR")}`,
  ].filter(Boolean)

  const body: FaturaGovdesi = {
    companyId: s.companyId,
    type,
    invoiceType: "MANUAL",
    isReceipt: false,
    ...(type === "PURCHASE" ? { supplierId: s.supplierId || null } : { customerId: s.customerId || null }),
    invoiceNo: faturaNo,
    date: (f.tarih || "").slice(0, 10) || toGunString(s.bugun ?? new Date()),
    ...(f.vade && /^\d{4}-\d{2}-\d{2}/.test(f.vade) ? { dueDate: f.vade.slice(0, 10) } : {}),
    currency: paraBirimi,
    notes: notSatirlari.join("\n"),
    items,
    ...(genelIskonto > 0 ? { globalDiscountAmount: genelIskonto } : {}),
    ...(yuvarlama !== 0 ? { payableRoundingAmount: yuvarlama } : {}),
    ...(s.waybillIds && s.waybillIds.length ? { waybillIds: s.waybillIds } : {}),
    ...(s.warehouseId ? { warehouseId: s.warehouseId } : {}),
    sendInvoice: false,
  }

  return { body, uyarilar, beklenenToplam: r2(hesap.total + yuvarlama) }
}
