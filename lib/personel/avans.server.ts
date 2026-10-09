import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { avansBakiyesi, bordroSonGunu, type AvansSatiri } from "@/lib/personel/avans"
import { muhasebeyeBildir } from "@/lib/muhasebe/senkron.server"

/**
 * PERSONEL AVANSI — okuma ve yazma (kural: lib/personel/avans.ts).
 *
 * Yazma personel tarafındadır (kart → Avanslar; yetki bordro ile aynı: /personel/maas):
 * finans formu çalışan listesini okusaydı maaş bilgisi finansçılara açılırdı.
 */

const ADVANCE = "ADVANCE"

export async function avansDefteri(companyId: string, employeeId: string): Promise<{ satirlar: AvansSatiri[]; bakiye: number }> {
  const [hareketler, bordrolar] = await Promise.all([
    prisma.transaction.findMany({
      where: { companyId, employeeId, purpose: ADVANCE },
      select: { id: true, type: true, amount: true, date: true, description: true, account: { select: { id: true, name: true } } },
      orderBy: { date: "asc" },
    }),
    prisma.payrollRecord.findMany({
      where: { companyId, employeeId, advance: { gt: 0 } },
      select: { id: true, periodYear: true, periodMonth: true, advance: true },
    }),
  ])
  const satirlar: AvansSatiri[] = [
    ...hareketler.map(
      (h): AvansSatiri => ({
        tur: h.type === "INCOME" ? "GERI_ALINDI" : "VERILDI",
        id: h.id,
        tarih: h.date.toISOString(),
        tutar: Number(h.amount),
        aciklama: h.description,
        hesap: { id: h.account.id, ad: h.account.name },
      }),
    ),
    ...bordrolar.map(
      (b): AvansSatiri => ({
        tur: "BORDRO",
        id: b.id,
        tarih: bordroSonGunu(b.periodYear, b.periodMonth).toISOString(),
        tutar: Number(b.advance),
        aciklama: `${String(b.periodMonth).padStart(2, "0")}/${b.periodYear} bordrosundan düşüldü`,
        donem: { yil: b.periodYear, ay: b.periodMonth },
      }),
    ),
  ].sort((a, b) => a.tarih.localeCompare(b.tarih))
  return { satirlar, bakiye: avansBakiyesi(satirlar) }
}

/**
 * Tarih itibarıyla açık avanslar, çalışan başına (bilanço, muhasebe açılışı). `son`
 * DIŞLAYICIDIR. Bordro mahsubu dönemin son günündedir.
 */
export async function avansBakiyeleri(companyIds: string[], son: Date): Promise<Array<{ employeeId: string; ad: string; bakiye: number }>> {
  if (companyIds.length === 0) return []
  const rows = await prisma.$queryRaw<Array<{ employeeId: string; ad: string; bakiye: unknown }>>`
    SELECT e.id AS "employeeId", TRIM(e."firstName" || ' ' || e."lastName") AS ad,
      COALESCE((SELECT SUM(CASE WHEN t.type = 'EXPENSE' THEN t.amount ELSE -t.amount END)
                FROM transactions t WHERE t."employeeId" = e.id AND t.purpose = ${ADVANCE} AND t.date < ${son}), 0)
      - COALESCE((SELECT SUM(p.advance) FROM payroll_records p
                  WHERE p."employeeId" = e.id AND p.advance > 0
                    AND make_date(p."periodYear", p."periodMonth", 1) + interval '1 month' - interval '1 day' < ${son}), 0) AS bakiye
    FROM employees e
    WHERE e."companyId" IN (${Prisma.join(companyIds)})
  `
  return rows
    .map((r) => ({ employeeId: r.employeeId, ad: r.ad, bakiye: Math.round(Number(r.bakiye ?? 0) * 100) / 100 }))
    .filter((r) => r.bakiye !== 0)
}

type Sonuc = { ok: true; transactionId: string; bakiye: number } | { ok: false; status: number; error: string }

