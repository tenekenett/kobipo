/**
 * Cari ekstre dışa aktarımı.
 *
 * Bu ekran daha önce tarayıcıda kendi XLSX'ini üretiyordu: 6 kolon, metin
 * hücreler, tek format. Artık `lib/cari/ekstre-query.ts` üzerinden ekranla aynı
 * hareketleri alıp üç formatta da veriyor — üstelik yaşlandırma özetiyle.
 */

import { prisma } from "@/lib/db/prisma"
import { fetchEkstre } from "@/lib/cari/ekstre-query"
import type { ExportColumn, ExportDataset, ExportSection } from "../types"
import { loadExportCompany, describeDateRange, describeFilters } from "./context"
import {
  AGING_BUCKETS,
  AGING_BUCKET_LABEL,
  OVERDUE_BUCKETS,
} from "@/lib/raporlar/cari-yaslandirma-buckets"

export type EkstreExportParams = {
  companyId: string
  customerId?: string | null
  supplierId?: string | null
  startDate?: string | null
  endDate?: string | null
}

const TYPE_LABELS: Record<string, string> = {
  INVOICE: "Fatura",
  INVOICE_PAYMENT: "Fatura Ödemesi",
  TRANSACTION: "Tahsilat/Ödeme",
  CHECK: "Çek",
  PROMISSORY_NOTE: "Senet",
}

const COLUMNS: ExportColumn[] = [
  { key: "date", label: "Tarih", type: "date", width: 24 },
  { key: "typeLabel", label: "Tür", width: 30 },
  { key: "description", label: "Açıklama" },
  { key: "reference", label: "Referans", width: 34 },
  { key: "debit", label: "Borç", type: "money", width: 30 },
  { key: "credit", label: "Alacak", type: "money", width: 30 },
  { key: "balance", label: "Bakiye", type: "money", width: 30 },
]

/**
 * Ekstre tek bir cariye aitse belge başlığında adı görünsün.
 *
 * Sorgu `companyId` ile kapsanıyor: hareketler zaten firmaya göre süzülüyor ama
 * `findUnique(id)` başka bir firmanın carisinin ADINI belge başlığına taşırdı.
 */
async function resolveCariName(params: EkstreExportParams): Promise<{ name: string; role: string } | null> {
  if (params.customerId) {
    const customer = await prisma.customer.findFirst({
      where: { id: params.customerId, companyId: params.companyId },
      select: { name: true },
    })
    return customer ? { name: customer.name, role: "Müşteri" } : null
  }
  if (params.supplierId) {
    const supplier = await prisma.supplier.findFirst({
      where: { id: params.supplierId, companyId: params.companyId },
      select: { name: true },
    })
    return supplier ? { name: supplier.name, role: "Tedarikçi" } : null
  }
  return null
}

export async function buildEkstreDataset(params: EkstreExportParams): Promise<ExportDataset> {
  const [company, cari, result] = await Promise.all([
    loadExportCompany(params.companyId),
    resolveCariName(params),
    fetchEkstre(params),
  ])

  const rows = result.entries.map((entry) => ({
    date: entry.date,
    typeLabel: TYPE_LABELS[entry.type] ?? entry.type,
    description: entry.description,
    reference: entry.reference,
    debit: entry.debit || null,
    credit: entry.credit || null,
    balance: entry.balance,
  }))

  // Yaşlandırma yalnız TEK CARİ seçiliyken hesaplanır; "Tümü"de alacakla borç
  // aynı torbaya girerdi. Sayfa da o durumda hiç yazılmaz (ekranla aynı kural).
  const aging = result.aging
  const agingSection: ExportSection[] = aging
    ? [
        {
          title: "Yaşlandırma Özeti",
          sheetName: "Yaşlandırma",
          columns: [
            { key: "bucket", label: "Vade Aralığı", width: 70 },
            { key: "amount", label: "Tutar", type: "money", width: 40 },
          ],
          totals: null,
          rows: [
            // Kova adları yaşlandırma raporuyla AYNI sözlükten; "0-30 gün" gibi
            // yönü belirsiz bir başlık iki ekranı ayrıştırıyordu.
            ...AGING_BUCKETS.map((bucket) => ({
              bucket: AGING_BUCKET_LABEL[bucket],
              amount: aging[bucket],
            })),
            // "Yaklaşan" YALNIZ vadesi gelmemiştir; 1-30 gün gecikmiş tutar
            // buraya sayılıyordu ve dosya ekranla da raporla da tutmuyordu.
            {
              bucket: "Vadesi geçmiş (toplam)",
              amount: OVERDUE_BUCKETS.reduce((sum, bucket) => sum + aging[bucket], 0),
            },
            { bucket: "Vadesi gelmemiş (toplam)", amount: aging.not_due },
            { bucket: "KAPANIŞ BAKİYESİ", amount: result.finalBalance },
          ],
        },
      ]
    : []

  return {
    title: cari ? `Cari Ekstre - ${cari.name}` : "Cari Ekstre",
    company,
    filters: describeFilters([
      ["Cari", cari ? `${cari.name} (${cari.role})` : "Tümü"],
      ["Dönem", describeDateRange(params.startDate, params.endDate) ?? "Tüm kayıtlar"],
      ["Hareket sayısı", result.entries.length],
    ]),
    sections: [
      {
        title: "Hesap Hareketleri",
        sheetName: "Ekstre",
        columns: COLUMNS,
        // Bakiye YÜRÜYEN bir değer; toplanmaz, son satırdaki kapanış bakiyesi
        // yazılır. Bu yüzden toplamlar elle veriliyor.
        totals: {
          debit: result.totalDebit,
          credit: result.totalCredit,
          balance: result.finalBalance,
        },
        rows,
      },
      ...agingSection,
    ],
    generatedAt: new Date(),
  }
}
