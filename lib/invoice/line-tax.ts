/**
 * Fatura satırı vergi hesabının TEK kaynağı.
 *
 * Neden ortak modül: aynı formül editörde, POST/PUT uçlarında, taslak PDF
 * önizlemesinde ve Mysoft payload'ında ayrı ayrı yazılıydı. ÖTV'nin KDV
 * matrahına girmesi gibi bir kural değiştiğinde beşinden biri unutulursa
 * ekranda gördüğü tutarla GİB'e giden belge birbirini tutmaz.
 *
 * KURAL — KDV matrahı mal/hizmet bedelinin TEK BAŞINA kendisi değildir:
 *
 *   net       = brüt − satır iskontosu − (fatura altı iskonto payı)
 *   ÖTV       = net × exciseRate/100                    → matraha EKLENİR
 *   GEKAP     = miktar × gekapUnitAmount   (MAKTU)      → matraha EKLENİR
 *   GEKAP(%)  = net × otherTaxRate/100 (vatBase türü)   → matraha EKLENİR
 *   diğer     = net × otherTaxRate/100 (öteki türler)   → matrahın ÜSTÜNE eklenir
 *   KDV       = (net + ÖTV + GEKAP) × vatRate/100
 *   tevkifat  = KDV × withholdingRate/100               → toplamdan DÜŞÜLÜR
 *   toplam    = net + ÖTV + GEKAP + diğer + KDV − tevkifat
 *
 * ÖTV her zaman matrahın içindedir (ÖTVK 1 sayılı liste dahil, KDVK 24/b).
 * GEKAP da GİB'in KDVK 24/b yorumuyla matraha girer. Konaklama Vergisi ve ÖİV
 * ise kendi kanunlarıyla matrahın DIŞINDA bırakılmıştır — hangi "diğer vergi"
 * türünün matraha girdiği `GibTaxType.vatBase` bayrağından okunur
 * (lib/integrations/e-invoice/gib-tax-types.ts).
 *
 * GEKAP'IN İKİ GİRİŞ YOLU VAR ve ikisi AYNI ANDA kullanılamaz:
 *
 *   1. `gekapUnitAmount` (₺/birim) — MAKTU, doğrusu budur. Mevzuattaki GEKAP
 *      birim başına sabit tutardır; iskonto onu küçültmez.
 *   2. `otherTaxCode = "GEKAP"` + `otherTaxRate` (%) — yalnız tutarın bilindiği
 *      ama birim karşılığının bilinmediği durumlar için (tipik olarak GELEN
 *      faturadan geri türetme). Oransal olduğu için iskontoyla ölçeklenir.
 *
 * `gekapUnitAmount` doluysa 2. yol YOKSAYILIR — çift sayım olmaz.
 *
 * ÖLÇEKLEME UYARISI: maktu GEKAP fatura altı iskonto/ilaveden ETKİLENMEZ.
 * Çağıranlar global iskontoyu tek katsayıyla uyguladığı için, ölçeklenmemesi
 * gereken kısmı `nonScalingTotal` / `gekapVat` / `gekapWithholding` alanlarıyla
 * dışarı veriyoruz: `adj = (toplam − nonScaling) × faktör + nonScaling`.
 */

import { GEKAP_TAX_CODE, isOtherTaxInVatBase } from "@/lib/integrations/e-invoice/gib-tax-types"

export type LineTaxRates = {
  vatRate?: number | null
  exciseRate?: number | null
  /**
   * ÖTV'nin GİB liste kodu. Hesabı ETKİLEMEZ (hangi liste olursa olsun ÖTV
   * matraha girer); tip yalnız çağıranın satır nesnesini olduğu gibi
   * geçirebilmesi için tanıyor.
   */
  exciseCode?: string | null
  otherTaxRate?: number | null
  /** Diğer verginin GİB kodu — matraha girip girmediğini bu belirler. */
  otherTaxCode?: string | null
  withholdingRate?: number | null
  /** Maktu GEKAP'ın çarpanı. `gekapUnitAmount` doluysa gerekir. */
  quantity?: number | null
  /** GEKAP birim tutarı (₺/birim). Maktu — orana çevrilmez. */
  gekapUnitAmount?: number | null
}

