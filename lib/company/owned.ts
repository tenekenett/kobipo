import { prisma } from "@/lib/db/prisma"

/**
 * Gövdeden gelen yabancı anahtarların İSTEĞİN FİRMASINA ait olduğunu doğrular.
 *
 * `ensureCompanyAccess` "bu firmaya erişebilir misin" sorusunu cevaplar; "gövdedeki
 * ürün/cari/depo id'si bu firmanın mı" sorusunu SORMAZ. FK'ler tabloda global olduğu
 * için başka firmanın id'siyle `connect` sessizce başarılı olur: fatura yabancı ürüne
 * bağlanır, stok düşümü o firmanın kartına yazılır, yanıtta yabancı cari kartı döner
 * ve cari bakiye CTE'leri (firma süzgeçsiz `customerId` birleşimi) o carinin
 * bakiyesini bozar. Ölçüldü (2026-09-15): canlıda çapraz kayıt 0, ama kapı yoktu.
 *
 * Neden 404 değil 403: kayıt VAR, sadece bu firmanın değil. Bayat istemci durumu
 * (firma değiştirilmiş, ürün listesi eski firmadan kalmış) en olası sebep; "bulunamadı"
 * kullanıcıyı yanlış yere bakmaya yollar, "bu firmaya ait değil" doğru yere.
 *
 * Mesaj "Access denied" ile başlar: mevcut route catch'leri onu `accessDeniedResponse`a
 * yollar, orası bu hatayı tanıyıp `code: FOREIGN_RECORD` ve okunur mesajla 403 döner.
 * Listeyi boş/undefined vermek "doğrulanacak bir şey yok" demektir; hata değildir.
 */

export const FOREIGN_RECORD_CODE = "FOREIGN_RECORD" as const

const LABELS = {
  product: "ürün",
  customer: "müşteri",
  supplier: "tedarikçi",
  warehouse: "depo",
  invoice: "fatura",
  accountPlan: "hesap planı kaydı",
  employee: "personel",
  order: "sipariş",
  quote: "teklif",
  waybill: "irsaliye",
  financialAccount: "kasa/banka hesabı",
} as const

export type OwnedModel = keyof typeof LABELS

export class ForeignRecordError extends Error {
  readonly code = FOREIGN_RECORD_CODE
  constructor(
    readonly model: OwnedModel,
    readonly ids: string[],
  ) {
    super(`Access denied: foreign ${model} [${ids.join(",")}]`)
    this.name = "ForeignRecordError"
  }
  /** Kullanıcıya gösterilecek metin — id basılmaz. */
  get messageTr(): string {
    const label = LABELS[this.model]
    return this.ids.length > 1
      ? `Seçilen ${label} kayıtlarından ${this.ids.length} tanesi bu firmaya ait değil. Sayfayı yenileyip tekrar seçin.`
      : `Seçilen ${label} bu firmaya ait değil. Sayfayı yenileyip tekrar seçin.`
  }
}

export function foreignRecordFrom(error: unknown): ForeignRecordError | null {
  return error instanceof ForeignRecordError ? error : null
}

type IdLike = string | null | undefined
export type OwnedRefs = Partial<Record<OwnedModel, IdLike | IdLike[]>>

/** `count` metodunu taşıyan her delegate — PrismaClient ya da `$transaction` istemcisi. */
type OwnedDb = {
  [M in OwnedModel]: { count(args: { where: { id: { in: string[] }; companyId: string } }): Promise<number> }
}

function normalize(value: IdLike | IdLike[]): string[] {
  const list = Array.isArray(value) ? value : [value]
  const out = new Set<string>()
  for (const v of list) {
    if (typeof v === "string" && v.trim()) out.add(v.trim())
  }
  return [...out]
}

/**
 * Verilen id'lerin TAMAMI `companyId`ye ait değilse fırlatır. Model başına tek
 * `count`; hangi id'lerin yabancı olduğunu bulmak için ikinci sorgu yalnız hata
 * yolunda çalışır.
 */
export async function assertOwned(
  db: OwnedDb,
  companyId: string,
  refs: OwnedRefs,
): Promise<void> {
  for (const model of Object.keys(refs) as OwnedModel[]) {
    const ids = normalize(refs[model])
    if (ids.length === 0) continue
    const owned = await db[model].count({ where: { id: { in: ids }, companyId } })
    if (owned === ids.length) continue
    // Hata yolu: hangileri yabancı? (Var olmayan id de "yabancı" sayılır — FK zaten
    // patlayacaktı, kullanıcıya aynı cümle yeter.)
    const found = await (db[model] as unknown as {
      findMany(args: { where: { id: { in: string[] }; companyId: string }; select: { id: true } }): Promise<{ id: string }[]>
    }).findMany({ where: { id: { in: ids }, companyId }, select: { id: true } })
    const ownedIds = new Set(found.map((r) => r.id))
    throw new ForeignRecordError(model, ids.filter((id) => !ownedIds.has(id)))
  }
}

/** Varsayılan istemciyle kısayol. */
export function assertOwnedByCompany(companyId: string, refs: OwnedRefs): Promise<void> {
  return assertOwned(prisma as unknown as OwnedDb, companyId, refs)
}
