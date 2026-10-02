/**
 * Satış / alış raporu dışa aktarımı.
 *
 * İki ekran aynı gövdeyi paylaşıyor (tek fark `type`), bu yüzden tek dataset
 * kurucusu iki kayıt olarak sunuluyor.
 */

import { prisma } from "@/lib/db/prisma"
import { computeSalesPurchaseReport, type SalesPurchaseKind } from "@/lib/raporlar/satis-alis"
import { describeLineTotalGap } from "@/lib/raporlar/satis-alis-shared"
import {
  salesPurchaseSections,
  type SalesPurchaseSectionKey,
} from "@/lib/raporlar/satis-alis-sections"
import type { ExportColumn, ExportDataset, ExportSection } from "../types"
import {
  loadExportCompany,
  loadClassificationLabels,
  describeDateRange,
  describeFilters,
} from "./context"
import type { ClassificationLabels } from "@/lib/company/classification-labels"

/**
 * Cari kartındaki tanımlar — hem cari sayfasında hem fatura satırlarında aynı iki
 * sütun. Başlık firmanın verdiği EKSEN adıdır ("Müşteri Tipi"), yoksa
 * "Sınıflandırma 1/2".
 */
const classColumns = (labels: ClassificationLabels): ExportColumn[] => [
  { key: "class1", label: labels.class1, width: 26 },
  { key: "class2", label: labels.class2, width: 26 },
]

const MONTHLY_COLUMNS: ExportColumn[] = [
  { key: "label", label: "Dönem", width: 40 },
  { key: "count", label: "Fatura Adedi", type: "number", width: 30, total: true },
  { key: "amount", label: "Tutar", type: "money", width: 40, total: true },
]

function counterpartyColumns(isSales: boolean, labels: ClassificationLabels): ExportColumn[] {
  return [
    { key: "name", label: isSales ? "Müşteri" : "Tedarikçi", width: 70 },
    ...classColumns(labels),
    { key: "count", label: "Fatura Adedi", type: "number", width: 25, total: true },
    { key: "amount", label: "Tutar", type: "money", width: 35, total: true },
  ]
}

/** Sınıflandırma çifti bazında özet: hangi gruba ne kadar. */
function classGroupColumns(labels: ClassificationLabels): ExportColumn[] {
  return [
    { key: "class1", label: labels.class1, width: 32 },
    { key: "class2", label: labels.class2, width: 32 },
    { key: "count", label: "Fatura Adedi", type: "number", width: 24, total: true },
    { key: "amount", label: "Tutar", type: "money", width: 32, total: true },
  ]
}

function invoiceColumns(isSales: boolean, labels: ClassificationLabels): ExportColumn[] {
  return [
    { key: "date", label: "Tarih", type: "date", width: 22 },
    { key: "invoiceNo", label: "Fatura No", width: 30 },
    { key: "counterpartyName", label: isSales ? "Müşteri" : "Tedarikçi" },
    ...classColumns(labels),
    // İade satırlarının tutarları EKSİ gelir; sütun olmasaydı okuyan kişi
    // negatif rakamı hata sanardı.
    { key: "belge", label: "Belge", width: 18 },
    // Ham kod ("GIB_DRAFT") değil ekrandaki kelime; etiket `lib/invoice/status-label.ts`ten.
    { key: "statusLabel", label: "Durum", width: 22 },
    { key: "netAmount", label: "Matrah", type: "money", width: 26, total: true },
    { key: "vatAmount", label: "KDV", type: "money", width: 24, total: true },
    { key: "totalAmount", label: "Genel Toplam", type: "money", width: 28, total: true },
  ]
}

/**
 * "Detaylı Faturalar" sayfası: her satır bir FATURA KALEMİDİR ve faturanın
 * kimliğini (tarih, no, cari, tanım) tekrar taşır. Satırlar fatura fatura
 * sıralıdır — yani her faturanın altında o faturada satılan stok/hizmetler
 * gelir — ama kimlik tekrarlandığı için Excel'de tek başına süzülüp
 * pivotlanabilir.
 */
