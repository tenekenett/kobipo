/**
 * Vergi beyanname hazırlık raporu dışa aktarımı — KDV + Muhtasar tek belgede.
 *
 * Ekranda iki bölüm var ama ikisi de aynı dönemin (yıl/ay) parçaları; muhasebeciye
 * gönderilirken ayrı dosyalar değil tek dosya isteniyor. Ekranla aynı
 * fonksiyonlardan beslenir (`lib/raporlar/vergiler.ts`) ve aynı uyarıları yazar:
 * dosyayı alan muhasebeci, ekrandaki kullanıcının gördüğü eksikleri görmeli.
 */

import {
  computeMuhtasar,
  computeVatChecklist,
  computeVatDeclaration,
} from "@/lib/raporlar/vergiler"
import { AY_ADLARI, BEYAN_GUNU, MUHTASAR_GUNU, beyanTarihi } from "@/lib/raporlar/beyan-takvimi"
import type { ExportColumn, ExportDataset, ExportRow, ExportSection } from "../types"
import { loadExportCompany, describeFilters } from "./context"

const VAT_RATE_COLUMNS: ExportColumn[] = [
  { key: "vatRate", label: "KDV Oranı", type: "percent", width: 24 },
  { key: "base", label: "Matrah (KDV hariç)", type: "money", width: 40, total: true },
  { key: "vatAmount", label: "KDV", type: "money", width: 36, total: true },
  { key: "withheld", label: "Tevkif Edilen", type: "money", width: 36, total: true },
]

const LABEL_AMOUNT: ExportColumn[] = [
  { key: "label", label: "Kalem", width: 90 },
  { key: "amount", label: "Tutar", type: "money", width: 40 },
]

