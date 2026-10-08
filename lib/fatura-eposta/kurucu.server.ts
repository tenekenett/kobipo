import { prisma } from "@/lib/db/prisma"
import { resolveAccountRootId } from "@/lib/billing/entitlements"
import { hesapKurucusu, type Uyelik } from "./kurallar"

/**
 * Firmanın HESABINI AÇAN KİŞİ (kural: kurallar.ts → hesapKurucusu). Şube ve ek firma
 * kendi kurucusunu taşımaz — şubeye doğrudan üyelik verilmez — hesap kökünden okunur.
 */
export async function hesapKurucusuBul(
  companyId: string,
): Promise<{ rootId: string; kurucu: Uyelik | null }> {
  const rootId = await resolveAccountRootId(companyId)
  const uyelikler = await prisma.userCompany.findMany({
    where: { companyId: rootId, role: "ADMIN" },
    select: {
      userId: true,
      createdAt: true,
      user: { select: { email: true, isSuperAdmin: true } },
    },
  })
  return {
    rootId,
    kurucu: hesapKurucusu(
      uyelikler.map((u) => ({
        userId: u.userId,
        email: u.user?.email ?? null,
        createdAt: u.createdAt,
        isSuperAdmin: Boolean(u.user?.isSuperAdmin),
      })),
    ),
  }
}
