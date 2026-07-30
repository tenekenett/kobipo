/**
 * Fiş (termal) HTML'i — hızlı satış/alış ekranları ve fiş detay sayfası ortak kullanır.
 *
 * Satış ve alış fişi aynı şablondur; yalnızca etiketler yön (direction) ile değişir.
 * Fiş gayriresmî belgedir: üzerinde "FİŞ" yazar, "FATURA" değil.
 *
 * Görünüm firma başına özelleştirilebilir (Ayarlar > Fiş Tasarımı → Company.receiptTemplate).
 * Şablon verilmezse varsayılan kullanılır ve çıktı, tasarım özelliği eklenmeden önceki
 * fişle birebir aynıdır.
 */

import { DEFAULT_RECEIPT_TEMPLATE, type ReceiptTemplate } from "./receipt-template"

export type ReceiptDirection = "outgoing" | "incoming"

export type ReceiptItem = {
  description: string
  quantity: number
  unit: string
  unitPrice: number
  vatRate: number
  total: number
}

/** Fişin üstünde basılabilen firma künyesi (şablonda açıksa). */
export type ReceiptCompanyInfo = {
  address?: string | null
  phone?: string | null
  taxOffice?: string | null
  taxNumber?: string | null
}

export type ReceiptData = {
  direction: ReceiptDirection
  invoiceNo?: string | null
  date: string
  companyName: string
  /** showAddress / showContact açıkken kullanılır. */
  company?: ReceiptCompanyInfo
  /** Satışta müşteri, alışta tedarikçi. Boşsa yöne göre "Perakende"/"Serbest". */
  counterpartyName?: string | null
  items: ReceiptItem[]
  net: number
  vat: number
  total: number
  paymentLabel: string
  tendered: number
  /** Para üstü. Sonradan yazdırmada (fiş detayı) bilinmediğinden verilmez → satır çıkmaz. */
  change?: number
  isCredit: boolean
  /** Parçalı ödeme dökümü (varsa) — yöntem başına tutar. */
  parts?: { label: string; amount: number }[]
  /** Fişin notu; yalnız şablonda showNotes açıksa basılır. */
  notes?: string | null
  /**
   * HESAP FİŞİ (ödeme öncesi döküm). Müşteriye "borcunuz bu" demek için basılır;
   * ödeme henüz alınmadığı için ödeme satırları YAZILMAZ ve altına mali değeri
   * olmadığı yazılır. Adisyon kapatılmaz — asıl fiş ödemeden sonra kesilir.
   */
  prebill?: boolean
  /** Hesap fişinde belge no yerine yazılan üst satır: "ADS-2026-0001 · Masa 5". */
  reference?: string | null
  /** İskonto satırı (varsa) — hesap fişinde ve fişte aynı görünsün. */
  discount?: { label: string; amount: number } | null
}

/** Şablonda alt not boşken satış fişinde basılan varsayılan kapanış. */
const DEFAULT_SALES_FOOTER = "Bizi tercih ettiğiniz için teşekkürler"

/**
 * Fişin altına DAİMA basılan ibare — şablondan kapatılamaz ve alt nottan bağımsızdır.
 * Fiş resmî belge değildir; sektör uygulaması (ör. BenimPOS) bu uyarıyı zorunlu tutar,
 * belgenin fatura sanılmaması buna bağlıdır. Kullanıcı tercihine bırakılmaz.
 */
const LEGAL_NOTICE = "Bilgilendirme Amaçlıdır"

/**
 * Hesap fişinin (ödeme öncesi döküm) alt ibaresi. Fişten daha net olmalı:
 * bu belge ödeme belgesi DEĞİL, ödenecek tutarın dökümüdür.
 */
const PREBILL_NOTICE = "HESAP FİŞİDİR · Mali değeri yoktur · Ödeme alınmamıştır"

export const currency = (n: number) =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(n || 0)

export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
  )

