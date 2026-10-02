/**
 * "NAKİT KAÇ GÜN YETER" — panodaki kartın verisi.
 *
 * Kendi nakit tanımı YOK: Nakit Akışı raporunun hesabını (`computeCashFlow`)
 * son 90 gün için çağırır. Mevcut nakit = raporun dönem sonu bakiyesi, çıkış =
 * fatura ödemeleri + faturasız giderler, giriş = tahsilatlar + faturasız
 * gelirler (virman bacakları üçünde de yok). Kart rapora bağlanır; iki ekran
 * aynı rakamı basmalı. Aritmetik ve "gün yazılmaz" kuralları
 * `nakit-yeterlilik-hesap.ts`te (saf, testli).
 */

import { prisma } from "@/lib/db/prisma"
import { LEGACY_CASH_PAYMENT_WHERE, NOT_TRANSFER_WHERE } from "@/lib/finans/nakit-hareket"
import { computeCashFlow } from "./nakit-akisi"
import { PENCERE_GUN, nakitYeterlilik, type NakitYeterlilik } from "./nakit-yeterlilik-hesap"

const GUN_MS = 24 * 60 * 60 * 1000

/** UTC gün başı — nakit akışı dönem sınırlarıyla aynı eksen (`resolvePeriodBounds`). */
const utcGun = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
const ymd = (d: Date) => d.toISOString().slice(0, 10)

export async function computeNakitYeterlilik(companyId: string, now: Date = new Date()): Promise<NakitYeterlilik> {
  // Pencerenin sonu bugünün sonu (`computeCashFlow` bitiş gününü kapsar).
  const bugun = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  const yarin = new Date(bugun.getTime() + GUN_MS)
  const pencereBasi = new Date(bugun.getTime() - (PENCERE_GUN - 1) * GUN_MS)

  // Kasa geçmişi pencereden kısaysa ortalama ilk hareketten itibaren alınır:
  // 20 günlük firmanın çıkışını 90'a bölmek nakdi olduğundan uzun gösterirdi.
  const ilk = await prisma.transaction.aggregate({
    where: { companyId, date: { lt: yarin } },
    _min: { date: true },
  })
  const ilkGun = ilk._min.date ? utcGun(ilk._min.date) : null
  const bas = ilkGun && ilkGun > pencereBasi ? ilkGun : pencereBasi
  const gozlemGun = ilkGun ? Math.round((yarin.getTime() - bas.getTime()) / GUN_MS) : 0

  const tarih = { gte: bas, lt: yarin }
  const [akis, krediKarti, cikisHareketi, eskiCikis] = await Promise.all([
    computeCashFlow({ companyId, startDate: ymd(bas), endDate: ymd(bugun) }),
    // Rapor kredi kartı hesabını nakde katıyor (borç eksi); kart bunu ayrıca yazar.
    prisma.financialAccount.aggregate({
      where: { companyId, type: "CREDIT_CARD", createdAt: { lt: yarin } },
      _sum: { balance: true },
    }),
    // "Yeterli çıkış kaydı var mı" sorusu için ADET (tutarlar rapordan).
    prisma.transaction.count({ where: { companyId, type: "EXPENSE", date: tarih, ...NOT_TRANSFER_WHERE } }),
    prisma.invoicePayment.count({
      where: { companyId, ...LEGACY_CASH_PAYMENT_WHERE, paymentDate: tarih, invoice: { type: { not: "SALES" } } },
    }),
  ])

  const f = akis.operatingActivities
  return nakitYeterlilik({
    nakit: akis.endingBalance,
    krediKarti: Number(krediKarti._sum.balance || 0),
    cikis: f.payments + f.otherExpense,
    giris: f.collections + f.otherIncome,
    cikisAdedi: cikisHareketi + eskiCikis,
    gozlemGun,
  })
}
