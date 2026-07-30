/**
 * Personel (İK) raporu dışa aktarımı.
 */

import { computeHrReport } from "@/lib/raporlar/personel"
import type { ExportColumn, ExportDataset, ExportRow } from "../types"
import { loadExportCompany, describeFilters } from "./context"

const LEAVE_LABELS: Record<string, string> = {
  ANNUAL: "Yıllık",
  EXCUSE: "Mazeret",
  SICK: "Hastalık",
  UNPAID: "Ücretsiz",
}

const DEPARTMENT_COLUMNS: ExportColumn[] = [
  { key: "department", label: "Departman", width: 60 },
  { key: "headcount", label: "Çalışan", type: "number", width: 25, total: true },
  { key: "gross", label: "Brüt Maliyet", type: "money", width: 40, total: true },
  { key: "net", label: "Net Ödenen", type: "money", width: 40, total: true },
]

export async function buildHrReportDataset(params: {
  companyId: string
  year: number
}): Promise<ExportDataset> {
  const [company, report] = await Promise.all([
    loadExportCompany(params.companyId),
    computeHrReport(params),
  ])

  const metricColumns: ExportColumn[] = [
    { key: "metric", label: "Gösterge", width: 70 },
    { key: "value", label: "Değer", type: "number", width: 35 },
  ]

  const leaveRows: ExportRow[] = Object.entries(report.leaveUsage.byType).map(([type, days]) => ({
    metric: `${LEAVE_LABELS[type] ?? type} izin (gün)`,
    value: days,
  }))

  return {
    title: "Personel Raporu",
    company,
    orientation: "portrait",
    filters: describeFilters([["Yıl", report.year]]),
    sections: [
      {
        title: "Kadro",
        sheetName: "Kadro",
        columns: metricColumns,
        totals: null,
        rows: [
          { metric: "Toplam çalışan", value: report.headcount.total },
          { metric: "Aktif", value: report.headcount.active },
          { metric: "İzinde", value: report.headcount.onLeave },
          { metric: "İşten ayrılan", value: report.headcount.terminated },
          { metric: "Bu yıl ayrılan", value: report.turnover.terminatedThisYear },
          { metric: "Devir oranı (%)", value: report.turnover.rate },
          // Adet; para kolonunda "0,00" diye görünmesin diye bu bölümde.
          { metric: "Bordro adedi", value: report.cost.payrollCount },
        ],
      },
      {
        title: "Maliyet",
        sheetName: "Maliyet",
        columns: [
          { key: "metric", label: "Kalem", width: 70 },
          { key: "value", label: "Tutar", type: "money", width: 35 },
        ],
        totals: null,
        rows: [
          { metric: "Toplam brüt", value: report.cost.totalGross },
          { metric: "Toplam kesinti", value: report.cost.totalDeductions },
          { metric: "Toplam net ödenen", value: report.cost.totalNet },
          { metric: "İşveren maliyeti (tahmini)", value: report.cost.employerCostEstimate },
        ],
      },
      {
        title: "İzin Kullanımı",
        sheetName: "İzinler",
        columns: metricColumns,
        totals: { metric: "Toplam", value: report.leaveUsage.total },
        rows: leaveRows,
      },
      {
        title: "Departman Kırılımı",
        sheetName: "Departmanlar",
        columns: DEPARTMENT_COLUMNS,
        rows: report.byDepartment,
      },
    ],
    generatedAt: new Date(),
  }
}
