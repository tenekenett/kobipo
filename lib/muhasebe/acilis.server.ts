import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { cariBalancesAsOf } from "@/lib/cari/bakiye-asof"
import { employeeBalances } from "@/lib/personel/masraf-defteri"
import { kiymetPortfoyu, PORTFOY_DURUMU, TAHSIL_DURUMU } from "@/lib/raporlar/bilanco-kiymet"
import { settlementReference } from "@/lib/cek-senet/tahsil"
import { CHECK_SETTLEMENT_PREFIXES } from "@/lib/finans/nakit-hareket"
import { acilisFarki, acilisFisi, type AcilisGirdisi } from "@/lib/muhasebe/acilis"
import { kilitliMi, type DefterBaglami, type MuhasebeAyari } from "@/lib/muhasebe/defter.server"
import { parmakIzi, satirAnahtari, satirlariCoz, type CozulmusSatir, type PlanKaydi } from "@/lib/muhasebe/hesap-cozumu"
import { altHesaplariHazirla, planHaritasi } from "@/lib/muhasebe/hesap-plani.server"
import { fisNumaratoru, satirVerisi } from "@/lib/muhasebe/senkron.server"
import type { AltHesapRef, FisSatiri, SatirRolu } from "@/lib/muhasebe/fis"

type Ctx = DefterBaglami & { ayar: MuhasebeAyari }

export const ACILIS_KAYNAGI = "OPENING"

/** Başlangıç anından HEMEN ÖNCEKİ bakiyeler — defterin bütün firmaları (sahip + şubeler). */
export async function acilisGirdisi(ctx: Ctx): Promise<AcilisGirdisi> {
  const sinir = ctx.ayar.startDate
  const ids = ctx.sirketIds

  const [cariler, finans, kiymetler, tahsiller, personel] = await Promise.all([
    Promise.all(ids.map((id) => cariBalancesAsOf(id, sinir))),
    // Hesap başına geri sarım — `cashBalanceBefore` ile AYNI işaretler, hesap düzeyinde.
    // Sınırdan sonra açılmış hesap burada yok: açılış bakiyesi kendi tarihinde fişlenir.
    prisma.$queryRaw<Array<{ id: string; name: string; type: string; bakiye: unknown }>>`
      SELECT fa.id, fa.name, fa.type,
        fa.balance
        - COALESCE((
            SELECT SUM(CASE WHEN t.type = 'INCOME' THEN t.amount
                            WHEN t.type IN ('EXPENSE', 'TRANSFER') THEN -t.amount ELSE 0 END)
            FROM transactions t WHERE t."accountId" = fa.id AND t.date >= ${sinir}
          ), 0)
        - COALESCE((
            SELECT SUM(CASE WHEN i.type = 'SALES' THEN ip.amount ELSE -ip.amount END)
            FROM invoice_payments ip JOIN invoices i ON i.id = ip."invoiceId"
            WHERE ip."accountId" = fa.id AND ip."transactionId" IS NULL AND ip."paymentDate" >= ${sinir}
          ), 0) AS bakiye
      FROM financial_accounts fa
      WHERE fa."companyId" IN (${Prisma.join(ids)}) AND fa."createdAt" < ${sinir}
    `,
    Promise.all([
      prisma.check.findMany({
        where: { companyId: { in: ids }, issueDate: { lt: sinir }, status: { in: [PORTFOY_DURUMU, TAHSIL_DURUMU] } },
        select: { id: true, amount: true, status: true, issueDate: true, direction: true, supplierId: true },
      }),
      prisma.promissoryNote.findMany({
        where: { companyId: { in: ids }, issueDate: { lt: sinir }, status: { in: [PORTFOY_DURUMU, TAHSIL_DURUMU] } },
        select: { id: true, amount: true, status: true, issueDate: true, direction: true, supplierId: true },
      }),
    ]),
    prisma.transaction.findMany({
      where: {
        companyId: { in: ids },
        OR: [
          { reference: { startsWith: CHECK_SETTLEMENT_PREFIXES.CHECK } },
          { reference: { startsWith: CHECK_SETTLEMENT_PREFIXES.PROMISSORY_NOTE } },
        ],
      },
      select: { reference: true, date: true },
    }),
    Promise.all(ids.map((id) => employeeBalances(id, sinir))),
  ])

  const musteriBakiye = cariler.flatMap((c) => c.customers).filter((c) => Math.abs(c.balance) >= 0.005)
  const tedarikciBakiye = cariler.flatMap((c) => c.suppliers).filter((c) => Math.abs(c.balance) >= 0.005)
  const personelBakiye = personel.flat()
  const [musteriAd, tedarikciAd, personelAd] = await Promise.all([
    prisma.customer.findMany({ where: { id: { in: musteriBakiye.map((m) => m.id) } }, select: { id: true, name: true } }),
    prisma.supplier.findMany({ where: { id: { in: tedarikciBakiye.map((m) => m.id) } }, select: { id: true, name: true } }),
    prisma.employee.findMany({
      where: { id: { in: personelBakiye.map((p) => p.employeeId) } },
      select: { id: true, firstName: true, lastName: true },
    }),
  ])
  const adi = (liste: Array<{ id: string; name: string }>) => new Map(liste.map((x) => [x.id, x.name]))
  const mAd = adi(musteriAd)
  const tAd = adi(tedarikciAd)
  const pAd = new Map(personelAd.map((p) => [p.id, `${p.firstName} ${p.lastName}`.trim()]))

  const tahsilTarihi = new Map<string, Date>()
  for (const t of tahsiller) if (t.reference) tahsilTarihi.set(t.reference, t.date)
  const [cekler, senetler] = kiymetler
  const cekPortfoy = kiymetPortfoyu(
    cekler.map((c) => ({ ...c, settledAt: tahsilTarihi.get(settlementReference("CHECK", c.id)) ?? null })),
    sinir,
  )
  const senetPortfoy = kiymetPortfoyu(
    senetler.map((n) => ({ ...n, settledAt: tahsilTarihi.get(settlementReference("PROMISSORY_NOTE", n.id)) ?? null })),
    sinir,
  )

  return {
    tarih: sinir,
    musteriler: musteriBakiye.map((m) => ({ id: m.id, ad: mAd.get(m.id) ?? "Müşteri", bakiye: m.balance })),
    tedarikciler: tedarikciBakiye.map((t) => ({ id: t.id, ad: tAd.get(t.id) ?? "Tedarikçi", bakiye: t.balance })),
    finans: finans
      .map((f) => ({ id: f.id, ad: f.name, tur: f.type, bakiye: Number(f.bakiye ?? 0) }))
      .filter((f) => Math.abs(f.bakiye) >= 0.005),
    kiymet: {
      alinanCek: cekPortfoy.received,
      verilenCek: cekPortfoy.given,
      alinanSenet: senetPortfoy.received,
      verilenSenet: senetPortfoy.given,
    },
    personel: personelBakiye.map((p) => ({ id: p.employeeId, ad: pAd.get(p.employeeId) ?? "Personel", bakiye: p.balance })),
  }
}

