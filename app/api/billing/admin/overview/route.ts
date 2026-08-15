import { NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/auth/require-super-admin"
import { prisma } from "@/lib/db/prisma"

export const dynamic = "force-dynamic"

/**
 * Sistem-admin abonelik/sipariş genel bakışı: her hesap (kök firma) için en güncel abonelik,
 * son siparişler ve kullanım sayaçları. Süper-admin korumalı.
 *
 * Yalnızca hesap KÖKLERİ listelenir: `accountRootId` dolu olan firma (şube ya da satın
 * alınmış ek firma) kendi başına bir hesap değildir, aboneliği kökte durur.
 */
export async function GET() {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error

  const companies = await prisma.company.findMany({
    where: { parentCompanyId: null, accountRootId: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      slug: true,
      disabledModules: true,
      // Hesabın üyeleri: şubeler + ek firmalar. Kota göstergesi bunları ayrı sayar.
      accountMembers: { select: { id: true, name: true, parentCompanyId: true } },
      subscriptions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          provider: true,
          purchasedModules: true,
          branchQuota: true,
          companyQuota: true,
          amount: true,
          autoRenew: true,
          cancelAtPeriodEnd: true,
          billingCycle: true,
          trialEndsAt: true,
          periodEnd: true,
        },
      },
      packageOrders: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          status: true,
          planName: true,
          amount: true,
          currency: true,
          billingCycle: true,
          resolvedModules: true,
          branchQuota: true,
          companyQuota: true,
          autoRenew: true,
          paidAt: true,
          paymentError: true,
          createdAt: true,
        },
      },
      usageLimits: {
        orderBy: { periodStart: "desc" },
        take: 12,
        select: {
          id: true,
          key: true,
          currentValue: true,
          maxValue: true,
          periodStart: true,
          periodEnd: true,
        },
      },
    },
  })

  // Üyeleri iki sayaca ayır: şube (parentCompanyId dolu) ve ek firma (dolu değil).
  // Kota düzenleyicileri "kullanılan" değerini bunlardan okur, tek "üye sayısı" yanıltırdı.
  const data = companies.map(({ accountMembers, ...account }) => ({
    ...account,
    branchCount: accountMembers.filter((m) => m.parentCompanyId).length,
    companyCount: accountMembers.filter((m) => !m.parentCompanyId).length,
  }))

  return NextResponse.json({ data })
}
