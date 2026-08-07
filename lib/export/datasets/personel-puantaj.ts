/**
 * Aylık puantaj dışa aktarımı — ay sonunda mali müşavire giden tablo.
 *
 * Satırları kendi sorgusuyla değil `computePuantaj` ile üretir: ekrandaki rakamla
 * dosyadaki rakam aynı hesaptan çıkmalı.
 *
 * Süreler SAAT cinsinden SAYI olarak yazılır ("8 sa 30 dk" değil 8,5): Excel'de
 * toplanabilmeleri gerekiyor, dosyanın varlık sebebi zaten bu. Ekranda ise okunur
 * etiket kullanılır — iki gösterim aynı dakikadan türer.
 */

import { computePuantaj } from "@/lib/personel/puantaj"
import { HOURLY_BASIS_LABEL, laborRatio } from "@/lib/personel/maliyet"
import type { ExportColumn, ExportDataset, ExportRow } from "../types"
import { formatCellText } from "../values"
import { loadExportCompany, describeFilters } from "./context"

const AYLAR = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
]

/** Dakika → saat (2 hane). Excel hücresinde gerçek sayı olarak durur. */
const hours = (minutes: number) => Math.round((minutes / 60) * 100) / 100

const COLUMNS: ExportColumn[] = [
  { key: "name", label: "Personel", width: 45 },
  { key: "position", label: "Görev / Departman", width: 40 },
  { key: "shiftCount", label: "Vardiya", type: "number", width: 18, total: true },
  { key: "plannedHours", label: "Plan (saat)", type: "number", width: 22, total: true },
  { key: "actualHours", label: "Fiilî (saat)", type: "number", width: 22, total: true },
  { key: "lateHours", label: "Gecikme (saat)", type: "number", width: 22, total: true },
  { key: "earlyHours", label: "Erken çıkış (saat)", type: "number", width: 24, total: true },
  { key: "overtimeHours", label: "Fazla mesai (saat)", type: "number", width: 24, total: true },
  { key: "absentCount", label: "Devamsız (gün)", type: "number", width: 22, total: true },
  { key: "leaveDays", label: "İzin (gün)", type: "number", width: 20, total: true },
  { key: "grossSalary", label: "Brüt Maaş", type: "money", width: 30 },
  { key: "plannedCost", label: "İşçilik (plan)", type: "money", width: 32, total: true },
  { key: "actualCost", label: "İşçilik (fiilî)", type: "money", width: 32, total: true },
  { key: "note", label: "Durum", width: 28 },
]

export async function buildPuantajDataset(params: {
  companyId: string
  year: number
  month: number
}): Promise<ExportDataset> {
  const [company, puantaj] = await Promise.all([
    loadExportCompany(params.companyId),
    computePuantaj(params),
  ])

  const rows: ExportRow[] = puantaj.rows.map((r) => ({
    name: r.name,
    position: r.position || r.department || "",
    shiftCount: r.shiftCount,
    plannedHours: hours(r.plannedMinutes),
    // Damgalanmamış aylarda fiilî süre 0'dır ama bu "çalışmadı" demek değil,
    // "girilmedi" demektir; boş bırakılıp Durum sütununda açıklanır.
    actualHours: r.stampedCount > 0 ? hours(r.actualMinutes) : null,
    lateHours: hours(r.lateMinutes),
    earlyHours: hours(r.earlyLeaveMinutes),
    overtimeHours: hours(r.overtimeMinutes),
    absentCount: r.absentCount,
    leaveDays: r.leaveDays,
    grossSalary: r.grossSalary,
    plannedCost: r.plannedCost,
    actualCost: r.actualCost,
    note: [
      r.terminated ? `Ayrıldı${r.terminationDate ? ` (${r.terminationDate})` : ""}` : null,
      r.shiftCount > r.stampedCount ? `${r.shiftCount - r.stampedCount} damgasız` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  }))

  const plannedCostTotal = puantaj.rows.reduce((sum, r) => sum + (r.plannedCost ?? 0), 0)
  const ratio = laborRatio(plannedCostTotal, puantaj.revenue)
  const missingSalary = puantaj.rows.filter((r) => r.grossSalary == null).length

  return {
    title: `Puantaj — ${AYLAR[params.month - 1]} ${params.year}`,
    company,
    orientation: "landscape",
    filters: describeFilters([
      ["Dönem", `${AYLAR[params.month - 1]} ${params.year}`],
      ["Saatlik ücret", HOURLY_BASIS_LABEL],
      ["Dönem net satış", puantaj.revenue > 0 ? formatCellText(puantaj.revenue, "money") : null],
      ["İşçilik / ciro", ratio != null ? `%${ratio.toFixed(1)}` : null],
    ]),
    sections: [{ title: "Personel", sheetName: "Puantaj", columns: COLUMNS, rows }],
    note:
      missingSalary > 0
        ? `${missingSalary} personelin brüt maaşı girilmediği için işçilik toplamına dahil edilmedi.`
        : null,
    generatedAt: new Date(),
  }
}
