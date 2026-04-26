type TransactionClient = Parameters<Parameters<typeof import("@/lib/db/prisma").prisma["$transaction"]>[0]>[0]

export async function supplierHasBusinessReferences(tx: TransactionClient, supplierId: string): Promise<boolean> {
  const [
    inv,
    trx,
    quotes,
    checks,
    notes,
    waybills,
  ] = await Promise.all([
    tx.invoice.count({ where: { supplierId } }),
    tx.transaction.count({ where: { supplierId } }),
    tx.quote.count({ where: { supplierId } }),
    tx.check.count({ where: { supplierId } }),
    tx.promissoryNote.count({ where: { supplierId } }),
    tx.waybill.count({ where: { supplierId } }),
  ])
  return inv + trx + quotes + checks + notes + waybills > 0
}

export async function customerHasBusinessReferences(tx: TransactionClient, customerId: string): Promise<boolean> {
  const [inv, trx, quotes, checks, notes, waybills] = await Promise.all([
    tx.invoice.count({ where: { customerId } }),
    tx.transaction.count({ where: { customerId } }),
    tx.quote.count({ where: { customerId } }),
    tx.check.count({ where: { customerId } }),
    tx.promissoryNote.count({ where: { customerId } }),
    tx.waybill.count({ where: { customerId } }),
  ])
  return inv + trx + quotes + checks + notes + waybills > 0
}
