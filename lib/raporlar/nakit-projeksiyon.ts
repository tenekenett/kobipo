/**
 * İLERİYE DÖNÜK NAKİT PROJEKSİYONU.
 *
 * Nakit akış TABLOSU (`nakit-akisi.ts`) geçmişe bakar: "dönem içinde ne girdi,
 * ne çıktı". Bu rapor tersine bakar: bugünkü kasa+banka bakiyesinden başlayıp
 * açık alacak/borçları VADESİNE göre önümüzdeki 12 haftaya (ya da 12 aya)
 * dağıtır ve darboğazın ne zaman geleceğini söyler. Paraşüt'ün "Nakit Akışı
 * Raporu"nun ve "Güncel Durum" grafiğinin karşılığı.
 *
 * VERİ YAŞLANDIRMADAN GELİR (`computeCariAging`), yeniden sorgulanmaz: etkin
 * vade (carinin ödeme vadesi uygulanmış hâli), açık tutar, taslak eleme ve iade
 * yönü orada zaten doğru çözülmüş durumda. İkinci bir sorgu yazmak, panodaki
 * "vadesi geçmiş" ile buradaki rakamın ayrışmasıyla biterdi.
 *
 * TEK İSTİSNA ÇEK/SENET. Yaşlandırma onları cari kredisi sayıp faturayı
 * kapattığı için, ileri vadeli bir çek eğriden hem faturayı hem kendisini
 * düşürüyordu — 30 gün sonra gelecek para tabloda hiç görünmüyordu. Gerekçe ve
 * ölçüm `nakit-kiymet.ts`te; oradaki kalemler yaşlandırmanınkilerin YANINA
 * eklenir, çifte saymaz (fatura zaten kapanmış durumda).
 *
 * Kova aritmetiği `nakit-projeksiyon-kova.ts`te (saf, testli).
 */

import { prisma } from "@/lib/db/prisma"
import { cashBalanceBefore } from "@/lib/finans/nakit-hareket"
import { computeCariAging, type AgingAccount } from "./cari-yaslandirma"
import { PROJEKSIYONA_GIREN_DURUM, kiymetleriKalemeCevir } from "./nakit-kiymet"
import {
  DEFAULT_BUCKET_COUNT,
  buildCashProjection,
  type CashProjection,
  type ProjectionGranularity,
  type ProjectionItem,
} from "./nakit-projeksiyon-kova"

export type CashProjectionResult = CashProjection & {
  generatedAt: string
  bucketCount: number
}

/** Yaşlandırma hesaplarını projeksiyon kalemlerine çevirir. */
function toItems(accounts: AgingAccount[], direction: "in" | "out"): ProjectionItem[] {
  const items: ProjectionItem[] = []
  for (const account of accounts) {
    for (const invoice of account.invoices) {
      // Kapanmış belge projeksiyona girmez: nakit hareketi zaten olmuş.
      if (invoice.openAmount === 0) continue
      items.push({
        dueDate: invoice.effectiveDueDate,
        amount: invoice.openAmount,
        direction,
        hasDueDate: invoice.hasDueDate,
      })
    }
  }
  return items
}

export async function computeCashProjection(args: {
  companyId: string
  granularity?: string | null
  bucketCount?: number
}): Promise<CashProjectionResult> {
  const companyId = args.companyId
  const granularity: ProjectionGranularity = args.granularity === "month" ? "month" : "week"
  const bucketCount = args.bucketCount ?? DEFAULT_BUCKET_COUNT
  const now = new Date()

  const kiymetKosulu = {
    companyId,
    status: PROJEKSIYONA_GIREN_DURUM,
    // Vadesi geçmiş evrak eğriye girmez; gerekçesi `nakit-kiymet.ts`te.
    dueDate: { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) },
  }
  const kiymetAlanlari = {
    amount: true,
    dueDate: true,
    direction: true,
    supplierId: true,
  } as const

  const [aging, openingBalance, cekler, senetler] = await Promise.all([
    computeCariAging(companyId),
    // Bugünün SONUNA kadar olan bakiye: projeksiyon yarından itibaren ilerler,
    // bugün girmiş bir tahsilat açılış bakiyesinde olmalı.
    cashBalanceBefore(companyId, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)),
    prisma.check.findMany({ where: kiymetKosulu, select: kiymetAlanlari }),
    prisma.promissoryNote.findMany({ where: kiymetKosulu, select: kiymetAlanlari }),
  ])

  const projection = buildCashProjection({
    today: now,
    openingBalance,
    granularity,
    bucketCount,
    items: [
      ...toItems(aging.customers.accounts, "in"),
      ...toItems(aging.suppliers.accounts, "out"),
      ...kiymetleriKalemeCevir([...cekler, ...senetler], now),
    ],
  })

  return { ...projection, generatedAt: now.toISOString(), bucketCount }
}
