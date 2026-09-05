/**
 * Nakit akış tablosu hesabı.
 *
 * `app/api/raporlar/nakit-akisi/route.ts`ten ayıklandı — dışa aktarma ucu da
 * aynı fonksiyonu çağırır.
 *
 * TABLONUN OMURGASI BAKİYE EKSENİDİR: `dönem başı + net akış = dönem sonu`
 * kimliği TANIM GEREĞİ tutar, çünkü net akış iki bakiyenin farkı olarak
 * bulunur. Sınıflandırma (tahsilat / ödeme / diğer gelir / diğer gider) bu
 * farkı açıklamaya çalışır; açıklayamadığı kısım "sınıflandırılmamış" satırında
 * görünür kalır — gizlenmez.
 *
 * Eskiden tersiydi: dönem başı `createdAt < start` olan hesapların BUGÜNKÜ
 * bakiyeleri, dönem sonu ise tarihten bağımsız bugünkü bakiye toplamıydı. İki
 * uç da aynı günü gösterdiği için tablo kendi içinde çelişiyordu; üstelik
 * hesaplar arası virmanın hedef bacağı (type=INCOME) gelir sayıldığından kendi
 * cebinden cebine para aktarmak nakit akışını şişiriyordu.
 */

import { prisma } from "@/lib/db/prisma"
import {
  LEGACY_CASH_PAYMENT_WHERE,
  NOT_TRANSFER_WHERE,
  cashBalanceBefore,
} from "@/lib/finans/nakit-hareket"
import { periodWhere, resolvePeriodBounds } from "./date-range"
import { summarizeCashFlow, type CashFlowSummary } from "./nakit-akisi-ozet"

/**
 * Aritmetik ve alan tanımları `nakit-akisi-ozet.ts`te (saf, testli); burası
 * yalnız veriyi toplayıp oraya veriyor.
 */
export type CashFlowResult = CashFlowSummary & {
  period: { startDate: string; endDate: string }
}

export async function computeCashFlow(args: {
  companyId: string
  startDate?: string | null
  endDate?: string | null
}): Promise<CashFlowResult> {
  const companyId = args.companyId
  const bounds = resolvePeriodBounds(args.startDate, args.endDate)
  const date = periodWhere(bounds)

  const [
    beginningBalance,
    endingBalance,
    invoiceCashIn,
    invoiceCashOut,
    legacyCashIn,
    legacyCashOut,
    otherIncome,
    otherExpense,
  ] = await Promise.all([
    cashBalanceBefore(companyId, bounds.start),
    cashBalanceBefore(companyId, bounds.endExclusive),

    // FATURAYA BAĞLI NAKİT — yön belgenin tipinden DEĞİL, hareketin kendisinden
    // okunur. İade ödemesinin işaretini belgeden türetmek gerekmiyor: para hangi
    // yöne aktıysa yazma yolu o işaretle bir Transaction bırakmış durumda.
    prisma.transaction.aggregate({
      where: { companyId, type: "INCOME", date, invoicePayments: { some: {} } },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: { companyId, type: "EXPENSE", date, invoicePayments: { some: {} } },
      _sum: { amount: true },
    }),

    // Transaction yazılmadan önce girilmiş ESKİ ödemeler: bakiyeyi doğrudan
    // değiştirmişlerdi, işaret belgenin tipinden gelir (SALES giriş, diğeri çıkış).
    prisma.invoicePayment.aggregate({
      where: {
        companyId,
        ...LEGACY_CASH_PAYMENT_WHERE,
        paymentDate: date,
        invoice: { type: "SALES" },
      },
      _sum: { amount: true },
    }),
    prisma.invoicePayment.aggregate({
      where: {
        companyId,
        ...LEGACY_CASH_PAYMENT_WHERE,
        paymentDate: date,
        invoice: { type: { not: "SALES" } },
      },
      _sum: { amount: true },
    }),

    // FATURASIZ ("serbest") gelir/gider. Faturaya bağlı olanlar yukarıda
    // sayıldığı için burada `none` şart; virman bacakları da dışarıda.
    prisma.transaction.aggregate({
      where: {
        companyId,
        type: "INCOME",
        date,
        invoicePayments: { none: {} },
        ...NOT_TRANSFER_WHERE,
      },
      _sum: { amount: true },
    }),
    prisma.transaction.aggregate({
      where: {
        companyId,
        type: "EXPENSE",
        date,
        invoicePayments: { none: {} },
        ...NOT_TRANSFER_WHERE,
      },
      _sum: { amount: true },
    }),
  ])

  return {
    // Dönem sonu EKRANDA kapsayıcı gösterilir: sınır dışlayıcı olduğu için
    // olduğu gibi basılsaydı kullanıcı 5 Eylül seçip "6 Eylül" okurdu.
    period: {
      startDate: bounds.start.toISOString(),
      endDate: new Date(bounds.endExclusive.getTime() - 1).toISOString(),
    },
    ...summarizeCashFlow({
      beginningBalance,
      endingBalance,
      collections:
        Number(invoiceCashIn._sum.amount || 0) + Number(legacyCashIn._sum.amount || 0),
      payments:
        Number(invoiceCashOut._sum.amount || 0) + Number(legacyCashOut._sum.amount || 0),
      otherIncome: Number(otherIncome._sum.amount || 0),
      otherExpense: Number(otherExpense._sum.amount || 0),
    }),
  }
}
