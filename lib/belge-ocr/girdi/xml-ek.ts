/**
 * UBL XML tanıma — PDF/A-3 eki ya da doğrudan yüklenen .xml.
 *
 * Yalnız KÖK ELEMANA bakar: `Invoice` (fatura), `DespatchAdvice` (irsaliye);
 * `CreditNote`/`ReceiptAdvice`/`ApplicationResponse` bugün desteklenmiyor →
 * DIGER. XML'in kendisi `lib/belge-ocr/ubl.ts`te çözülür; burası "bu ek işe
 * yarar mı" sorusunu cevaplar ki boru hattı imza/logo eklerini parse etmesin.
 */

export type UblTuru = "INVOICE" | "DESPATCHADVICE" | "DIGER"

export type UblAdayi = { ad: string; xml: string; tur: UblTuru }

const KOK_DESENI = /<\s*(?:[\w-]+:)?(Invoice|DespatchAdvice|CreditNote|ReceiptAdvice|ApplicationResponse)\b/

export function ublTuruBul(xml: string): UblTuru {
  // XML bildirimi ve yorumları atlayıp ilk elemanı bulmak için ilk 4 KB yeter.
  const m = xml.slice(0, 4096).match(KOK_DESENI)
  if (!m) return "DIGER"
  if (m[1] === "Invoice") return "INVOICE"
  if (m[1] === "DespatchAdvice") return "DESPATCHADVICE"
  return "DIGER"
}

export function bytesToXml(icerik: Uint8Array): string | null {
  // UTF-8 BOM'lu ya da BOM'suz; UTF-16 UBL pratikte görülmüyor.
  const s = new TextDecoder("utf-8", { fatal: false }).decode(icerik)
  return s.includes("<") ? s.replace(/^﻿/, "") : null
}

/** PDF eklerinden UBL adaylarını çıkarır; XML olmayan ekler (imza, logo) elenir. */
export function ublAdaylari(ekler: Array<{ ad: string; icerik: Uint8Array }>): UblAdayi[] {
  const sonuc: UblAdayi[] = []
  for (const ek of ekler) {
    // 2 MB üstü ek UBL değildir (fatura XML'i onlarca KB); imza paketi ya da görsel.
    if (ek.icerik.length > 2_000_000) continue
    const xml = bytesToXml(ek.icerik)
    if (!xml) continue
    const tur = ublTuruBul(xml)
    if (tur === "DIGER") continue
    sonuc.push({ ad: ek.ad, xml, tur })
  }
  return sonuc
}
