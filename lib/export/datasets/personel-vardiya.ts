/**
 * Haftalık vardiya çizelgesi dışa aktarımı — mutfak duvarına asılan kâğıt.
 *
 * Satırları kendi sorgusuyla değil `computeWeekPlan` ile üretir: ekrandaki
 * çizelgeyle indirilen dosya aynı hesaptan çıkmalı.
 *
 * Puantajdan FARKLI bir tablodur ve onun yerine geçmez: puantaj ay sonunda mali
 * müşavire giden TOPLAMLARDIR, bu ise hafta başında ekibe asılan PLANDIR. Aynı
 * veriden türerler ama biri saat toplar, diğeri kimin ne zaman geleceğini söyler.
 */

import { computeWeekPlan } from "@/lib/personel/vardiya-plan"
import { durationLabel, shortDayLabel, weekRangeLabel } from "@/lib/personel/vardiya"
import type { ExportColumn, ExportDataset, ExportRow } from "../types"
import { loadExportCompany, describeFilters } from "./context"

export async function buildVardiyaPlanDataset(params: {
  companyId: string
  weekStart: string
}): Promise<ExportDataset> {
  const [company, plan] = await Promise.all([
    loadExportCompany(params.companyId),
    computeWeekPlan(params),
  ])

  const columns: ExportColumn[] = [
    { key: "name", label: "Personel", width: 42 },
    { key: "position", label: "Görev", width: 32 },
    ...plan.days.map((day, i) => ({
      key: `d${i}`,
      // Tatil günü sütun başlığında yazılı: çizelgeye bakan kişi o günü neden
      // boş gördüğünü aynı satırda okusun.
      label: plan.holidays[i] ? `${shortDayLabel(day)} · ${plan.holidays[i]}` : shortDayLabel(day),
      width: 26,
    })),
    { key: "total", label: "Toplam", width: 22 },
  ]

  const rows: ExportRow[] = plan.rows.map((r) => {
    const row: ExportRow = {
      name: r.name,
      position: r.position || r.department || "",
      total: durationLabel(r.totalMinutes),
    }
    r.cells.forEach((cell, i) => {
      // İzin, saat OLMADIĞINDA hücreyi doldurur; ikisi birden varsa saat önce
      // gelir (o gün fiilen çalışılıyor demektir).
      row[`d${i}`] = cell.text || cell.leave || "—"
    })
    return row
  })

  // Kapsama satırı tablonun sonunda: hangi günün ince kaldığı, isimlerin arasında
  // kaybolmadan görünsün.
  if (rows.length > 0) {
    const coverageRow: ExportRow = { name: "Çalışan sayısı", position: "", total: "" }
    plan.coverage.forEach((count, i) => {
      coverageRow[`d${i}`] = `${count} kişi`
    })
    rows.push(coverageRow)
  }

  return {
    title: `Vardiya Çizelgesi — ${weekRangeLabel(plan.weekStart)}`,
    company,
    orientation: "landscape",
    filters: describeFilters([
      ["Hafta", weekRangeLabel(plan.weekStart)],
      ["Haftalık toplam", durationLabel(plan.totalMinutes)],
      ["Personel", String(plan.rows.length)],
    ]),
    sections: [{ title: "Haftalık plan", sheetName: "Vardiya", columns, rows }],
    generatedAt: new Date(),
  }
}