export type LineTax = {
  /** ÖTV tutarı (net üzerinden). */
  excise: number
  /** Diğer vergi tutarı (net üzerinden) — matraha girsin girmesin. */
  otherTax: number
  /** Diğer verginin matraha giren kısmı (oransal GEKAP). `otherTax`in alt kümesi. */
  otherTaxInBase: number
  /** Maktu GEKAP tutarı: miktar × birim tutar. İskontodan etkilenmez. */
  gekap: number
  /** Maktu GEKAP'tan doğan KDV — global iskonto katsayısıyla ÖLÇEKLENMEZ. */
  gekapVat: number
  /** Maktu GEKAP KDV'sinden kesilen tevkifat — bu da ölçeklenmez. */
  gekapWithholding: number
  /**
   * Satır toplamının global iskonto/ilaveyle DEĞİŞMEYEN kısmı:
   * gekap + gekapVat − gekapWithholding.
   */
  nonScalingTotal: number
  /** KDV'nin hesaplandığı matrah: net + ÖTV + GEKAP. */
  vatBase: number
  vat: number
  withholding: number
  /** Satırın ödenecek toplamı (KDV dahil, tevkifat düşülmüş). */
  total: number
}

const num = (v: number | null | undefined) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Satırın net matrahı (brüt − iskonto) verildiğinde tüm vergi kırılımını üretir. */
export function computeLineTax(net: number, rates: LineTaxRates): LineTax {
  const base = num(net)
  const vatRate = num(rates.vatRate)
  const exciseRate = num(rates.exciseRate)
  const otherTaxRate = num(rates.otherTaxRate)
  const withholdingRate = num(rates.withholdingRate)

  // Maktu GEKAP: miktar × birim tutar. Net'ten TÜRETİLMEZ — iskonto onu küçültmez.
  const gekap = num(rates.quantity) * num(rates.gekapUnitAmount)

  // Aynı satırda hem maktu hem oransal GEKAP varsa MAKTU kazanır: oransal yol
  // tamamen susar. Yarısını (tutar evet, matrah hayır) saymak sessiz bir sapma
  // üretirdi. Editör ikisini birden girmeyi zaten engelliyor; bu son savunma.
  const gekapPercentSuppressed =
    gekap !== 0 && String(rates.otherTaxCode ?? "").trim() === GEKAP_TAX_CODE

  const excise = base * (exciseRate / 100)
  const otherTax = gekapPercentSuppressed ? 0 : base * (otherTaxRate / 100)
  const otherTaxInBase = isOtherTaxInVatBase(rates.otherTaxCode) ? otherTax : 0

  const vatBase = base + excise + otherTaxInBase + gekap
  const vat = vatBase * (vatRate / 100)
  const withholding = vat * (withholdingRate / 100)

  // KDV matrahta lineer olduğundan GEKAP'ın payını ayırabiliyoruz; global iskonto
  // katsayısı yalnız geri kalana uygulanacak.
  const gekapVat = gekap * (vatRate / 100)
  const gekapWithholding = gekapVat * (withholdingRate / 100)

  return {
    excise,
    otherTax,
    otherTaxInBase,
    gekap,
    gekapVat,
    gekapWithholding,
    nonScalingTotal: gekap + gekapVat - gekapWithholding,
    vatBase,
    vat,
    withholding,
    total: base + excise + otherTax + gekap + vat - withholding,
  }
}

/** Fatura genelinde satır vergilerinin toplamı. `addLineTax` ile biriktirilir. */
export type LineTaxSums = {
  /** Mal/hizmet net toplamı (satır iskontoları düşülmüş, ÖTV/GEKAP hariç). */
  net: number
  excise: number
  otherTax: number
  otherTaxInBase: number
  gekap: number
  gekapVat: number
  gekapWithholding: number
  vatBase: number
  vat: number
  withholding: number
  total: number
}

