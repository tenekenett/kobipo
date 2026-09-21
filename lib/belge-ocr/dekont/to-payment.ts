/**
 * Dekont → fatura ödemesi gövdeleri (`/api/faturalar/odemeler`) — saf.
 *
 * Bir dekont birden çok açık faturayı kapatabilir; tutar seçilen faturalara
 * EN ESKİDEN başlayarak dağıtılır, artan tutar `artan` olarak döner ve kart
 * bunu söyler (faturasız cari tahsilat C1 kararına bağlı — plan Faz 4).
 * Ödeme yöntemi BANK_TRANSFER (dekont banka belgesidir; POS slipinde CREDIT_CARD).
 */

import type { Dekont } from "./schema"

const r2 = (n: number) => Math.round(n * 100) / 100

export type AcikFatura = { id: string; invoiceNo: string; date: string; kalan: number }

export type OdemeGovdesi = {
  invoiceId: string
  companyId: string
  amount: number
  paymentMethod: "BANK_TRANSFER" | "CREDIT_CARD"
  accountId?: string
  reference?: string
  notes?: string
  paymentDate: string
}

export type DekontDonusumu = {
  odemeler: OdemeGovdesi[]
  /** Faturalara dağıtılamayan kısım */
  artan: number
  uyarilar: Array<{ anahtar: "artan" | "tutar" | "fatura"; mesaj: string; agir?: boolean }>
}

export function dekontToPayments(
  d: Dekont,
  s: { companyId: string; faturalar: AcikFatura[]; accountId?: string | null; bugun?: Date }
): DekontDonusumu {
  const uyarilar: DekontDonusumu["uyarilar"] = []
  const tutar = typeof d.tutar === "number" && Number.isFinite(d.tutar) ? r2(d.tutar) : 0
  if (tutar <= 0) {
    uyarilar.push({ anahtar: "tutar", mesaj: "Dekont tutarı okunamadı.", agir: true })
    return { odemeler: [], artan: 0, uyarilar }
  }
  const tarih =
    d.islemTarihi && /^\d{4}-\d{2}-\d{2}/.test(d.islemTarihi)
      ? d.islemTarihi.slice(0, 10)
      : (s.bugun ?? new Date()).toISOString().slice(0, 10)
  const pos = (d.islemTuru || "").toUpperCase() === "POS"
  const notlar = [d.aciklama ? `Açıklama: ${d.aciklama}` : null, d.banka ? `Banka: ${d.banka}` : null].filter(Boolean).join(" · ")

  const odemeler: OdemeGovdesi[] = []
  let kalanTutar = tutar
  const sirali = [...s.faturalar].sort((a, b) => a.date.localeCompare(b.date))
  for (const f of sirali) {
    if (kalanTutar <= 0) break
    const pay = r2(Math.min(kalanTutar, Math.max(0, f.kalan)))
    if (pay <= 0) continue
    odemeler.push({
      invoiceId: f.id,
      companyId: s.companyId,
      amount: pay,
      paymentMethod: pos ? "CREDIT_CARD" : "BANK_TRANSFER",
      ...(s.accountId ? { accountId: s.accountId } : {}),
      ...(d.referansNo ? { reference: d.referansNo } : {}),
      ...(notlar ? { notes: notlar } : {}),
      paymentDate: tarih,
    })
    kalanTutar = r2(kalanTutar - pay)
  }
  if (s.faturalar.length === 0) {
    uyarilar.push({ anahtar: "fatura", mesaj: "Eşleşen açık fatura seçilmedi; dekont fatura ödemesi olarak kaydedilemez.", agir: true })
  } else if (kalanTutar > 0) {
    uyarilar.push({ anahtar: "artan", mesaj: `${kalanTutar.toFixed(2)} TL seçili faturaların açık tutarını aşıyor; artan kısım kaydedilmeyecek.`, agir: true })
  }
  return { odemeler, artan: kalanTutar, uyarilar }
}
