/**
 * Rapor dışa aktarımları.
 *
 * Her rapor kendi hesabını `lib/raporlar/*` ya da mevcut sorgu katmanı
 * üzerinden alır — dışa aktarma hiçbir yerde kendi hesabını yapmaz. Aksi halde
 * ekranda 100.000 TL net kâr, PDF'te 98.400 TL çıkar ve hangisinin doğru
 * olduğunu kimse bilemez.
 */

import { prisma } from "@/lib/db/prisma"
import { resolveAllUnitCosts } from "@/lib/stock/cost"
import { computeCariAging, type AgingAccount } from "@/lib/raporlar/cari-yaslandirma"
import { buildPaymentPlan, resolvePlanMonth } from "@/lib/raporlar/cari-yaslandirma-plan"
import { computeProfitLoss } from "@/lib/raporlar/kar-zarar"
import {
  computeStockMovementReport,
  type StockMovementFilters,
} from "@/lib/raporlar/stok-hareket"
import type { ExportColumn, ExportDataset, ExportRow, ExportSection } from "../types"
import {
  loadExportCompany,
  loadClassificationLabels,
  describeDateRange,
  describeFilters,
} from "./context"
import type { ClassificationLabels } from "@/lib/company/classification-labels"
import {
  AGING_BUCKETS,
  AGING_BUCKET_LABEL,
  DUE_WINDOWS,
  DUE_WINDOW_LABEL,
} from "@/lib/raporlar/cari-yaslandirma-buckets"

// --------------------------- STOK RAPORU ---------------------------

const STOCK_COLUMNS: ExportColumn[] = [
  { key: "code", label: "Kod", width: 22 },
  { key: "name", label: "Ürün Adı" },
  { key: "barcode", label: "Barkod", width: 26 },
  { key: "unit", label: "Birim", width: 14, align: "center" },
  { key: "stockQuantity", label: "Stok", type: "qty", width: 20 },
  { key: "minStockLevel", label: "Min.", type: "qty", width: 16 },
  { key: "statusLabel", label: "Durum", width: 20 },
  { key: "purchasePrice", label: "Alış", type: "money", width: 20 },
  { key: "salePrice", label: "Satış", type: "money", width: 20 },
  { key: "stockValue", label: "Stok Maliyeti", type: "money", width: 24, total: true },
  { key: "saleValue", label: "Stok Satış Değeri", type: "money", width: 26, total: true },
]

export type StockReportParams = {
  companyId: string
  search?: string | null
  /** "ALL" | "PRODUCT" | "SERVICE" */
  type?: string | null
  /** "ALL" | "LOW" | "OUT" | "NORMAL" */
  stock?: string | null
}

/** `/raporlar/stok` ekranındaki `stockStatus` ile birebir aynı kural. */
function stockStatusLabel(isService: boolean, quantity: number, minimum: number): string {
  if (isService) return "Hizmet"
  if (quantity <= 0) return "Stok Yok"
  if (minimum > 0 && quantity <= minimum) return "Kritik"
  return "Normal"
}

