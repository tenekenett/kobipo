import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import { CHECK_SETTLEMENT_PREFIXES } from "@/lib/finans/nakit-hareket"

/**
 * ÇEK/SENET TAHSİLİ → KASA HAREKETİ (2026-09-15 kararı).
 *
 * Çek alındığı an (PORTFÖYDE) müşterinin borcunu düşürür — cari sorguları çeki
 * "ödeme" sayar (lib/cari/list-query.ts → check_note_totals). Ama para o an
 * kasada DEĞİLDİR; vadesinde bankadan TAHSİL edilince gelir. Öncesinde bu ikinci
 * adım hiç yazılmıyordu: durum "Tahsil Edildi" yapılıyor, banka bakiyesi
 * değişmiyordu. Kullanıcı elle kasa hareketi girip cariyi de seçerse aynı para
 * cariden İKİ kez düşüyordu.
 *
 * Kural:
 *  - Durum TAHSİL_EDİLDİ olunca seçilen kasa/banka hesabına bir `Transaction`
 *    yazılır: alınan çek (RECEIVED/null) → INCOME, verilen çek (GIVEN) → EXPENSE
 *    (bizim çekimiz bankadan ödenmiştir).
 *  - Hareket CARİ TAŞIMAZ (customerId/supplierId boş): cari etkisi çekin
 *    kendisinde; taşısaydı ekstrede ikinci kez düşerdi.
 *  - Bağ `reference = "CEK:<id>"` / `"SENET:<id>"` ile kurulur (şema değişikliği
 *    gerektirmez; virmanın `TRANSFER:` deseniyle aynı). Kâr/zarar, gelir-gider ve
 *    harcamalar raporları bu öneki GELİR/GİDER SAYMAZ — gelir zaten faturada;
 *    nakit akışı ve kasa bakiyesi sayar (para gerçekten girdi).
 *  - Durum tahsilden geri alınırsa ya da kayıt silinirse hareket silinir, bakiye
 *    geri sarılır. Tutar/hesap değişirse hareket yeniden kurulur.
 */

export type SettlementKind = "CHECK" | "PROMISSORY_NOTE"

export const COLLECTED_STATUS = "TAHSİL_EDİLDİ"

export function settlementReference(kind: SettlementKind, id: string): string {
  return `${CHECK_SETTLEMENT_PREFIXES[kind]}${id}`
}

type Db = Prisma.TransactionClient | typeof prisma

export type SettlementSource = {
  kind: SettlementKind
  companyId: string
  id: string
  /** Çek no / senet no — hareket açıklaması için. */
  no: string
  bankName?: string | null
  amount: Prisma.Decimal | number | string
  direction?: string | null
  status: string
  /** Tahsil edilen kasa/banka; durum tahsile geçerken ZORUNLU. */
  accountId?: string | null
  /** Tahsil tarihi; verilmezse bugün. */
  date?: Date | null
  createdBy?: string | null
}

export class SettlementAccountRequiredError extends Error {
  readonly code = "SETTLEMENT_ACCOUNT_REQUIRED" as const
  constructor() {
    super("Settlement account required")
    this.name = "SettlementAccountRequiredError"
  }
  get messageTr(): string {
    return "Tahsil edildi olarak işaretlemek için paranın girdiği kasa/banka hesabını seçin."
  }
}

export function settlementAccountRequiredFrom(error: unknown): SettlementAccountRequiredError | null {
  return error instanceof SettlementAccountRequiredError ? error : null
}

function directionOf(src: SettlementSource): "INCOME" | "EXPENSE" {
  return String(src.direction || "RECEIVED").toUpperCase() === "GIVEN" ? "EXPENSE" : "INCOME"
}

async function revertAndDelete(db: Db, tx: { id: string; accountId: string; type: string; amount: Prisma.Decimal }) {
  await db.financialAccount.updateMany({
    where: { id: tx.accountId },
    data: { balance: tx.type === "INCOME" ? { decrement: tx.amount } : { increment: tx.amount } },
  })
  await db.transaction.delete({ where: { id: tx.id } })
}

/**
 * Çek/senet durumuyla kasa hareketini hizalar — İDEMPOTENT. Kaydın yazımından
 * SONRA çağrılır (id gerekir); durum tahsil değilse varsa hareketi geri alır.
 */
export async function syncCheckSettlement(db: Db, src: SettlementSource): Promise<void> {
  const reference = settlementReference(src.kind, src.id)
  const existing = await db.transaction.findFirst({
    where: { companyId: src.companyId, reference },
    select: { id: true, accountId: true, type: true, amount: true },
  })

  const collected = src.status === COLLECTED_STATUS
  if (!collected) {
    if (existing) await revertAndDelete(db, existing)
    return
  }

  const type = directionOf(src)
  const amount = new Prisma.Decimal(src.amount)
  const accountId = src.accountId || existing?.accountId || null
  if (!accountId) throw new SettlementAccountRequiredError()

  if (
    existing &&
    existing.accountId === accountId &&
    existing.type === type &&
    existing.amount.equals(amount)
  ) {
    return // değişen bir şey yok
  }
  if (existing) await revertAndDelete(db, existing)

  const account = await db.financialAccount.findFirst({
    where: { id: accountId, companyId: src.companyId },
    select: { id: true, currency: true },
  })
  if (!account) throw new SettlementAccountRequiredError()

  const label = src.kind === "CHECK" ? "Çek" : "Senet"
  const verb = type === "INCOME" ? "tahsili" : "ödemesi"
  await db.transaction.create({
    data: {
      companyId: src.companyId,
      accountId: account.id,
      type,
      amount,
      currency: account.currency || "TRY",
      description: `${label} ${verb} — ${src.no}${src.bankName ? ` (${src.bankName})` : ""}`,
      date: src.date ?? new Date(),
      reference,
      createdBy: src.createdBy ?? null,
    },
  })
  await db.financialAccount.update({
    where: { id: account.id },
    data: { balance: type === "INCOME" ? { increment: amount } : { decrement: amount } },
  })
}

/** Kayıt silinirken: tahsil hareketi varsa geri sar. */
export async function revertCheckSettlement(db: Db, kind: SettlementKind, companyId: string, id: string): Promise<void> {
  const existing = await db.transaction.findFirst({
    where: { companyId, reference: settlementReference(kind, id) },
    select: { id: true, accountId: true, type: true, amount: true },
  })
  if (existing) await revertAndDelete(db, existing)
}