export function emptyLineTaxSums(): LineTaxSums {
  return {
    net: 0, excise: 0, otherTax: 0, otherTaxInBase: 0,
    gekap: 0, gekapVat: 0, gekapWithholding: 0,
    vatBase: 0, vat: 0, withholding: 0, total: 0,
  }
}

/** `sums`a bir satırın kırılımını ekler (yerinde günceller) ve onu döndürür. */
export function addLineTax(sums: LineTaxSums, net: number, tax: LineTax): LineTaxSums {
  sums.net += num(net)
  sums.excise += tax.excise
  sums.otherTax += tax.otherTax
  sums.otherTaxInBase += tax.otherTaxInBase
  sums.gekap += tax.gekap
  sums.gekapVat += tax.gekapVat
  sums.gekapWithholding += tax.gekapWithholding
  sums.vatBase += tax.vatBase
  sums.vat += tax.vat
  sums.withholding += tax.withholding
  sums.total += tax.total
  return sums
}

/**
 * Fatura altı iskonto/ilaveyi uygular. Matrah `adjustedNet`e çekilir; ORANSAL
 * kalemler aynı katsayıyla ölçeklenir, MAKTU GEKAP ve ondan doğan KDV/tevkifat
 * ise olduğu gibi korunur.
 *
 * Bu ayrımı çağıranların tek tek yazması, "hangi sabit hangi toplamla eşleşir"
 * hatasına açık bir yerdi — tek yerde tutuluyor.
 */
export function applyGlobalAdjustment(sums: LineTaxSums, adjustedNet: number): LineTaxSums {
  const factor = sums.net > 0 ? num(adjustedNet) / sums.net : 0
  const scale = (total: number, fixed: number) => (total - fixed) * factor + fixed
  const nonScalingTotal = sums.gekap + sums.gekapVat - sums.gekapWithholding
  return {
    net: num(adjustedNet),
    excise: sums.excise * factor,
    otherTax: sums.otherTax * factor,
    otherTaxInBase: sums.otherTaxInBase * factor,
    // Maktu kalemler katsayıdan muaf.
    gekap: sums.gekap,
    gekapVat: sums.gekapVat,
    gekapWithholding: sums.gekapWithholding,
    vatBase: scale(sums.vatBase, sums.gekap),
    vat: scale(sums.vat, sums.gekapVat),
    withholding: scale(sums.withholding, sums.gekapWithholding),
    total: scale(sums.total, nonScalingTotal),
  }
}

/**
 * Satır toplamı net'in AFFİN fonksiyonudur:  toplam(net) = net × f + sabit
 * (sabit = maktu GEKAP ve onun KDV'si; net'ten bağımsız).
 *
 * f'i formülü elle tekrarlamak yerine iki noktadan türetiyoruz —
 * f = toplam(1) − toplam(0). Böylece computeLineTax nasıl değişirse değişsin
 * çarpan onunla otomatik tutarlı kalır (ayrı yazılmış cebirsel kopya sapardı).
 */
export function lineTotalFactor(rates: LineTaxRates): number {
  return computeLineTax(1, rates).total - computeLineTax(0, rates).total
}

/**
 * Kullanıcı "Tutar" (KDV dahil) alanına bir rakam yazdığında satır netini geri
 * çözer:  net = (istenenToplam − sabit) / f.
 *
 * Maktu GEKAP hedefin İÇİNDEDİR ama net'e bağlı değildir; önce düşülür. Hedef
 * tek başına GEKAP'ı bile karşılamıyorsa (ya da çarpan ≤ 0) null döner —
 * çağıran birim fiyata dokunmaz.
 */
export function solveNetFromTotal(desiredTotal: number, rates: LineTaxRates): number | null {
  const fixed = computeLineTax(0, rates).total
  const factor = computeLineTax(1, rates).total - fixed
  if (!(factor > 0)) return null
  const net = (num(desiredTotal) - fixed) / factor
  return Number.isFinite(net) && net >= 0 ? net : null
}