export function buildReceiptHtml(
  r: ReceiptData,
  autoPrint = false,
  template: ReceiptTemplate = DEFAULT_RECEIPT_TEMPLATE,
): string {
  const isSales = r.direction === "outgoing"
  const docTitle = r.prebill ? "Hesap Fişi" : isSales ? "Satış Fişi" : "Alış Fişi"
  const docHeader = r.prebill ? "HESAP FİŞİ" : isSales ? "SATIŞ FİŞİ" : "ALIŞ FİŞİ"
  const counterpartyLabel = isSales ? "Müşteri" : "Tedarikçi"
  const counterpartyFallback = isSales ? "Perakende" : "Serbest"
  const creditLabel = isSales ? "Veresiye / Açık Hesap" : "Açık Hesap"

  // Üst başlık: şablonda yazılmışsa o, yoksa firma adı (eski davranış).
  const headerTitle = template.headerText || r.companyName || docTitle
  // Alt not: şablonda yazılmışsa o; şablon boşken satışta eski teşekkür satırı,
  // alışta hiç alt not yoktu — bu ayrım korunur.
  const footerText = template.footerText || (isSales ? DEFAULT_SALES_FOOTER : "")

  const dateStr = new Date(r.date).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" })
  const qtyFmt = (n: number) => n.toLocaleString("tr-TR", { maximumFractionDigits: 3 })
  const items = r.items
    .map(
      (it) => `
      <div class="item">
        <div class="name">${escapeHtml(it.description)}</div>
        <div class="row muted">
          <span>${qtyFmt(it.quantity)} ${escapeHtml(it.unit)} × ${currency(it.unitPrice)} · KDV %${it.vatRate}</span>
          <span>${currency(it.total)}</span>
        </div>
      </div>`
    )
    .join("")

  const changeRow =
    r.change == null ? "" : `<div class="row"><span>Para Üstü</span><span>${currency(r.change)}</span></div>`

  // Künye: başlığın hemen altında, ortalı ve küçük punto. Boş alanlar hiç basılmaz.
  const addressLine =
    template.showAddress && r.company?.address ? escapeHtml(r.company.address) : ""
  const taxLine =
    template.showContact && (r.company?.taxOffice || r.company?.taxNumber)
      ? escapeHtml(
          [r.company?.taxOffice, r.company?.taxNumber].filter(Boolean).join(" V.D. ").trim(),
        )
      : ""
  const phoneLine =
    template.showContact && r.company?.phone ? `Tel: ${escapeHtml(r.company.phone)}` : ""
  const infoLines = [addressLine, taxLine, phoneLine].filter(Boolean)
  const infoBlock = infoLines
    .map((l) => `<div class="center info">${l}</div>`)
    .join("\n    ")

  // Hesap fişinde ödeme satırı YOK: para henüz alınmadı, "Ödeme: Nakit" yazmak
  // müşteriyi de kasiyeri de yanıltırdı.
  const payRows = r.prebill
    ? ""
    : r.isCredit
    ? `<div class="row"><span>Ödeme</span><span>${creditLabel}</span></div>`
    : r.parts && r.parts.length > 0
      ? r.parts
          .map((p) => `<div class="row"><span>${escapeHtml(p.label)}</span><span>${currency(p.amount)}</span></div>`)
          .join("") + changeRow
      : `<div class="row"><span>Ödeme</span><span>${escapeHtml(r.paymentLabel)}</span></div>
       <div class="row"><span>Ödenen</span><span>${currency(r.tendered)}</span></div>
       ${changeRow}`

  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${docTitle}${r.invoiceNo ? ` — ${escapeHtml(r.invoiceNo)}` : ""}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: "Courier New", ui-monospace, monospace; background: #f3f4f6; color: #000; }
  .toolbar { position: sticky; top: 0; z-index: 1; display: flex; gap: 8px; justify-content: center; padding: 12px; background: #fff; border-bottom: 1px solid #e5e7eb; }
  .toolbar button { font: inherit; font-size: 13px; font-weight: 600; padding: 8px 18px; border: 1px solid #cbd5e1; border-radius: 8px; background: #fff; color: #0f172a; cursor: pointer; }
  .toolbar button.primary { background: #2563eb; color: #fff; border-color: #2563eb; }
  .receipt { width: ${template.widthMm}mm; margin: 16px auto; background: #fff; padding: 6mm 4mm; font-size: 12px; line-height: 1.4; box-shadow: 0 1px 6px rgba(0,0,0,.15); }
  .center { text-align: center; }
  .bold { font-weight: 700; }
  .muted { color: #333; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  .item { margin: 4px 0; }
  .item .name { font-weight: 600; }
  .big { font-size: 15px; font-weight: 700; }
  /* Logo: fişe sığsın, oranı bozulmasın. */
  .logo { display: block; margin: 0 auto 4px; max-width: 60%; max-height: 20mm; object-fit: contain; }
  .note { margin-top: 4px; word-break: break-word; }
  /* Künye (adres / vergi / telefon): başlık altında küçük punto. */
  .info { font-size: 10px; color: #333; word-break: break-word; }
  hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
  @media print {
    body { background: #fff; }
    .toolbar { display: none; }
    .receipt { width: auto; margin: 0; box-shadow: none; }
    @page { margin: 0; }
  }
</style>
</head>
<body${autoPrint ? ' onload="window.print()"' : ""}>
  <div class="toolbar">
    <button class="primary" onclick="window.print()">Yazdır</button>
    <button onclick="window.close()">Kapat</button>
  </div>
  <div class="receipt">
    ${template.logoDataUrl ? `<img class="logo" src="${escapeHtml(template.logoDataUrl)}" alt="" />` : ""}
    <div class="center bold" style="font-size:14px">${escapeHtml(headerTitle)}</div>
    ${infoBlock}
    <div class="center muted">${docHeader}</div>
    <hr />
    <div class="row"><span>Tarih</span><span>${dateStr}</span></div>
    ${
      template.showCounterparty
        ? `<div class="row"><span>${counterpartyLabel}</span><span>${escapeHtml(r.counterpartyName || counterpartyFallback)}</span></div>`
        : ""
    }
    ${r.invoiceNo ? `<div class="row"><span>Belge No</span><span>${escapeHtml(r.invoiceNo)}</span></div>` : ""}
    ${r.reference ? `<div class="row"><span>Adisyon</span><span>${escapeHtml(r.reference)}</span></div>` : ""}
    <hr />
    ${items}
    <hr />
    ${
      template.showVat
        ? `<div class="row"><span>Ara Toplam</span><span>${currency(r.net)}</span></div>
    <div class="row"><span>KDV</span><span>${currency(r.vat)}</span></div>`
        : ""
    }
    ${
      r.discount
        ? `<div class="row"><span>${escapeHtml(r.discount.label)}</span><span>−${currency(r.discount.amount)}</span></div>`
        : ""
    }
    <div class="row big"><span>TOPLAM</span><span>${currency(r.total)}</span></div>
    ${payRows ? `<hr />\n    ${payRows}` : ""}
    ${
      template.showNotes && r.notes
        ? `<hr />\n    <div class="note muted">${escapeHtml(r.notes)}</div>`
        : ""
    }
    ${footerText && !r.prebill ? `<hr />\n    <div class="center muted">${escapeHtml(footerText)}</div>` : ""}
    <hr />
    <div class="center info">${r.prebill ? PREBILL_NOTICE : LEGAL_NOTICE}</div>
  </div>
</body>
</html>`
}
