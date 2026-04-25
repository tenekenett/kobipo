import { prisma } from "@/lib/db/prisma"

export async function ensureUsageLimit(companyId: string, key: string, incrementBy = 1) {
  const now = new Date()
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)

  const existing = await prisma.usageLimit.findFirst({
    where: { companyId, key, periodStart },
  })

  if (!existing) {
    await prisma.usageLimit.create({
      data: { companyId, key, currentValue: incrementBy, maxValue: 1000, periodStart, periodEnd },
    })
    return
  }

  if (existing.currentValue + incrementBy > existing.maxValue) {
    throw new Error(`Usage limit exceeded for ${key}`)
  }

  await prisma.usageLimit.update({
    where: { id: existing.id },
    data: { currentValue: { increment: incrementBy } },
  })
}