export async function avansVer(args: {
  companyId: string
  employeeId: string
  /** "VER" kasadan çalışana, "GERI_AL" çalışandan kasaya. */
  yon: "VER" | "GERI_AL"
  accountId: unknown
  amount: unknown
  date?: unknown
  notes?: unknown
  userId: string | null
}): Promise<Sonuc> {
  const amount = new Prisma.Decimal(Number(args.amount) || 0).toDecimalPlaces(2)
  if (!amount.greaterThan(0)) return { ok: false, status: 400, error: "Tutar 0'dan büyük olmalı" }
  const accountId = typeof args.accountId === "string" ? args.accountId.trim() : ""
  if (!accountId) return { ok: false, status: 400, error: "Kasa/banka hesabını seçin" }
  const date = typeof args.date === "string" && args.date.trim() ? new Date(args.date) : new Date()
  if (Number.isNaN(date.getTime())) return { ok: false, status: 400, error: "Tarih geçersiz" }

  const [employee, account] = await Promise.all([
    prisma.employee.findFirst({ where: { id: args.employeeId, companyId: args.companyId }, select: { id: true, firstName: true, lastName: true } }),
    prisma.financialAccount.findFirst({ where: { id: accountId, companyId: args.companyId }, select: { id: true, currency: true } }),
  ])
  if (!employee) return { ok: false, status: 404, error: "Çalışan bulunamadı" }
  if (!account) return { ok: false, status: 404, error: "Hesap bulunamadı" }
  // Avans TL'dir (bordro TL): dövizli hesaptan avans kuru bilinmeden muhasebeye giremezdi.
  if ((account.currency || "TRY").toUpperCase() !== "TRY") return { ok: false, status: 400, error: "Avans yalnız TL hesaptan verilir" }

  const defter = await avansDefteri(args.companyId, employee.id)
  if (args.yon === "GERI_AL" && amount.greaterThan(defter.bakiye)) {
    return {
      ok: false,
      status: 400,
      error: defter.bakiye > 0 ? `Tutar açık avansı (${defter.bakiye.toFixed(2)} TL) aşıyor` : "Bu çalışanın açık avansı yok",
    }
  }

  const ad = `${employee.firstName} ${employee.lastName}`.trim()
  const notes = typeof args.notes === "string" && args.notes.trim() ? args.notes.trim() : null
  const giris = args.yon === "GERI_AL"
  const baslik = giris ? `Avans iadesi — ${ad}` : `Personel avansı — ${ad}`
  const trx = await prisma.$transaction(async (db) => {
    const t = await db.transaction.create({
      data: {
        companyId: args.companyId,
        accountId: account.id,
        type: giris ? "INCOME" : "EXPENSE",
        amount,
        currency: "TRY",
        description: notes ? `${baslik} · ${notes}` : baslik,
        date,
        purpose: ADVANCE,
        employeeId: employee.id,
        createdBy: args.userId,
      },
    })
    await db.financialAccount.update({
      where: { id: account.id },
      data: { balance: giris ? { increment: amount } : { decrement: amount } },
    })
    return t
  })
  await muhasebeyeBildir(args.companyId, [{ tip: "TRANSACTION", id: trx.id }])
  const n = amount.toNumber()
  return { ok: true, transactionId: trx.id, bakiye: Math.round((defter.bakiye + (giris ? -n : n)) * 100) / 100 }
}

/** Avans hareketini geri al — hareket silinir, kasa bakiyesi geri yazılır. */
export async function avansSil(args: { companyId: string; transactionId: string }): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const t = await prisma.transaction.findFirst({
    where: { id: args.transactionId, companyId: args.companyId, purpose: ADVANCE },
    select: { id: true, type: true, amount: true, accountId: true },
  })
  if (!t) return { ok: false, status: 404, error: "Avans kaydı bulunamadı" }
  await prisma.$transaction(async (db) => {
    await db.transaction.delete({ where: { id: t.id } })
    await db.financialAccount.update({
      where: { id: t.accountId },
      data: { balance: t.type === "INCOME" ? { decrement: t.amount } : { increment: t.amount } },
    })
  })
  await muhasebeyeBildir(args.companyId, [{ tip: "TRANSACTION", id: t.id }])
  return { ok: true }
}
