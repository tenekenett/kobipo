import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { createCheckoutSession } from "@/lib/billing/provider"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { planCode, provider } = await request.json()
  const plan = await prisma.plan.findUnique({ where: { code: planCode } })
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 })
  const session = await createCheckoutSession(provider || "stripe", planCode)
  return NextResponse.json(session)
}