const tl = (n: number) => n.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export async function buildTaxReportDataset(params: {
  companyId: string
  year: number
  month: number
  /** Kişi başı maaş dökümü — yalnız Maaş sayfasını açabilene (bkz. index.ts). */
  calisanDetayi: boolean
}): Promise<ExportDataset> {
  const donem = { companyId: params.companyId, year: params.year, month: params.month }
  const [company, vat, kontrol, muhtasar] = await Promise.all([
    loadExportCompany(params.companyId),
    computeVatDeclaration({ ...donem, period: "monthly" }),
    computeVatChecklist(donem),
    computeMuhtasar({ ...donem, calisanDetayi: params.calisanDetayi }),
  ])

  // ── KDV özeti: ekrandaki denklemle aynı sıra ────────────────────────────
  const kdvRows: ExportRow[] = []
  if (vat.withholding.sales !== 0) {
    kdvRows.push(
      { label: "Satışlardaki KDV", amount: vat.calculatedVAT + vat.withholding.sales },
      { label: "− Alıcının tevkif ettiği KDV (alıcı KDV-2 ile öder)", amount: vat.withholding.sales },
    )
  }
  kdvRows.push(
    { label: "Hesaplanan KDV (satışlar)", amount: vat.calculatedVAT },
    { label: "İndirilecek KDV (alışlar)", amount: vat.deductibleVAT },
    { label: vat.netVAT >= 0 ? "ÖDENECEK KDV" : "SONRAKİ AYA DEVREDEN KDV", amount: Math.abs(vat.netVAT) },
  )
  if (vat.withholding.purchases !== 0) {
    kdvRows.push({
      label: "Ayrıca KDV-2 ile ödenecek (alışlarda tevkif ettiğimiz KDV)",
      amount: vat.withholding.purchases,
    })
  }
  // Uyarılar — tutar sütunu boş; muhasebeci eksikleri dosyadan da görmeli.
  const uyari = (label: string): ExportRow => ({ label: `UYARI: ${label}`, amount: null })
  if (vat.unconvertedForeign > 0) {
    kdvRows.push(uyari(`${vat.unconvertedForeign} dövizli faturanın kuru girilmemiş — yukarıdaki toplamlara dahil değil`))
  }
  if (kontrol.aktarilmamis.adet > 0) {
    kdvRows.push(
      uyari(
        `${kontrol.aktarilmamis.adet} gelen e-fatura alış faturasına aktarılmamış (KDV ${tl(kontrol.aktarilmamis.kdv)} TL) — indirilecek KDV'ye girmedi`,
      ),
    )
  }
  if (kontrol.aktarilmamis.dovizli > 0) {
    kdvRows.push(uyari(`${kontrol.aktarilmamis.dovizli} dövizli gelen e-fatura alışa aktarılmamış`))
  }
  if (kontrol.gonderilmemis.adet > 0) {
    kdvRows.push(
      uyari(
        `${kontrol.gonderilmemis.adet} e-Fatura/e-Arşiv GİB'e gönderilmemiş (KDV ${tl(kontrol.gonderilmemis.kdv)} TL) — gönderilene kadar sayılmaz`,
      ),
    )
  }
  kdvRows.push({
    label: "Dahil değil: önceki dönemden devreden KDV, istisnalar, KDV iadesi",
    amount: null,
  })

  // ── Muhtasar (bordrodan) ─────────────────────────────────────────────────
  const muhtasarRows: ExportRow[] = [
    { label: `Bordro sayısı: ${muhtasar.bordroSayisi}`, amount: null },
    { label: "Brüt ücretler (prim dahil)", amount: muhtasar.brut },
    { label: "Gelir vergisi + damga vergisi (çalışandan kesilen)", amount: muhtasar.gelirDamga },
    { label: "SGK + işsizlik işçi payı", amount: muhtasar.sgkIsci },
    { label: "Net ödenecek ücretler", amount: muhtasar.net },
  ]
  if (muhtasar.bordrosuz.sayi > 0) {
    const adlar = muhtasar.bordrosuz.adlar?.length ? ` (${muhtasar.bordrosuz.adlar.join(", ")})` : ""
    muhtasarRows.push(
      uyari(`${muhtasar.bordrosuz.sayi} çalışanın bu ay bordrosu girilmemiş${adlar} — rakamlar onlarsız`),
    )
  }
  muhtasarRows.push({
    label: "Dahil değil: işveren SGK payı ve teşvikler, kira ve serbest meslek stopajı",
    amount: null,
  })

  const sections: ExportSection[] = [
    { title: "KDV Özeti", sheetName: "KDV Özeti", columns: LABEL_AMOUNT, totals: null, rows: kdvRows },
    {
      title: "KDV — Satışlar (oranlara göre)",
      sheetName: "KDV Satış",
      columns: VAT_RATE_COLUMNS,
      rows: vat.breakdown.sales,
    },
    {
      title: "KDV — Alışlar (oranlara göre)",
      sheetName: "KDV Alış",
      columns: VAT_RATE_COLUMNS,
      rows: vat.breakdown.purchases,
    },
    {
      title: "Muhtasar — Özet (bordrolardan)",
      sheetName: "Muhtasar",
      columns: LABEL_AMOUNT,
      totals: null,
      rows: muhtasarRows,
    },
  ]

  if (muhtasar.calisanlar) {
    sections.push({
      title: "Muhtasar — Çalışanlar",
      sheetName: "Muhtasar Çalışanlar",
      columns: [
        { key: "ad", label: "Çalışan", width: 60 },
        { key: "brut", label: "Brüt", type: "money", width: 32, total: true },
        { key: "sgkIsci", label: "SGK İşçi Payı", type: "money", width: 32, total: true },
        { key: "gelirDamga", label: "Gelir + Damga V.", type: "money", width: 32, total: true },
        { key: "net", label: "Net", type: "money", width: 32, total: true },
        { key: "durum", label: "Ödeme", width: 22 },
      ],
      rows: muhtasar.calisanlar.map((c) => ({ ...c, durum: c.odendi ? "Ödendi" : "Bekliyor" })),
    })
  }

  const kdvSon = beyanTarihi(params.year, params.month, BEYAN_GUNU)
  const muhSon = beyanTarihi(params.year, params.month, MUHTASAR_GUNU)
  return {
    title: "Vergi Beyanname Raporu",
    company,
    filters: describeFilters([
      ["Dönem", `${AY_ADLARI[params.month - 1] ?? params.month} ${params.year}`],
      ["Muhtasar son gün", `${muhSon.tarih} ${muhSon.haftaGunu}`],
      ["KDV son gün", `${kdvSon.tarih} ${kdvSon.haftaGunu}`],
    ]),
    sections,
    generatedAt: new Date(),
  }
}
