/**
 * ÇALIŞAN MASRAF DEFTERİ — okuma ve "Çalışana öde" yazma yolu (sunucu).
 *
 * Kural ve sabitler `calisan-odemesi.ts`te (saf). Defter satırı TUTAR TUTMAZ;
 * tutar/tarih bağlı para kaydından okunur (gider → fatura ödemesi, iade → kasa
 * hareketi). Bakiye TEK yerden kurulur: personel kartı, bilanço ve nakit
 * projeksiyonu hep `employeeBalances`/`loadEmployeeLedger` üzerinden okur.
 */

import { prisma } from "@/lib/db/prisma"
import { Decimal } from "@prisma/client/runtime/library"
import { EMPLOYEE_REIMBURSEMENT_PREFIX } from "@/lib/finans/nakit-hareket"
import { LEDGER_EXPENSE, LEDGER_REIMBURSEMENT, ledgerBalance } from "./calisan-odemesi"

export type EmployeeLedgerRow = {
  id: string
  kind: typeof LEDGER_EXPENSE | typeof LEDGER_REIMBURSEMENT
  date: string
  amount: number
  /** Satırdan sonra yürüyen bakiye (eskiden yeniye). */
  runningBalance: number
  notes: string | null
  /** Gider satırı: cebinden ödenen fatura. */
  invoice: { id: string; slug: string; invoiceNo: string; supplierName: string | null } | null
  /** İade satırı: paranın çıktığı kasa/banka. */
  account: { id: string; name: string } | null
}

export type EmployeeLedger = {
  rows: EmployeeLedgerRow[]
  totalExpense: number
  totalReimbursed: number
  balance: number
}

const LEDGER_INCLUDE = {
  invoicePayment: {
    select: {
      amount: true,
      paymentDate: true,
      notes: true,
      invoice: {
        select: {
          id: true,
          slug: true,
          invoiceNo: true,
          eDocumentNo: true,
          supplier: { select: { name: true } },
        },
      },
    },
  },
  transaction: {
    select: {
      amount: true,
      date: true,
      description: true,
      account: { select: { id: true, name: true } },
    },
  },
} as const

type LedgerEntryWithLinks = Awaited<
  ReturnType<typeof prisma.employeeLedgerEntry.findMany<{ include: typeof LEDGER_INCLUDE }>>
>[number]

/** Bağlı para kaydından tutar + tarih. Bağ yoksa (olmamalı; CHECK kısıtı) null. */
function amountAndDate(e: LedgerEntryWithLinks): { amount: number; date: Date } | null {
  if (e.kind === LEDGER_EXPENSE && e.invoicePayment) {
    return { amount: Number(e.invoicePayment.amount), date: e.invoicePayment.paymentDate }
  }
  if (e.kind === LEDGER_REIMBURSEMENT && e.transaction) {
    return { amount: Number(e.transaction.amount), date: e.transaction.date }
  }
  return null
}

/** Tek çalışanın defteri — personel kartının "Masraflar" sekmesi. */
export async function loadEmployeeLedger(companyId: string, employeeId: string): Promise<EmployeeLedger> {
  const entries = await prisma.employeeLedgerEntry.findMany({
    where: { companyId, employeeId },
    include: LEDGER_INCLUDE,
  })

  const dated = entries
    .map((e) => ({ e, v: amountAndDate(e) }))
    .filter((x): x is { e: LedgerEntryWithLinks; v: { amount: number; date: Date } } => x.v !== null)
    .sort((a, b) => a.v.date.getTime() - b.v.date.getTime() || a.e.createdAt.getTime() - b.e.createdAt.getTime())

  let running = 0
  let totalExpense = 0
  let totalReimbursed = 0
  const rows: EmployeeLedgerRow[] = dated.map(({ e, v }) => {
    if (e.kind === LEDGER_EXPENSE) {
      totalExpense += v.amount
      running += v.amount
    } else {
      totalReimbursed += v.amount
      running -= v.amount
    }
    running = Math.round(running * 100) / 100
    const inv = e.invoicePayment?.invoice
    return {
      id: e.id,
      kind: e.kind === LEDGER_EXPENSE ? LEDGER_EXPENSE : LEDGER_REIMBURSEMENT,
      date: v.date.toISOString(),
      amount: v.amount,
      runningBalance: running,
      notes: e.kind === LEDGER_EXPENSE ? e.invoicePayment?.notes ?? null : e.transaction?.description ?? null,
      invoice: inv
        ? {
            id: inv.id,
            slug: inv.slug || inv.id,
            invoiceNo: inv.eDocumentNo || inv.invoiceNo,
            supplierName: inv.supplier?.name ?? null,
          }
        : null,
      account: e.transaction?.account ?? null,
    }
  })

  const round2 = (n: number) => Math.round(n * 100) / 100
  return {
    rows,
    totalExpense: round2(totalExpense),
    totalReimbursed: round2(totalReimbursed),
    balance: ledgerBalance(rows.map((r) => ({ kind: r.kind, amount: r.amount }))),
  }
}

/**
 * Çalışan başına bakiye, `before` anından ÖNCEKİ kayıtlarla (dışlayıcı sınır;
 * verilmezse bugüne kadar). Sıfır bakiyeli çalışan dönmez.
 *
 * Bilanço (+ → "personele borçlar", − → "personelden alacaklar") ve nakit
 * projeksiyonu (+ → vadesiz çıkış) buradan okur.
 */
