import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    const resolvedParams = await params

    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Super admin kontrolü
    const currentUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { isSuperAdmin: true }
    })

    if (!currentUser?.isSuperAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const body = await request.json()
    const { isActive } = body

    const company = await prisma.company.update({
      where: { id: resolvedParams.id },
      data: { isActive }
    })

    // Log kaydı
    await prisma.systemLog.create({
      data: {
        userId: session.user.id,
        action: isActive ? "ACTIVATE_COMPANY" : "DEACTIVATE_COMPANY",
        entity: "Company",
        entityId: company.id,
        details: `Firma "${company.name}" ${isActive ? "aktif" : "pasif"} hale getirildi`,
        level: "INFO"
      }
    })

    return NextResponse.json({ success: true, company })
  } catch (error) {
    console.error("Toggle company status error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

