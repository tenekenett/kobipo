/**
 * ÇEK/SENEDİN FATURA BAĞI — gövde → kayıt alanları, saf.
 *
 * Bağ çoklu (`invoiceIds`) ama BİLGİ amaçlıdır: cari bakiye çekin kendisinden
 * düşer (list-query → check_note_totals), faturanın açık tutarına InvoicePayment
 * yazılmaz. `invoiceId` listenin İLKİ olarak dolu tutulur — makbuz, detay ucu ve
 * eski istemciler onu okuyor; boşaltılsaydı geçmiş çeklerin bağı ekranda kaybolurdu.
 *
 * Gövde iki biçimde gelebilir: `invoiceIds: string[]` (yeni) ya da `invoiceId`
 * (eski). İkisi de verilmemişse PUT'ta alana DOKUNULMAZ.
 */

export type InvoiceLinkBody = { invoiceIds?: unknown; invoiceId?: unknown }

export function hasInvoiceLinkField(body: InvoiceLinkBody): boolean {
  return body.invoiceIds !== undefined || body.invoiceId !== undefined
}

/** Tekrarsız, boşsuz id listesi; sıra korunur (dağıtım eskiden yeniye çağıranın işi). */
export function normalizeInvoiceLinks(body: InvoiceLinkBody): string[] {
  const raw = [
    ...(Array.isArray(body.invoiceIds) ? body.invoiceIds : []),
    ...(body.invoiceId !== undefined && body.invoiceId !== null ? [body.invoiceId] : []),
  ]
  const out: string[] = []
  for (const v of raw) {
    if (typeof v !== "string") continue
    const id = v.trim()
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}

/** Prisma'ya yazılacak iki alan birlikte — biri güncellenip öteki unutulmasın. */
export function invoiceLinkData(ids: string[]): { invoiceIds: string[]; invoiceId: string | null } {
  return { invoiceIds: ids, invoiceId: ids[0] ?? null }
}

/** Kayıttan okurken: yeni liste boşsa eski tek alana düş (migrasyon öncesi kayıt). */
export function linkedInvoiceIds(record: { invoiceIds?: string[] | null; invoiceId?: string | null }): string[] {
  if (record.invoiceIds && record.invoiceIds.length > 0) return record.invoiceIds
  return record.invoiceId ? [record.invoiceId] : []
}
