/**
 * STOK RAPORU TEDARİKÇİ KESİTİ — salt okur ölçüm.
 *
 *   npx tsx scripts/stok-tedarikci-kesit-kontrol.ts [--adet=5]
 *
 * NE ÖLÇER (hiçbir şey yazmaz): en çok alış belgesi olan N tedarikçi için stok
 * raporunun "Alınan" sütunu (`computeStockPeriodFlows` supplierId) ile stok
 * hareketleri raporunun AYNI tedarikçi süzgeciyle verdiği hareketlerin ürün
 * bazında işaretli toplamı (transfer ve sayım/ikram hariç) eşit mi. İki rapor
 * cariyi belgeye ayrı yoldan bağlar; ayrışırsa biri irsaliyeyi ya da iadeyi
 * kaçırıyordur. Dönem geniş tutulur ki iki raporun gün sınırı farkı (UTC /
 * yerel) ölçüme karışmasın.
 *
 * Hareket raporu tedarikçiye bağlı HER belgeyi listeler; tedarikçiye kesilmiş
 * SATIŞ faturası da (canlıda deneme kaydı olarak var) onda görünür. "Alınan"
 * yalnız alış ailesidir — karşılaştırma o yüzden satış ailesi belgeleri dışarıda
 * bırakarak yapılır; dışarıda kalan hareket sayısı ayrıca yazılır.
 */
import "dotenv/config"
import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local", override: true })

const args = process.argv.slice(2)
const ADET = Number((args.find((a) => a.startsWith("--adet=")) || "").split("=")[1] || 5)
const START = "2000-01-01"
const END = "2099-12-31"

async function main() {
  const { prisma } = await import("@/lib/db/prisma")
  const { computeStockPeriodFlows } = await import("@/lib/raporlar/stok-donem")
  const { computeStockMovementReport } = await import("@/lib/raporlar/stok-hareket")

  // Stoğa iş yapmış alış belgesi en çok olan tedarikçiler (fatura + irsaliye).
  const top = await prisma.$queryRaw<Array<{ companyId: string; supplierId: string; name: string; refs: bigint }>>`
    SELECT d."companyId", d."supplierId", s.name, COUNT(*) AS refs
    FROM (
      SELECT i."companyId", i."supplierId", i.id AS ref FROM invoices i WHERE i."supplierId" IS NOT NULL
      UNION ALL
      SELECT w."companyId", w."supplierId", 'waybill:' || w.id FROM waybills w WHERE w."supplierId" IS NOT NULL
    ) d
    JOIN stock_movements m ON m.reference = d.ref AND m."companyId" = d."companyId"
    JOIN suppliers s ON s.id = d."supplierId"
    GROUP BY d."companyId", d."supplierId", s.name
    ORDER BY refs DESC
    LIMIT ${ADET}
  `

  let failures = 0
  for (const row of top) {
    const flows = await computeStockPeriodFlows({
      companyId: row.companyId,
      startDate: START,
      endDate: END,
      supplierId: row.supplierId,
    })
    const report = await computeStockMovementReport({
      companyId: row.companyId,
      supplierId: row.supplierId,
      startDate: START,
      endDate: END,
      limit: 1_000_000,
    })
    const invoiceIds = [...new Set(report.rows.filter((m) => m.documentKind !== "WAYBILL" && m.documentId).map((m) => m.documentId!))]
    const salesDocs = new Set(
      (
        await prisma.invoice.findMany({
          where: { id: { in: invoiceIds } },
          select: { id: true, type: true, returnKind: true },
        })
      )
        .filter((d) => d.type === "SALES" || (d.type === "RETURN" && d.returnKind !== "PURCHASE"))
        .map((d) => d.id),
    )
    let skippedSales = 0
    const expected = new Map<string, number>()
    for (const m of report.rows) {
      if (m.type === "TRANSFER" || m.type === "ADJUSTMENT") continue
      if (m.documentId && salesDocs.has(m.documentId)) {
        skippedSales += 1
        continue
      }
      expected.set(m.productId, (expected.get(m.productId) ?? 0) + m.quantity)
    }
    const waybillMoves = report.rows.filter((m) => m.documentKind === "WAYBILL").length

    const mismatches: string[] = []
    const ids = new Set([...expected.keys(), ...flows.byProduct.keys()])
    for (const id of ids) {
      const want = Math.round((expected.get(id) ?? 0) * 10000) / 10000
      const got = flows.byProduct.get(id)?.inbound ?? 0
      // Hizmet satırları hareketten değil alış kaleminden gelir; hareket raporunda yoktur.
      if (!expected.has(id) && got !== 0) {
        const product = await prisma.product.findUnique({ where: { id }, select: { isService: true, name: true } })
        if (product?.isService) continue
      }
      if (Math.abs(want - got) > 0.0001) mismatches.push(`${id}: hareket ${want} ≠ alınan ${got}`)
    }
    const products = [...flows.byProduct.values()].filter((f) => f.inbound !== 0).length
    console.log(
      `${mismatches.length === 0 ? "EŞİT " : "FARK "} ${row.name} — ${report.rows.length} hareket ` +
        `(${waybillMoves} irsaliyeden${skippedSales ? `, ${skippedSales} satış belgesi dışarıda` : ""}), ${products} ürün çeşidi` +
        (report.truncated ? " [TAVAN]" : ""),
    )
    for (const line of mismatches.slice(0, 10)) console.log("   ", line)
    if (mismatches.length > 0) failures += 1
  }

  await prisma.$disconnect()
  process.exit(failures > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
