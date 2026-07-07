import { NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/auth/require-super-admin"
import { prisma } from "@/lib/db/prisma"

export const dynamic = "force-dynamic"

/**
 * Sistem-admin abonelik/sipariş genel bakışı: her hesap (kök firma) için en güncel abonelik,
 * son siparişler ve kullanım sayaçları. Süper-admin korumalı.
 */
export async function GET() {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error

  const companies = await prisma.company.findMany({
    where: { parentCompanyId: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      slug: true,
      disabledModules: true,
      _count: { select: { branches: true } },
      subscriptions: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          provider: true,
          purchasedModules: true,
          branchQuota: true,
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

  return NextResponse.json({ data: companies })
}
