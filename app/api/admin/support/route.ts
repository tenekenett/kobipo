import { NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/auth/require-super-admin"
import { prisma } from "@/lib/db/prisma"

export const dynamic = "force-dynamic"

// Tüm firmaların destek talepleri (sistem-admin). ?status= ile filtrelenebilir.
export async function GET(request: Request) {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error

  const status = new URL(request.url).searchParams.get("status")
  const tickets = await prisma.supportTicket.findMany({
    where: status ? { status } : undefined,
    orderBy: { updatedAt: "desc" },
    include: {
      company: { select: { id: true, name: true } },
      createdBy: { select: { id: true, name: true, email: true } },
      messages: { orderBy: { createdAt: "asc" } },
    },
  })
  return NextResponse.json(tickets)
}