export async function buildStockReportDataset(params: StockReportParams): Promise<ExportDataset> {
  const [company, products, costByProduct] = await Promise.all([
    loadExportCompany(params.companyId),
    prisma.product.findMany({ where: { companyId: params.companyId }, orderBy: { name: "asc" } }),
    resolveAllUnitCosts(params.companyId),
  ])

  const typeFilter = params.type || "ALL"
  const stockFilter = params.stock || "ALL"
  const search = (params.search || "").toLowerCase()

  const filtered = products.filter((product) => {
    if (typeFilter === "PRODUCT" && product.isService) return false
    if (typeFilter === "SERVICE" && !product.isService) return false

    const quantity = Number(product.stockQuantity || 0)
    const minimum = Number(product.minStockLevel || 0)
    if (stockFilter === "OUT" && quantity > 0) return false
    if (stockFilter === "LOW" && !(minimum > 0 && quantity > 0 && quantity <= minimum)) return false
    if (stockFilter === "NORMAL" && (quantity <= 0 || (minimum > 0 && quantity <= minimum))) return false

    if (search) {
      const hit =
        product.name.toLowerCase().includes(search) ||
        (product.code || "").toLowerCase().includes(search) ||
        (product.barcode || "").toLowerCase().includes(search)
      if (!hit) return false
    }
    return true
  })

  const rows: ExportRow[] = filtered.map((product) => {
    const quantity = Number(product.stockQuantity || 0)
    const minimum = Number(product.minStockLevel || 0)
    const purchase = product.purchasePrice === null ? null : Number(product.purchasePrice)
    const sale = product.salePrice === null ? null : Number(product.salePrice)
    const unitCost = costByProduct.get(product.id) ?? purchase
    return {
      code: product.code,
      name: product.name,
      barcode: product.barcode,
      unit: product.unit,
      stockQuantity: product.isService ? null : quantity,
      minStockLevel: product.minStockLevel,
      statusLabel: stockStatusLabel(product.isService, quantity, minimum),
      purchasePrice: purchase,
      salePrice: sale,
      stockValue: product.isService || unitCost === null ? null : quantity * unitCost,
      saleValue: product.isService || sale === null ? null : quantity * sale,
    }
  })

  // Özet — ekrandaki kartların aynısı. PDF'i açan kişi tek bakışta durumu görsün.
  const onlyProducts = products.filter((product) => !product.isService)
  // Satırlarla AYNI ölçü: ortalama maliyet, yoksa kartın alış fiyatı. Eskiden
  // satırlar AVCO'dan, özet ham `purchasePrice`tan hesaplanıyordu — PDF'in
  // toplamı, üstündeki satırların toplamını tutmuyordu.
  const totalStockValue = onlyProducts.reduce(
    (sum, product) =>
      sum +
      Number(product.stockQuantity || 0) *
        (costByProduct.get(product.id) ?? Number(product.purchasePrice || 0)),
    0,
  )
  const totalSaleValue = onlyProducts.reduce(
    (sum, product) => sum + Number(product.stockQuantity || 0) * Number(product.salePrice || 0),
    0,
  )
  const summary: ExportSection = {
    title: "Özet",
    sheetName: "Özet",
    columns: [
      { key: "metric", label: "Gösterge", width: 60 },
      { key: "value", label: "Değer", type: "money", width: 40 },
    ],
    totals: null,
    rows: [
      { metric: "Ürün adedi", value: onlyProducts.length },
      { metric: "Hizmet adedi", value: products.length - onlyProducts.length },
      { metric: "Toplam stok maliyeti", value: totalStockValue },
      { metric: "Toplam stok satış değeri", value: totalSaleValue },
      { metric: "Potansiyel kâr", value: totalSaleValue - totalStockValue },
      {
        metric: "Kritik seviyedeki ürün",
        value: onlyProducts.filter((product) => {
          const quantity = Number(product.stockQuantity || 0)
          const minimum = Number(product.minStockLevel || 0)
          return minimum > 0 && quantity <= minimum && quantity > 0
        }).length,
      },
      {
        metric: "Stoğu tükenen ürün",
        value: onlyProducts.filter((product) => Number(product.stockQuantity || 0) <= 0).length,
      },
    ],
  }

  return {
    title: "Stok Raporu",
    company,
    filters: describeFilters([
      ["Arama", params.search],
      ["Tür", typeFilter === "PRODUCT" ? "Ürün" : typeFilter === "SERVICE" ? "Hizmet" : null],
      [
        "Stok durumu",
        stockFilter === "LOW"
          ? "Kritik"
          : stockFilter === "OUT"
            ? "Stok yok"
            : stockFilter === "NORMAL"
              ? "Normal"
              : null,
      ],
    ]),
    sections: [summary, { title: "Ürünler", sheetName: "Ürünler", columns: STOCK_COLUMNS, rows }],
    generatedAt: new Date(),
  }
}

// --------------------------- STOK HAREKETLERİ ---------------------------