export async function employeeBalances(
  companyId: string,
  before?: Date,
): Promise<Array<{ employeeId: string; balance: number }>> {
  const entries = await prisma.employeeLedgerEntry.findMany({
    where: { companyId },
    include: LEDGER_INCLUDE,
  })
  const byEmployee = new Map<string, Array<{ kind: string; amount: number }>>()
  for (const e of entries) {
    const v = amountAndDate(e)
    if (!v) continue
    if (before && v.date.getTime() >= before.getTime()) continue
    const list = byEmployee.get(e.employeeId) ?? []
    list.push({ kind: e.kind, amount: v.amount })
    byEmployee.set(e.employeeId, list)
  }
  const out: Array<{ employeeId: string; balance: number }> = []
  for (const [employeeId, rows] of byEmployee) {
    const balance = ledgerBalance(rows)
    if (balance !== 0) out.push({ employeeId, balance })
  }
  return out
}

export type ReimburseResult =
  | { ok: true; entryId: string; transactionId: string; balance: number }
  | { ok: false; status: number; error: string }

/**
 * ÇALIŞANA ÖDE — firmanın çalışana borcunu kasadan/bankadan kapatır.
 *
 * Kasa hareketi + hesap bakiyesi + defter satırı TEK işlemde. Tutar borcu
 * aşamaz: fazlası çalışana verilmiş bir avanstır ve bu defterin konusu değil —
 * kabul edilseydi bakiye sessizce "çalışanın firmaya borcu"na dönerdi.
 */
export async function reimburseEmployee(args: {
  companyId: string
  employeeId: string
  amount: unknown
  accountId: unknown
  date?: unknown
  notes?: unknown
  userId: string | null
}): Promise<ReimburseResult> {
  const amount = new Decimal(Number(args.amount) || 0).toDecimalPlaces(2)
  if (!amount.greaterThan(0)) return { ok: false, status: 400, error: "Tutar 0'dan büyük olmalı" }

  const accountId = typeof args.accountId === "string" ? args.accountId.trim() : ""
  if (!accountId) return { ok: false, status: 400, error: "Ödemenin çıkacağı kasa/banka hesabını seçin" }

  const date = typeof args.date === "string" && args.date.trim() ? new Date(args.date) : new Date()
  if (Number.isNaN(date.getTime())) return { ok: false, status: 400, error: "Tarih geçersiz" }

  const [employee, account] = await Promise.all([
    prisma.employee.findFirst({
      where: { id: args.employeeId, companyId: args.companyId },
      select: { id: true, firstName: true, lastName: true },
    }),
    prisma.financialAccount.findFirst({
      where: { id: accountId, companyId: args.companyId },
      select: { id: true },
    }),
  ])
  if (!employee) return { ok: false, status: 404, error: "Çalışan bulunamadı" }
  if (!account) return { ok: false, status: 404, error: "Hesap bulunamadı" }

  const ledger = await loadEmployeeLedger(args.companyId, employee.id)
  if (amount.greaterThan(ledger.balance)) {
    return {
      ok: false,
      status: 400,
      error:
        ledger.balance > 0
          ? `Tutar çalışana olan borcu (${ledger.balance.toFixed(2)} TL) aşıyor`
          : "Bu çalışana ödenecek masraf borcu yok",
    }
  }

  const name = `${employee.firstName} ${employee.lastName}`.trim()
  const notes = typeof args.notes === "string" && args.notes.trim() ? args.notes.trim() : null

  const result = await prisma.$transaction(async (db) => {
    const trx = await db.transaction.create({
      data: {
        companyId: args.companyId,
        accountId: account.id,
        type: "EXPENSE",
        amount,
        currency: "TRY",
        description: notes ? `Masraf iadesi — ${name} · ${notes}` : `Masraf iadesi — ${name}`,
        date,
        // Önek kâr/zarar süzgecinin anahtarı (lib/finans/nakit-hareket.ts): gider
        // faturada sayıldı, bu hareket ikinci kez gider yazılmamalı.
        reference: `${EMPLOYEE_REIMBURSEMENT_PREFIX}${employee.id}`,
        createdBy: args.userId,
      },
    })
    await db.financialAccount.update({
      where: { id: account.id },
      data: { balance: { decrement: amount } },
    })
    const entry = await db.employeeLedgerEntry.create({
      data: {
        companyId: args.companyId,
        employeeId: employee.id,
        kind: LEDGER_REIMBURSEMENT,
        transactionId: trx.id,
        createdBy: args.userId,
      },
    })
    return { entryId: entry.id, transactionId: trx.id }
  })

  return {
    ok: true,
    ...result,
    balance: Math.round((ledger.balance - amount.toNumber()) * 100) / 100,
  }
}

/**
 * Geri ödemeyi GERİ AL — kasa hareketi silinir, hesap bakiyesi geri yazılır;
 * defter satırı hareketle birlikte düşer (Cascade). Gider satırı buradan
 * silinmez: onun sahibi fatura ödemesidir (Faturalar → Ödemeler).
 */
export async function revertReimbursement(args: {
  companyId: string
  entryId: string
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const entry = await prisma.employeeLedgerEntry.findFirst({
    where: { id: args.entryId, companyId: args.companyId },
    include: { transaction: { select: { id: true, amount: true, accountId: true } } },
  })
  if (!entry) return { ok: false, status: 404, error: "Kayıt bulunamadı" }
  if (entry.kind !== LEDGER_REIMBURSEMENT || !entry.transaction) {
    return {
      ok: false,
      status: 400,
      error: "Çalışanın ödediği fatura buradan silinmez; faturanın Ödemeler ekranından kaldırın",
    }
  }
  const trx = entry.transaction
  await prisma.$transaction(async (db) => {
    await db.financialAccount.update({
      where: { id: trx.accountId },
      data: { balance: { increment: trx.amount } },
    })
    // Hareketin silinmesi defter satırını da siler (onDelete: Cascade).
    await db.transaction.delete({ where: { id: trx.id } })
  })
  return { ok: true }
}
