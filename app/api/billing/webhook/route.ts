import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const { providerSubscriptionId, status } = body
  if (!providerSubscriptionId) return NextResponse.json({ error: "providerSubscriptionId is required" }, { status: 400 })
  await prisma.subscription.updateMany({
    where: { providerSubscriptionId },
    data: { status: status || "ACTIVE" },
  })
  return NextResponse.json({ success: true })
}
