/**
 * Cari (müşteri / tedarikçi) listesi dışa aktarımı.
 *
 * `lib/cari/list-query.ts` üzerinden çalışır — ekranla AYNI sorgu ve AYNI
 * bakiye formülü. Ekran 50'şer sayfalıyor; burada `paginate: false` ile filtreye
 * uyan tüm cariler alınır (kullanıcı "dışa aktar" derken 1. sayfayı değil,
 * listenin tamamını kastediyor).
 */

import { fetchCustomerList, fetchSupplierList } from "@/lib/cari/list-query"
import type { ExportColumn, ExportDataset, ExportSection } from "../types"
import { loadExportCompany, describeFilters } from "./context"

export type CariExportParams = {
  companyId: string
  search?: string | null
  /** "customers" | "suppliers" | "all" */
  tab?: string | null
}

function columnsFor(kind: "customers" | "suppliers"): ExportColumn[] {
  return [
    { key: "code", label: "Kod", width: 22 },
    { key: "name", label: kind === "customers" ? "Müşteri Ünvanı" : "Tedarikçi Ünvanı" },
    { key: "taxNumber", label: "VKN/TCKN", width: 26 },
    { key: "taxOffice", label: "Vergi Dairesi", width: 30 },
    { key: "contactPerson", label: "Yetkili", width: 30 },
    { key: "phone", label: "Telefon", width: 26 },
    { key: "email", label: "E-posta", width: 40 },
    { key: "city", label: "Şehir", width: 24 },
    { key: "address", label: "Adres", width: 50 },
    { key: "paymentDueDays", label: "Vade (gün)", type: "number", width: 20 },
    { key: "riskLimit", label: "Risk Limiti", type: "money", width: 24 },
    {
      key: "balance",
      label: kind === "customers" ? "Bakiye (Alacak)" : "Bakiye (Borç)",
      type: "money",
      width: 26,
      total: true,
    },
  ]
}

export async function buildCariDataset(params: CariExportParams): Promise<ExportDataset> {
  const tab = params.tab === "suppliers" || params.tab === "customers" ? params.tab : "all"
  const company = await loadExportCompany(params.companyId)
  const sections: ExportSection[] = []

  if (tab === "customers" || tab === "all") {
    const { items } = await fetchCustomerList({ companyId: params.companyId, search: params.search })
    sections.push({
      title: "Müşteriler",
      sheetName: "Müşteriler",
      columns: columnsFor("customers"),
      rows: items,
    })
  }

  if (tab === "suppliers" || tab === "all") {
    const { items } = await fetchSupplierList({ companyId: params.companyId, search: params.search })
    sections.push({
      title: "Tedarikçiler",
      sheetName: "Tedarikçiler",
      columns: columnsFor("suppliers"),
      rows: items,
    })
  }

  const title =
    tab === "customers" ? "Müşteri Listesi" : tab === "suppliers" ? "Tedarikçi Listesi" : "Cari Hesaplar"

  return {
    title,
    company,
    filters: describeFilters([["Arama", params.search]]),
    sections,
    generatedAt: new Date(),
  }
}
