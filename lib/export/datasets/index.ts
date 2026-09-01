/**
 * Dışa aktarılabilir veri kümelerinin kaydı.
 *
 * Yeni bir ekrana dışa aktarma eklemek = buraya bir satır + bir `build*`
 * fonksiyonu. Route, UI bileşeni ve formatlar dokunulmadan çalışır.
 */

import type { ExportDataset } from "../types"
import { buildProductsDataset } from "./products"
import { buildCariDataset } from "./cari"
import { buildEkstreDataset } from "./ekstre"
import { buildInvoicesDataset } from "./invoices"
import { buildIncomingInvoicesDataset } from "./gelen-e-faturalar"
import {
  buildAgingReportDataset,
  buildProfitLossDataset,
  buildStockMovementDataset,
  buildStockReportDataset,
} from "./reports"
import { buildBalanceSheetDataset, buildCashFlowDataset } from "./reports-finansal"
import { buildSalesPurchaseDataset } from "./reports-satis-alis"
import { buildHrReportDataset } from "./reports-personel"
import { buildPuantajDataset } from "./personel-puantaj"
import { buildVardiyaPlanDataset } from "./personel-vardiya"
import { buildTaxReportDataset } from "./reports-vergi"
import { todayIso, weekStartIso } from "@/lib/personel/vardiya"

/** `year`/`month` gibi sayısal paramlar için ortak çözücü. */
function num(params: URLSearchParams, key: string, fallback: number): number {
  const parsed = Number(params.get(key))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

type Params = URLSearchParams

export type DatasetBuilder = (companyId: string, params: Params) => Promise<ExportDataset>

export const DATASETS: Record<string, DatasetBuilder> = {
  products: (companyId, params) =>
    buildProductsDataset({
      companyId,
      search: params.get("search"),
      category: params.get("category"),
      kind: params.get("kind"),
      warehouseId: params.get("warehouseId"),
      lowStock: params.get("lowStock"),
      isService: params.get("isService"),
      isSellable: params.get("isSellable"),
      isIngredient: params.get("isIngredient"),
    }),

  cari: (companyId, params) =>
    buildCariDataset({ companyId, search: params.get("search"), tab: params.get("tab") }),

  ekstre: (companyId, params) =>
    buildEkstreDataset({
      companyId,
      customerId: params.get("customerId"),
      supplierId: params.get("supplierId"),
      startDate: params.get("startDate"),
      endDate: params.get("endDate"),
    }),

  invoices: (companyId, params) =>
    buildInvoicesDataset({
      companyId,
      direction: params.get("direction"),
      includeInbox: params.get("includeInbox"),
      days: params.get("days"),
      startDate: params.get("startDate"),
      endDate: params.get("endDate"),
      status: params.get("status"),
      search: params.get("search"),
      category: params.get("category"),
      counterparty: params.get("counterparty"),
      taxNumber: params.get("taxNumber"),
      minAmount: params.get("minAmount"),
      maxAmount: params.get("maxAmount"),
    }),

  // Filtreler listenin query paramlarıyla birebir aynı; ortak sorgu modülü
  // (incoming-list-query.ts) ikisini de okuduğu için paramları olduğu gibi geçiyoruz.
  "gelen-e-faturalar": (companyId, params) =>
    buildIncomingInvoicesDataset({ companyId, searchParams: params }),

  "rapor-stok": (companyId, params) =>
    buildStockReportDataset({
      companyId,
      search: params.get("search"),
      type: params.get("type"),
      stock: params.get("stock"),
    }),

  "rapor-stok-hareket": (companyId, params) =>
    buildStockMovementDataset({
      companyId,
      startDate: params.get("startDate"),
      endDate: params.get("endDate"),
      customerId: params.get("customerId"),
      supplierId: params.get("supplierId"),
      class1Id: params.get("class1Id"),
      class2Id: params.get("class2Id"),
      productId: params.get("productId"),
      search: params.get("search"),
    }),

  "rapor-cari-yaslandirma": (companyId) => buildAgingReportDataset({ companyId }),

  "rapor-kar-zarar": (companyId, params) =>
    buildProfitLossDataset({
      companyId,
      startDate: params.get("startDate"),
      endDate: params.get("endDate"),
    }),

  "rapor-bilanco": (companyId, params) =>
    buildBalanceSheetDataset({ companyId, asOfDate: params.get("asOfDate") }),

  "rapor-nakit-akisi": (companyId, params) =>
    buildCashFlowDataset({
      companyId,
      startDate: params.get("startDate"),
      endDate: params.get("endDate"),
    }),

  // `section` verilirse dosya YALNIZ o bölümü taşır (bölüm alt sayfasındaki
  // düğme kendi anahtarını gönderir); verilmezse dört bölümlük tam rapor.
  "rapor-satis": (companyId, params) =>
    buildSalesPurchaseDataset({
      companyId,
      type: "SALES",
      startDate: params.get("startDate"),
      endDate: params.get("endDate"),
      section: params.get("section"),
    }),

  "rapor-alis": (companyId, params) =>
    buildSalesPurchaseDataset({
      companyId,
      type: "PURCHASE",
      startDate: params.get("startDate"),
      endDate: params.get("endDate"),
      section: params.get("section"),
    }),

  "rapor-personel": (companyId, params) =>
    buildHrReportDataset({ companyId, year: num(params, "year", new Date().getFullYear()) }),

  "personel-puantaj": (companyId, params) =>
    buildPuantajDataset({
      companyId,
      year: num(params, "year", new Date().getFullYear()),
      month: num(params, "month", new Date().getMonth() + 1),
    }),

  "personel-vardiya": (companyId, params) =>
    buildVardiyaPlanDataset({
      companyId,
      // Hafta başı normalize edilir: istemci haftanın ortasından bir gün
      // gönderirse çizelge yanlış pazartesiden başlardı.
      weekStart: weekStartIso(params.get("weekStart") || todayIso()),
    }),

  "rapor-vergiler": (companyId, params) =>
    buildTaxReportDataset({
      companyId,
      year: num(params, "year", new Date().getFullYear()),
      month: num(params, "month", new Date().getMonth() + 1),
    }),
}

export function isKnownDataset(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(DATASETS, key)
}

export function listDatasets(): string[] {
  return Object.keys(DATASETS)
}
