/**
 * Bilanço hesabı.
 *
 * `app/api/raporlar/bilanco/route.ts`ten ayıklandı — dışa aktarma ucu da aynı
 * fonksiyonu çağırır, ekrandaki aktif/pasif toplamıyla PDF'teki aynı olur.
 *
 * ÖZ SERMAYE YEVMİYEDEN OKUNMAZ. Eskiden `accountingEntry._sum.amount` idi:
 * her fişin bir borç + bir alacak hesabı ve TEK `amount`'ı olduğu için o toplam
 * öz sermayeyi değil fiş hacmini veriyordu. Üstelik hesap planı hiçbir yerde
 * otomatik açılmıyor (`accountPlan.create` yalnız `/api/muhasebe/hesap-plani`ta)
 * ve otomatik fiş yalnız satış faturasında yazılıyor — çoğu firmada o toplam ya
 * 0'dı ya da satışların yarısıydı, dolayısıyla aktif ile pasif hiç tutmuyordu
 * (dışa aktarmadaki "Denge → Fark" satırı bunu itiraf ediyordu).
 *
 * Yerine öz sermaye TANIMINDAN kurulur: net varlık = aktif − yükümlülük. Bu
 * kimliği tuttururken açıklamayı da bırakır: kümülatif kâr ayrı satırda, kârla
 * açıklanamayan kısım (kuruluş sermayesi, ortak cari, kayıt dışı devir) "Sermaye
 * ve diğer düzeltmeler" satırında görünür kalır.
 */

import { prisma } from "@/lib/db/prisma"
import { cariBalancesAsOf } from "@/lib/cari/bakiye-asof"
import { settlementReference } from "@/lib/cek-senet/tahsil"
import { CHECK_SETTLEMENT_PREFIXES, cashBalanceBefore } from "@/lib/finans/nakit-hareket"
import { composeBalanceSheet, type BalanceSheetSummary } from "./bilanco-ozet"
import { kiymetPortfoyu, PORTFOY_DURUMU, TAHSIL_DURUMU } from "./bilanco-kiymet"
import { resolvePeriodBounds } from "./date-range"
import { computeProfitLoss } from "./kar-zarar"

/**
 * Aritmetik ve alan tanımları `bilanco-ozet.ts`te (saf, testli); burası yalnız
 * veriyi toplayıp oraya veriyor.
 */
export type BalanceSheetResult = BalanceSheetSummary & { asOfDate: string }

/**
 * Kümülatif kâr için dönem başlangıcı. Firmanın ilk kaydından öncesine düşen
 * herhangi bir gün yeterli; sabit tutuluyor ki rapor her çağrıda aynı kümülatifi
 * versin.
 */
const EPOCH = "1970-01-01"

export async function computeBalanceSheet(args: {
  companyId: string
  asOfDate?: string | null
}): Promise<BalanceSheetResult> {
  const companyId = args.companyId
  // Tarih GÜN SONUNU kapsar: `lte: new Date("2026-09-05")` gece yarısını
  // gösterip o günün bütün belgelerini bilançodan düşürüyordu.
  const bounds = resolvePeriodBounds(EPOCH, args.asOfDate ?? null)
  const end = bounds.endExclusive

  const [cashAndBanks, profitLoss, cari, kiymetler, tahsiller, inventory] = await Promise.all([
    // Nakit ve banka — TARİHE GÖRE. Eskiden hesapların bugünkü bakiyesiydi:
    // geçmiş bir güne bakan bilanço bugünkü parayı gösteriyordu.
    cashBalanceBefore(companyId, end),

    // Geçmiş dönem + cari dönem kârı, kümülatif.
    computeProfitLoss({ companyId, startDate: EPOCH, endDate: args.asOfDate ?? null }),

    // ALACAK / BORÇ — cari bakiyelerinden, tarih itibarıyla (2026-09-23).
    // Eskiden yalnız faturadan kuruluyordu: faturaya bağlanmamış tahsilat
    // (avans) kasaya girip alacaktan düşmüyor, tahsil edilen çek hem kasada hem
    // alacakta kalıyor, açılış bakiyesi ve virman hiç görünmüyordu (HİDROEREN:
    // bilanço 35.200 TL alacak, cari bakiyeleri toplamı 200 TL).
    cariBalancesAsOf(companyId, end),

    // Çek/senet portföyü — cariden düştüğü gün portföye girer, tahsil
    // hareketinin günü kasaya geçer (lib/raporlar/bilanco-kiymet.ts).
    Promise.all([
      prisma.check.findMany({
        where: { companyId, issueDate: { lt: end }, status: { in: [PORTFOY_DURUMU, TAHSIL_DURUMU] } },
        select: { id: true, amount: true, status: true, issueDate: true, direction: true, supplierId: true },
      }),
      prisma.promissoryNote.findMany({
        where: { companyId, issueDate: { lt: end }, status: { in: [PORTFOY_DURUMU, TAHSIL_DURUMU] } },
        select: { id: true, amount: true, status: true, issueDate: true, direction: true, supplierId: true },
      }),
    ]),
    prisma.transaction.findMany({
      where: {
        companyId,
        OR: [
          { reference: { startsWith: CHECK_SETTLEMENT_PREFIXES.CHECK } },
          { reference: { startsWith: CHECK_SETTLEMENT_PREFIXES.PROMISSORY_NOTE } },
        ],
      },
      select: { reference: true, date: true },
    }),

    // Stok değeri
    prisma.product.findMany({
      where: { companyId, isActive: true },
      select: { stockQuantity: true, purchasePrice: true },
    }),
  ])

  const tahsilTarihi = new Map<string, Date>()
  for (const t of tahsiller) if (t.reference) tahsilTarihi.set(t.reference, t.date)
  const [cekler, senetler] = kiymetler
  const portfoy = kiymetPortfoyu(
    [
      ...cekler.map((c) => ({ ...c, settledAt: tahsilTarihi.get(settlementReference("CHECK", c.id)) ?? null })),
      ...senetler.map((n) => ({
        ...n,
        settledAt: tahsilTarihi.get(settlementReference("PROMISSORY_NOTE", n.id)) ?? null,
      })),
    ],
    end,
  )

  // Stok maliyeti YALNIZCA alış fiyatından. Eskiden alış fiyatı yoksa SATIŞ
  // fiyatına düşülüyordu; kâr marjı maliyet sayılınca stok (ve dolayısıyla öz
  // sermaye) sistematik olarak şişiyordu. Maliyeti bilinmeyen ürün 0 sayılır.
  const inventoryValue = inventory.reduce((sum, item) => {
    return sum + Number(item.stockQuantity || 0) * Number(item.purchasePrice ?? 0)
  }, 0)

  return {
    asOfDate: new Date(end.getTime() - 1).toISOString(),
    ...composeBalanceSheet({
      cashAndBanks,
      customerBalances: cari.customers.map((c) => c.balance),
      supplierBalances: cari.suppliers.map((s) => s.balance),
      checksReceived: portfoy.received,
      checksGiven: portfoy.given,
      inventory: inventoryValue,
      retainedEarnings: profitLoss.netProfit,
    }),
  }
}