function invoiceLineColumns(isSales: boolean, labels: ClassificationLabels): ExportColumn[] {
  return [
    { key: "date", label: "Tarih", type: "date", width: 22 },
    { key: "invoiceNo", label: "Fatura No", width: 30 },
    { key: "eDocumentNo", label: "e-Belge No", width: 30 },
    { key: "counterpartyName", label: isSales ? "Müşteri" : "Tedarikçi" },
    ...classColumns(labels),
    { key: "belge", label: "Belge", width: 18 },
    { key: "productCode", label: "Stok Kodu", width: 24 },
    { key: "description", label: "Stok / Hizmet" },
    { key: "kind", label: "Tür", width: 18 },
    { key: "quantity", label: "Miktar", type: "qty", width: 18, total: true },
    { key: "unit", label: "Birim", width: 14, align: "center" },
    { key: "unitPrice", label: "Birim Fiyat", type: "money", width: 24 },
    { key: "discountAmount", label: "Satır İskontosu", type: "money", width: 24, total: true },
    // Fatura altı iskontonun satıra düşen payı (ilavede eksi); KDV ve satır
    // toplamı bu pay düşülmüş belgedeki tutarlardır — ekranla aynı sütun.
    { key: "globalDiscountShare", label: "Fatura Altı İsk.", type: "money", width: 24, total: true },
    { key: "vatRate", label: "KDV %", type: "number", width: 16 },
    { key: "vatAmount", label: "KDV", type: "money", width: 22, total: true },
    { key: "totalAmount", label: "Satır Toplamı", type: "money", width: 26, total: true },
  ]
}

/**
 * "Alınan Ürünler": ürün başına tek satır (kural lib/raporlar/satis-alis-urunler.ts).
 * Tek tedarikçiye süzülmüşken "son tedarikçi" ve "tedarikçi sayısı" hep aynı
 * cevabı verir; sütunlar o zaman düşer (ekranla aynı).
 */
function productColumns(byParty: boolean): ExportColumn[] {
  return [
    { key: "productCode", label: "Stok Kodu", width: 24 },
    { key: "name", label: "Ürün / Hizmet" },
    { key: "kind", label: "Tür", width: 18 },
    { key: "quantity", label: "Miktar", type: "qty", width: 18 },
    { key: "unit", label: "Birim", width: 14, align: "center" },
    { key: "avgUnitPrice", label: "Ort. Birim Fiyat", type: "money", width: 24 },
    { key: "lastUnitPrice", label: "Son Alış Fiyatı", type: "money", width: 24 },
    { key: "lastDate", label: "Son Alış", type: "date", width: 20 },
    ...(byParty
      ? []
      : ([
          { key: "lastCounterpartyName", label: "Son Tedarikçi" },
          { key: "counterpartyCount", label: "Tedarikçi Sayısı", type: "number", width: 20 },
        ] satisfies ExportColumn[])),
    { key: "invoiceCount", label: "Belge Adedi", type: "number", width: 18 },
    { key: "netAmount", label: "Tutar (KDV Hariç)", type: "money", width: 28, total: true },
    { key: "vatAmount", label: "KDV", type: "money", width: 22, total: true },
    { key: "totalAmount", label: "Toplam (KDV Dahil)", type: "money", width: 28, total: true },
  ]
}