const stockMovementColumns = (labels: ClassificationLabels): ExportColumn[] => [
  { key: "date", label: "Tarih", type: "datetime", width: 26 },
  { key: "typeLabel", label: "Hareket", width: 18 },
  { key: "productCode", label: "Ürün Kodu", width: 22 },
  { key: "productName", label: "Ürün" },
  { key: "warehouseName", label: "Depo", width: 24 },
  { key: "documentNo", label: "Belge No", width: 28 },
  { key: "counterpartyName", label: "Cari", width: 40 },
  { key: "class1", label: labels.class1, width: 26 },
  { key: "class2", label: labels.class2, width: 26 },
  { key: "quantity", label: "Miktar", type: "qty", width: 20, total: true },
  { key: "unit", label: "Birim", width: 14, align: "center" },
  { key: "unitPrice", label: "Birim Fiyat", type: "money", width: 24 },
  { key: "totalAmount", label: "Tutar", type: "money", width: 26, total: true },
  { key: "description", label: "Açıklama" },
]

export async function buildStockMovementDataset(
  params: StockMovementFilters
): Promise<ExportDataset> {
  const [company, labels, report] = await Promise.all([
    loadExportCompany(params.companyId),
    loadClassificationLabels(params.companyId),
    computeStockMovementReport(params),
  ])

  return {
    title: "Stok Hareketleri",
    company,
    filters: describeFilters([
      ["Dönem", describeDateRange(params.startDate, params.endDate) ?? "Tüm kayıtlar"],
      ["Hareket adedi", report.totals.count],
      ["Toplam giriş", report.totals.totalIn],
      ["Toplam çıkış", report.totals.totalOut],
    ]),
    sections: [
      {
        title: "Stok Hareketleri",
        sheetName: "Hareketler",
        columns: stockMovementColumns(labels),
        rows: report.rows,
      },
    ],
    generatedAt: new Date(),
  }
}

// --------------------------- CARİ YAŞLANDIRMA ---------------------------

const agingColumns = (labels: ClassificationLabels): ExportColumn[] => [
  { key: "code", label: "Kod", width: 22 },
  { key: "name", label: "Ünvan" },
  // Tanımlar: cari kartındaki sınıflandırmalar (Ayarlar → Tanımlar); ekranda da
  // aynı iki sütun var.
  { key: "class1", label: labels.class1, width: 26 },
  { key: "class2", label: labels.class2, width: 26 },
  { key: "taxNumber", label: "VKN/TCKN", width: 26 },
  { key: "paymentDueDays", label: "Vade (gün)", type: "number", width: 20 },
  // Kova/pencere sütunları ekranla AYNI listeden doğar
  // (`cari-yaslandirma-buckets.ts`): başlıklar burada elle yazılıyordu, kova
  // eklendiğinde ikisi ayrışırdı.
  //
  // Dosya HER İKİ EKSENİ de taşır: ekranda gecikme yaşı kolonları yer darlığı
  // yüzünden tek "Vadesi Geçmiş"e toplandı, Excel'de böyle bir kısıt yok ve
  // yaşlandırma dosyasının asıl kullanımı zaten yaş kırılımını süzmek.
  // `not_due` kolonu YOK: dört pencere onu tam olarak bölüyor (pencerelerin
  // toplamı = vadesi gelmemiş). İkisi yan yana dursaydı satırı soldan sağa
  // toplayan okuyucu aynı parayı iki kez sayardı. Kalan kolonlar toplamı
  // ÖRTÜŞMEDEN böler: gecikme yaşı + pencereler + vade tanımsız = toplam açık.
  ...AGING_BUCKETS.filter((bucket) => bucket !== "not_due").map((bucket) => ({
    key: bucket,
    label: AGING_BUCKET_LABEL[bucket],
    type: "money" as const,
    width: 26,
    total: true,
  })),
  ...DUE_WINDOWS.map((window) => ({
    key: window,
    label: DUE_WINDOW_LABEL[window],
    type: "money" as const,
    width: 26,
    total: true,
  })),
  { key: "overdue", label: "Vadesi Geçmiş (toplam)", type: "money" as const, width: 30, total: true },
  { key: "offsetCredit", label: "Mahsup (karşı belge)", type: "money", width: 30, total: true },
  { key: "overdueAvgDays", label: "Ort. Gecikme (gün)", type: "number", width: 26 },
  { key: "total", label: "Toplam Açık", type: "money", width: 26, total: true },
  { key: "performanceLabel", label: "Ödeme Davranışı", width: 26 },
  { key: "performanceScore", label: "Skor", type: "number", width: 16 },
]

