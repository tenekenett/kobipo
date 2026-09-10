/**
 * Aylık devam özeti dışa aktarımı — vardiyasız işletmenin, ay sonunda mali
 * müşavire giden tablosu.
 *
 * Puantaj dosyasının (personel-puantaj) tek düze çalışan karşılığıdır: orada
 * ölçü SAAT, burada GÜN. Satırları kendi sorgusuyla değil `computeDevamOzet` ile
 * üretir — ekrandaki gün sayısıyla dosyadaki gün sayısı aynı hesaptan çıkmalı.
 *
 * Gün sayıları SAYI olarak yazılır (yarım gün 0,5): Excel'de toplanabilmeleri
 * gerekiyor, dosyanın varlık sebebi zaten bu.
 */

import { dailyRate } from "@/lib/personel/bordro-hesap"
import { deductionDaysFor } from "@/lib/personel/devam"
import { computeDevamOzet } from "@/lib/personel/devam-ozet"
import type { ExportColumn, ExportDataset, ExportRow } from "../types"
import { describeFilters, loadExportCompany } from "./context"

const AYLAR = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık",
]

const COLUMNS: ExportColumn[] = [
  { key: "name", label: "Personel", width: 45 },
  { key: "position", label: "Görev / Departman", width: 40 },
  { key: "workedDays", label: "Çalışılan (gün)", type: "number", width: 22, total: true },
  { key: "paidLeave", label: "Ücretli izin (gün)", type: "number", width: 24, total: true },
  { key: "sick", label: "Raporlu (gün)", type: "number", width: 20, total: true },
  { key: "unpaidLeave", label: "Ücretsiz izin (gün)", type: "number", width: 24, total: true },
  { key: "absent", label: "Devamsız (gün)", type: "number", width: 22, total: true },
  { key: "halfDay", label: "Yarım gün", type: "number", width: 18, total: true },
  { key: "holiday", label: "Tatil (gün)", type: "number", width: 18, total: true },
  { key: "deductionDays", label: "Kesinti (gün)", type: "number", width: 22, total: true },
  { key: "grossSalary", label: "Brüt Maaş", type: "money", width: 30 },
  { key: "deduction", label: "Kesinti tutarı", type: "money", width: 30, total: true },
  { key: "note", label: "Durum", width: 28 },
]

export async function buildDevamDataset(params: {
  companyId: string
  year: number
  month: number
}): Promise<ExportDataset> {
  const [company, ozet] = await Promise.all([
    loadExportCompany(params.companyId),
    computeDevamOzet(params),
  ])

  const rows: ExportRow[] = ozet.rows.map((r) => {
    // Kesinti günü ekrandaki VARSAYILAN seçimle aynı hesaptan gelir (raporlu
    // hariç, ücretsiz izin dahil); dosya başka bir varsayımla üretilseydi iki
    // rakam ay sonunda tartışma konusu olurdu. Aktarım penceresinde seçim
    // değiştirilebilir — dosya notu bunu söylüyor.
    const deductionDays = deductionDaysFor(r.counts)
    const rate = dailyRate(r.grossSalary)
    return {
      name: r.name,
      position: r.position || r.department || "",
      workedDays: r.workedDays,
      paidLeave: r.counts.PAID_LEAVE,
      sick: r.counts.SICK,
      unpaidLeave: r.counts.UNPAID_LEAVE,
      absent: r.counts.ABSENT,
      halfDay: r.counts.HALF_DAY,
      holiday: r.counts.HOLIDAY,
      deductionDays,
      grossSalary: r.grossSalary,
      // Maaşı girilmemiş personelde tutar BOŞ kalır: 0 yazmak "kesinti yok"
      // diye okunurdu, oysa hesaplanamıyor.
      deduction: r.grossSalary != null ? Math.round(deductionDays * rate * 100) / 100 : null,
      note: r.terminated
        ? `Ayrıldı${r.terminationDate ? ` (${r.terminationDate})` : ""}`
        : "",
    }
  })

  const missingSalary = ozet.rows.filter((r) => r.grossSalary == null).length

  return {
    title: `Devam Özeti — ${AYLAR[params.month - 1]} ${params.year}`,
    company,
    orientation: "landscape",
    filters: describeFilters([
      ["Dönem", `${AYLAR[params.month - 1]} ${params.year}`],
      ["Günlük yevmiye", "Brüt / 30 gün"],
      ["Kesilen günler", "Devamsızlık, ücretsiz izin ve yarım günler (raporlu hariç)"],
    ]),
    sections: [{ title: "Personel", sheetName: "Devam", columns: COLUMNS, rows }],
    note:
      missingSalary > 0
        ? `${missingSalary} personelin brüt maaşı girilmediği için kesinti tutarı hesaplanamadı.`
        : null,
    generatedAt: new Date(),
  }
}