export async function buildSalesPurchaseDataset(params: {
  companyId: string
  type: SalesPurchaseKind
  startDate?: string | null
  endDate?: string | null
  /**
   * TEK bölüm dışa aktarılsın (bölüm anahtarı: `aylik` | `cariler` | `faturalar`
   * | `kalemler`). Bölüm alt sayfasındaki düğme kendi bölümünü gönderir: kullanıcı
   * "Detaylı Faturalar" sayfasında Dışa Aktar'a bastığında dosyada ekrandaki liste
   * olmalı — dört sayfalık raporun içinde aranan bir sekme değil.
   * Verilmezse (özet ekranın düğmesi) dosya dört bölümü birden taşır.
   * Bilinmeyen değer yok sayılır, tam rapora düşer.
   */
  section?: string | null
  /** Ekrandaki sınıflandırma süzgeci — dosya da aynı kesiti üretir. */
  class1Id?: string | null
  class2Id?: string | null
  /** Ekrandaki cari süzgeci (satışta müşteri, alışta tedarikçi id'si). */
  partyId?: string | null
}): Promise<ExportDataset> {
  const isSales = params.type === "SALES"

  // Başlık ve sayfa adları ekranın kartlarıyla AYNI kaynaktan gelir: kullanıcı
  // "Faturalar kartındaki rakam Excel'in hangi sekmesinde" diye sormamalı.
  const sections = salesPurchaseSections(params.type)
  const only = params.section ? (sections.find((s) => s.key === params.section) ?? null) : null

  // Kalem sorgusu fatura sayısıyla büyür; tek bölüm isteniyorsa yalnız o bölüm
  // gerektiriyorsa çekilir.
  const includeLines = only ? only.needsLines : true
  const includeProducts = only ? only.needsProducts : sections.some((s) => s.needsProducts)

  const [company, labels, report, party] = await Promise.all([
    loadExportCompany(params.companyId),
    loadClassificationLabels(params.companyId),
    computeSalesPurchaseReport({
      companyId: params.companyId,
      type: params.type,
      startDate: params.startDate,
      endDate: params.endDate,
      includeLines,
      includeProducts,
      class1Id: params.class1Id,
      class2Id: params.class2Id,
      partyId: params.partyId,
    }),
    // Künyede carinin ADI yazılsın: dönemde faturası yoksa rapordan çıkarılamaz.
    params.partyId
      ? isSales
        ? prisma.customer.findFirst({ where: { id: params.partyId, companyId: params.companyId }, select: { name: true } })
        : prisma.supplier.findFirst({ where: { id: params.partyId, companyId: params.companyId }, select: { name: true } })
      : null,
  ])

  // Kalem sayfasının toplamı fatura sayfasınınkini tutmayabilir (belge
  // yuvarlaması, kalemleriyle uyuşmayan belge). Sessiz bırakmak "rakamlar
  // tutmuyor" sorusunu doğurduğu için dosyaya not olarak yazılır — künye
  // sayfasında ve PDF'in altında görünür.
  const gap = includeLines || includeProducts ? describeLineTotalGap(report) : null
  // Notun hangi sayfaya ait olduğu: ürün sayfası da kalem toplamından kurulur.
  const gapLabel = only?.key === "urunler" ? "Alınan Ürünler" : includeProducts ? "Alınan Ürünler ve Detaylı Faturalar" : "Detaylı Faturalar"

  const reportTitle = isSales ? "Satış Raporu" : "Alış Raporu"
  // Tek bölümlük dosyanın ADI da bölümü söyler: indirilen dosya
  // "Satis_Raporu_Detayli_Faturalar_<firma>_<tarih>.xlsx".
  const title = only ? `${reportTitle} — ${only.title}` : reportTitle

  const buildSection = (key: SalesPurchaseSectionKey): ExportSection => {
    const section = sections.find((s) => s.key === key)!
    const meta = { title: section.title, sheetName: section.sheetName }
    switch (key) {
      case "urunler":
        return { ...meta, columns: productColumns(Boolean(params.partyId)), rows: report.products }
      case "aylik":
        return { ...meta, columns: MONTHLY_COLUMNS, rows: report.monthly }
      case "cariler":
        return { ...meta, columns: counterpartyColumns(isSales, labels), rows: report.topCounterparties }
      case "siniflandirma":
        return {
          ...meta,
          columns: classGroupColumns(labels),
          rows: report.classGroups.map((row) => ({
            ...row,
            // Boş tanım "—" yazılır: kaç TL'nin sınıflandırılmadığı görünsün.
            class1: row.class1 || "—",
            class2: row.class2 || "—",
          })),
        }
      case "faturalar":
        return {
          ...meta,
          columns: invoiceColumns(isSales, labels),
          rows: report.invoices.map((inv) => ({
            ...inv,
            belge: inv.isReturn ? "İade" : isSales ? "Satış" : "Alış",
          })),
        }
      case "kalemler":
        return {
          ...meta,
          columns: invoiceLineColumns(isSales, labels),
          rows: report.lines.map((line) => ({
            ...line,
            belge: line.isReturn ? "İade" : isSales ? "Satış" : "Alış",
          })),
        }
    }
  }

  return {
    title,
    company,
    filters: describeFilters([
      ["Dönem", describeDateRange(params.startDate, params.endDate) ?? "Tüm kayıtlar"],
      [isSales ? "Müşteri" : "Tedarikçi", party?.name ?? null],
      ["Fatura adedi", report.count],
      ["İade adedi", report.invoices.filter((i) => i.isReturn).length],
      // Kalem adedi yalnız kalemler ÇEKİLDİYSE yazılır; çekilmemişken "0" basmak
      // dosyayı okuyan kişiye "hiç kalem yok" dedirtirdi.
      ["Kalem adedi", includeLines ? report.lines.length : null],
      ["Ürün çeşidi", includeProducts ? report.products.length : null],
      [isSales ? "Toplam ciro" : "Toplam alış", report.totalAmount.toLocaleString("tr-TR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })],
    ]),
    sections: (only ? [only.key] : sections.map((s) => s.key)).map(buildSection),
    note: gap ? `${gapLabel}: ${gap.text}` : undefined,
    generatedAt: new Date(),
  }
}