/**
 * "Ödeme Planı" sayfası: ay üç on günlük dilime bölünür, vadesi o dilime düşen
 * açık tutarlar cari (firma) bazında toplanır. Geçmiş ve sonraki aylara düşen
 * tutarlar ayrı sütunlarda durur — üç dilimin toplamı tek başına toplam açığı
 * vermez.
 *
 * "Geçmiş Aylar" başlığı bilinçli: yaşlandırma sayfalarındaki "Vadesi Geçmiş"
 * bugüne göre ölçülür, burası ayın 1'ine göre. Aynı başlık kullanılsaydı tek
 * çalışma kitabında aynı cari için iki farklı sayı görünürdü.
 */
function paymentPlanSection(
  title: string,
  sheetName: string,
  accounts: AgingAccount[],
  labels: ClassificationLabels,
  /** Hangi ay bölünecek — ekranda seçilen ay dosyaya da geçer. */
  planMonth: Date
): ExportSection {
  const plan = buildPaymentPlan(accounts, planMonth)
  return {
    title,
    sheetName,
    columns: [
      { key: "code", label: "Kod", width: 22 },
      { key: "name", label: "Ünvan" },
      { key: "class1", label: labels.class1, width: 26 },
      { key: "class2", label: labels.class2, width: 26 },
      // Vadesi tanımsız tutar: dilimlere giremez, ekrandaki "Vade Tanımsız" ile aynı para.
      { key: "noDue", label: "Vade Tanımsız", type: "money", width: 26, total: true },
      { key: "pastMonths", label: "Geçmiş Aylar", type: "money", width: 26, total: true },
      { key: "period1", label: plan.labels.period1, type: "money", width: 26, total: true },
      { key: "period2", label: plan.labels.period2, type: "money", width: 26, total: true },
      { key: "period3", label: plan.labels.period3, type: "money", width: 26, total: true },
      { key: "monthTotal", label: "Bu Ay Toplam", type: "money", width: 26, total: true },
      { key: "nextMonths", label: "Sonraki Aylar", type: "money", width: 26, total: true },
      { key: "total", label: "Toplam Açık", type: "money", width: 26, total: true },
    ],
    rows: plan.rows,
  }
}

