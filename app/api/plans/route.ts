import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"

export const dynamic = "force-dynamic"

export async function GET() {
  const plans = await prisma.plan.findMany({ where: { isActive: true }, orderBy: { monthlyPrice: "asc" } })
  return NextResponse.json(plans)
}