/**
 * Açılış fişini kaynak bakiyelerle aynı tutar (senkronun açılış karşılığı).
 *
 *   yok                → taslak açılır
 *   taslak, iz değişti  → otomatik satırlar yenilenir; ELLE eklenen satırlar ve elle
 *                         seçilen hesaplar korunur, fark satırı yeniden hesaplanır
 *   onaylı, iz değişti  → "belge değişti" işaretlenir (başlangıçtan önceki bir kayıt
 *                         sonradan değişmiş demektir)
 */
export async function acilisSenkronla(ctx: Ctx): Promise<{ fisId: string; degisti: boolean }> {
  const fis = acilisFisi(await acilisGirdisi(ctx))
  const iz = parmakIzi(fis)
  const mevcut = await prisma.journalVoucher.findFirst({
    where: { companyId: ctx.defterId, sourceType: ACILIS_KAYNAGI, sourceId: ctx.defterId },
    select: { id: true, status: true, sourceHash: true, sourceChangedAt: true, date: true },
  })

  if (mevcut && mevcut.status === "POSTED") {
    if (mevcut.sourceHash === iz && mevcut.sourceChangedAt) {
      await prisma.journalVoucher.update({ where: { id: mevcut.id }, data: { sourceChangedAt: null } })
    } else if (mevcut.sourceHash !== iz && !mevcut.sourceChangedAt) {
      await prisma.journalVoucher.update({ where: { id: mevcut.id }, data: { sourceChangedAt: new Date() } })
    }
    return { fisId: mevcut.id, degisti: mevcut.sourceHash !== iz }
  }
  if (mevcut && mevcut.sourceHash === iz && mevcut.date.getTime() === fis.tarih.getTime()) {
    return { fisId: mevcut.id, degisti: false }
  }
  if (mevcut && kilitliMi(ctx.ayar, mevcut.date)) return { fisId: mevcut.id, degisti: false }

  // Elle eklenen satırlar ve elle seçilen hesaplar (yeniden üretimde korunur).
  const eski = mevcut
    ? await prisma.journalVoucherLine.findMany({
        where: { voucherId: mevcut.id },
        select: {
          role: true,
          side: true,
          amount: true,
          description: true,
          learnKeys: true,
          suggestedCode: true,
          accountId: true,
          accountSource: true,
          account: { select: { id: true, code: true, isActive: true } },
        },
      })
    : []

  const refs: AltHesapRef[] = fis.satirlar.flatMap((s) => (s.alt ? [s.alt] : []))
  const alt = await altHesaplariHazirla(ctx.defterId, refs)
  const plan = await planHaritasi(ctx.defterId)
  const kullanici = new Map<string, PlanKaydi>()
  for (const e of eski) {
    if (e.accountSource !== "USER" || !e.account) continue
    const h = plan.get(e.account.code)
    if (h) kullanici.set(satirAnahtari({ rol: e.role as SatirRolu, taraf: e.side === "DEBIT" ? "B" : "A", aciklama: e.description ?? "", anahtarlar: e.learnKeys }), h)
  }

  const otomatik = fis.satirlar.filter((s) => s.rol !== "ACILIS_FARK")
  const elle: CozulmusSatir[] = eski
    .filter((e) => e.role === "MANUEL")
    .map((e) => ({
      taraf: e.side === "DEBIT" ? "B" : "A",
      tutar: Number(e.amount),
      rol: "MANUEL",
      hesapKodu: e.account?.code ?? null,
      oneriKodu: e.suggestedCode,
      kaynak: "yok",
      anahtarlar: [],
      aciklama: e.description ?? "",
      accountId: e.accountId,
      accountSource: e.accountId ? "USER" : "NONE",
    }))
  const farkSatiri = acilisFarki([...otomatik, ...elle])
  const cozulecek: FisSatiri[] = farkSatiri ? [...otomatik, farkSatiri] : otomatik
  const { satirlar } = satirlariCoz(cozulecek, { plan, alt, kullanici })
  const tum = [...satirlar, ...elle].sort((a, b) => (a.taraf === b.taraf ? 0 : a.taraf === "B" ? -1 : 1))
  const emin = tum.every((s) => s.accountId && !(s.accountSource === "DEFAULT" && s.rol === "ACILIS_FARK"))

  if (!mevcut) {
    const numara = fisNumaratoru(ctx.defterId)
    const voucherNo = await numara.sonraki(fis.tarih)
    const yeni = await prisma.journalVoucher.create({
      data: {
        companyId: ctx.defterId,
        voucherNo,
        date: fis.tarih,
        description: fis.aciklama,
        status: "DRAFT",
        sourceType: ACILIS_KAYNAGI,
        sourceId: ctx.defterId,
        sourceHash: iz,
        sourceCompanyId: ctx.defterId,
        kind: "ACILIS",
        isConfident: emin,
        lines: { create: tum.map((s, i) => satirVerisi(ctx.defterId, s, i)) },
      },
      select: { id: true },
    })
    await prisma.accountingSettings.update({ where: { companyId: ctx.defterId }, data: { openingVoucherId: yeni.id } })
    return { fisId: yeni.id, degisti: true }
  }

  await prisma.$transaction([
    prisma.journalVoucherLine.deleteMany({ where: { voucherId: mevcut.id } }),
    prisma.journalVoucher.update({
      where: { id: mevcut.id },
      data: { date: fis.tarih, sourceHash: iz, sourceChangedAt: null, isConfident: emin },
    }),
    prisma.journalVoucherLine.createMany({
      data: tum.map((s, i) => ({ ...satirVerisi(ctx.defterId, s, i), voucherId: mevcut.id })),
    }),
  ])
  return { fisId: mevcut.id, degisti: true }
}