export async function buildAgingReportDataset(params: {
  companyId: string
  /** Ekrandaki anahtarla aynı: satış taslakları sayılsın mı. */
  includeDrafts?: boolean
  /** Plan sayfalarının böleceği ay (`YYYY-MM`); yoksa içinde bulunulan ay. */
  planMonth?: string | null
}): Promise<ExportDataset> {
  const planMonth = resolvePlanMonth(params.planMonth)
  const [company, labels, aging] = await Promise.all([
    loadExportCompany(params.companyId),
    loadClassificationLabels(params.companyId),
    computeCariAging(params.companyId, { includeDrafts: params.includeDrafts }),
  ])

  const toRows = (accounts: typeof aging.customers.accounts): ExportRow[] =>
    accounts.map((account) => ({
      code: account.code,
      name: account.name,
      class1: account.class1,
      class2: account.class2,
      taxNumber: account.taxNumber,
      paymentDueDays: account.paymentDueDays,
      // İKİ EKSEN de yazılır: kolon listesi ikisini de içeriyor, satır yalnız
      // kovaları taşısaydı pencere kolonları boş çıkardı.
      ...Object.fromEntries(AGING_BUCKETS.map((bucket) => [bucket, account.totals[bucket]])),
      ...Object.fromEntries(DUE_WINDOWS.map((window) => [window, account.totals[window]])),
      overdue: account.totals.overdue,
      offsetCredit: account.totals.offsetCredit,
      overdueAvgDays: account.totals.overdueAvgDays,
      total: account.totals.total,
      performanceLabel: account.totals.performanceLabel,
      performanceScore: account.totals.performanceScore,
    }))

  return {
    title: "Cari Yaşlandırma",
    company,
    filters: describeFilters([
      ["Rapor tarihi", new Date().toLocaleDateString("tr-TR")],
      // Dosyayı okuyan kişi hangi kesitten üretildiğini bilmeli.
      // Dosyayı okuyan kişi hangi ayın planına baktığını bilmeli.
      ["Plan ayı", planMonth.toLocaleDateString("tr-TR", { month: "long", year: "numeric" })],
      [
        "Satış taslakları",
        params.includeDrafts
          ? "dahil"
          : aging.excludedDrafts.count > 0
            ? `hariç (${aging.excludedDrafts.count} belge, ${aging.excludedDrafts.amount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL sayılmadı)`
            : "hariç",
      ],
    ]),
    sections: [
      {
        title: "Müşteriler (Alacaklar)",
        sheetName: "Alacaklar",
        columns: agingColumns(labels),
        rows: toRows(aging.customers.accounts),
      },
      {
        title: "Tedarikçiler (Borçlar)",
        sheetName: "Borçlar",
        columns: agingColumns(labels),
        rows: toRows(aging.suppliers.accounts),
      },
      paymentPlanSection("Beklenen Tahsilatlar (Ay İçi Plan)", "Tahsilat Planı", aging.customers.accounts, labels, planMonth),
      paymentPlanSection("Beklenen Ödemeler (Ay İçi Plan)", "Ödeme Planı", aging.suppliers.accounts, labels, planMonth),
    ],
    generatedAt: new Date(),
  }
}

// --------------------------- KAR / ZARAR ---------------------------

export type ProfitLossExportParams = {
  companyId: string
  startDate?: string | null
  endDate?: string | null
}

export async function buildProfitLossDataset(params: ProfitLossExportParams): Promise<ExportDataset> {
  const [company, report] = await Promise.all([
    loadExportCompany(params.companyId),
    computeProfitLoss(params),
  ])

  const columns: ExportColumn[] = [
    { key: "label", label: "Kalem", width: 90 },
    { key: "amount", label: "Tutar", type: "money", width: 45 },
  ]

  return {
    title: "Kar-Zarar Tablosu",
    company,
    orientation: "portrait",
    filters: describeFilters([
      ["Dönem", describeDateRange(report.period.startDate, report.period.endDate)],
    ]),
    sections: [
      {
        title: "Gelirler",
        sheetName: "Gelirler",
        columns,
        totals: { label: "Toplam Gelir", amount: report.revenue.total },
        // İade satırı ATLANMAMALI: toplam iadeyi düşerek bulunuyor, satırlar
        // arasında görünmezse dosyada "kalemler toplamı başlığı tutmuyor" olur.
        rows: [
          { label: "Satış gelirleri (fatura matrahı)", amount: report.revenue.sales },
          { label: "Satış iadeleri (−)", amount: -report.revenue.returns },
          { label: "Diğer gelirler (faturasız)", amount: report.revenue.other },
        ],
      },
      {
        title: "Giderler",
        sheetName: "Giderler",
        columns,
        totals: {
          label: "Toplam Gider",
          amount: report.purchases.total + report.otherExpenses,
        },
        rows: [
          { label: "Alışlar (alış faturası matrahı)", amount: report.purchases.invoices },
          { label: "Alış iadeleri (−)", amount: -report.purchases.returns },
          { label: "Diğer giderler (faturasız)", amount: report.otherExpenses },
        ],
      },
      {
        title: "Sonuç",
        sheetName: "Sonuç",
        columns,
        totals: null,
        rows: [
          { label: "Brüt kâr (gelir − alışlar)", amount: report.grossProfit },
          { label: "Diğer giderler (faturasız)", amount: report.otherExpenses },
          { label: "NET KÂR / ZARAR", amount: report.netProfit },
        ],
      },
    ],
    generatedAt: new Date(),
  }
}
