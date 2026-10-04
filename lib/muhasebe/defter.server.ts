import { prisma } from "@/lib/db/prisma"

/**
 * DEFTERİN SAHİBİ — tüzel kişi. Şube ana firmanın VKN'siyle belge keser (CLAUDE.md
 * "Şube ≠ firma"): şubenin belgeleri ANA FİRMANIN defterine fiş üretir, fiş kaynak
 * şubeyi (`sourceCompanyId`) taşır. Ek firma ayrı VKN'dir → kendi defteri.
 *
 * Kök `resolveAccountRootId` DEĞİLDİR: o faturalama köküdür ve ek firmayı da köke
 * bağlar. Defter için yalnız `parentCompanyId` sorulur.
 */

export const MUHASEBE_MODULU = "accounting"

export type MuhasebeAyari = {
  startDate: Date
  planInstalledAt: Date | null
  openingVoucherId: string | null
  lockedUntil: Date | null
}

export type DefterBaglami = {
  /** Defter sahibi firma (şubede ana firma). Fişler bu firmaya yazılır. */
  defterId: string
  /** Defterin kaynak firmaları: sahibi + şubeleri. */
  sirketIds: string[]
  /** Muhasebe modülü defter sahibinde açık mı. */
  modulAcik: boolean
  /** Kurulum yapılmadıysa null — fiş üretilmez. */
  ayar: MuhasebeAyari | null
}

export async function defterSahibiId(companyId: string): Promise<string> {
  const c = await prisma.company.findUnique({ where: { id: companyId }, select: { parentCompanyId: true } })
  return c?.parentCompanyId ?? companyId
}

export async function defterBaglami(companyId: string): Promise<DefterBaglami | null> {
  const defterId = await defterSahibiId(companyId)
  const [sahip, subeler, ayar] = await Promise.all([
    prisma.company.findUnique({ where: { id: defterId }, select: { id: true, disabledModules: true } }),
    prisma.company.findMany({ where: { parentCompanyId: defterId }, select: { id: true } }),
    prisma.accountingSettings.findUnique({
      where: { companyId: defterId },
      select: { startDate: true, planInstalledAt: true, openingVoucherId: true, lockedUntil: true },
    }),
  ])
  if (!sahip) return null
  return {
    defterId,
    sirketIds: [defterId, ...subeler.map((s) => s.id)],
    modulAcik: !(sahip.disabledModules ?? []).includes(MUHASEBE_MODULU),
    ayar,
  }
}

/** Fiş üretimi bu defterde çalışır mı: modül açık ve kurulum yapılmış. */
export function fisUretilirMi(ctx: DefterBaglami | null): ctx is DefterBaglami & { ayar: MuhasebeAyari } {
  return Boolean(ctx && ctx.modulAcik && ctx.ayar && ctx.ayar.planInstalledAt)
}

/**
 * Tarih kilitli dönemde mi. `lockedUntil` kilitli SON GÜNDÜR (00:00 UTC olarak
 * saklanır) ve o gün DAHİLDİR: saatli kayıt (kasa hareketi 14:30) da o güne aittir.
 */
export function kilitliMi(ayar: Pick<MuhasebeAyari, "lockedUntil"> | null, tarih: Date): boolean {
  if (!ayar?.lockedUntil) return false
  return tarih.getTime() < ayar.lockedUntil.getTime() + 86_400_000
}
