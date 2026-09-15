import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"

/**
 * ŞUBE = aynı tüzel kişinin ikinci adresi (CLAUDE.md → "Şube ≠ firma"). VKN, vergi
 * dairesi ve e-Dönüşüm kimliği ANA FİRMANINDIR; şube bunları açılırken devralır
 * (lib/company/create-company.ts → InheritedIdentity) ve SONRADAN DEĞİŞTİREMEZ.
 *
 * Kilit iki yönlü çalışır:
 *  - Şubede bu alanlar düzenlenemez (`assertBranchIdentityLocked`): şube VKN'si ana
 *    firmadan ayrışırsa e-belge yanlış mükelleften gider, kontör yanlış hesaptan düşer.
 *  - Ana firmada değişince şubelere YAYILIR (`propagateIdentityToBranches`): aksi hâlde
 *    devralma yalnız açılış anı için doğru olur, VKN düzeltmesi şubeye hiç ulaşmazdı.
 *
 * Adres/şehir/ilçe/telefon şubenin KENDİSİNİNDİR — kilitte değildir (branch-party.ts).
 */
export const BRANCH_INHERITED_FIELDS = [
  "taxNumber",
  "taxOffice",
  "isEDonusumEnabled",
  "eDonusumIntegrator",
  "eDonusumProvider",
  "eDonusumApiUsername",
  "eDonusumApiPassword",
  "eDonusumAlias",
  "eDonusumApiUrl",
  "eDonusumTenantVkn",
  "eDonusumConnectorGuid",
  "eDonusumPkAlias",
  "eDonusumGbAlias",
  "eFaturaPrefix",
  "eArchivePrefix",
  "eFaturaBackdatePrefix",
  "eArchiveBackdatePrefix",
] as const

export type BranchInheritedField = (typeof BRANCH_INHERITED_FIELDS)[number]

const LABELS: Record<BranchInheritedField, string> = {
  taxNumber: "Vergi No",
  taxOffice: "Vergi Dairesi",
  isEDonusumEnabled: "e-Dönüşüm",
  eDonusumIntegrator: "e-Dönüşüm entegratörü",
  eDonusumProvider: "e-Dönüşüm sağlayıcısı",
  eDonusumApiUsername: "e-Dönüşüm kullanıcı adı",
  eDonusumApiPassword: "e-Dönüşüm şifresi",
  eDonusumAlias: "e-Dönüşüm etiketi",
  eDonusumApiUrl: "e-Dönüşüm adresi",
  eDonusumTenantVkn: "Mükellef VKN",
  eDonusumConnectorGuid: "e-Dönüşüm bağlantı kimliği",
  eDonusumPkAlias: "PK etiketi",
  eDonusumGbAlias: "GB etiketi",
  eFaturaPrefix: "e-Fatura seri ön eki",
  eArchivePrefix: "e-Arşiv seri ön eki",
  eFaturaBackdatePrefix: "e-Fatura geçmiş tarih ön eki",
  eArchiveBackdatePrefix: "e-Arşiv geçmiş tarih ön eki",
}

export class BranchIdentityLockedError extends Error {
  readonly code = "BRANCH_IDENTITY_LOCKED" as const
  constructor(readonly fields: BranchInheritedField[]) {
    super(`Branch identity locked: ${fields.join(",")}`)
    this.name = "BranchIdentityLockedError"
  }
  get messageTr(): string {
    const list = this.fields.map((f) => LABELS[f]).join(", ")
    return `${list} şubede değiştirilemez; bu bilgiler ana firmadan devralınır. Ana firmanın ayarlarından güncelleyin.`
  }
}

/** Kilitli alanlardan gövdede DEĞER TAŞIYANLAR — undefined "gönderilmedi" demektir. */
function sentLockedFields(body: Record<string, unknown>): BranchInheritedField[] {
  return BRANCH_INHERITED_FIELDS.filter((f) => body[f] !== undefined)
}

/**
 * Şube için istek gövdesindeki kilitli alanları denetler. Alanın gönderilmesi tek
 * başına hata DEĞİL — ayar formu her kaydetmede tüm alanları yollar; hata yalnız
 * değer MEVCUTTAN FARKLIYSA. Şifre alanı "***" maskeyle döner, o da fark sayılmaz.
 */
export function assertBranchIdentityLocked(
  company: { parentCompanyId: string | null } & Partial<Record<BranchInheritedField, unknown>>,
  body: Record<string, unknown>,
): void {
  if (!company.parentCompanyId) return
  const changed = sentLockedFields(body).filter((f) => {
    const incoming = body[f]
    const current = company[f]
    if (f === "eDonusumApiPassword") {
      // Maske ya da boş = dokunma; dolu bir şifre şubede yazılamaz.
      return typeof incoming === "string" && incoming.trim() !== "" && incoming !== "***"
    }
    if (typeof incoming === "boolean" || typeof current === "boolean") {
      return Boolean(incoming) !== Boolean(current)
    }
    const norm = (v: unknown) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v))
    return norm(incoming) !== norm(current)
  })
  if (changed.length > 0) throw new BranchIdentityLockedError(changed)
}

export function branchIdentityLockedFrom(error: unknown): BranchIdentityLockedError | null {
  return error instanceof BranchIdentityLockedError ? error : null
}

/**
 * Ana firmanın güncellenen kimlik alanlarını şubelerine kopyalar. `data` PUT'un
 * yazdığı Prisma verisidir; yalnız kilitli alanlardan `undefined` OLMAYANLAR taşınır.
 * Şube olmayan (parentCompanyId dolu) firmada çağrılmaz — zincir yok.
 */
export async function propagateIdentityToBranches(
  db: Pick<typeof prisma, "company">,
  parentId: string,
  data: Prisma.CompanyUpdateInput | Record<string, unknown>,
): Promise<number> {
  const patch: Record<string, unknown> = {}
  for (const f of BRANCH_INHERITED_FIELDS) {
    const v = (data as Record<string, unknown>)[f]
    if (v !== undefined) patch[f] = v
  }
  if (Object.keys(patch).length === 0) return 0
  const res = await db.company.updateMany({
    where: { parentCompanyId: parentId },
    data: patch as Prisma.CompanyUpdateManyMutationInput,
  })
  return res.count
}
