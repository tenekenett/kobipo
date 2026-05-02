import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"

export async function GET() {
  try {
    const userSession = await getCurrentUser()

    if (!userSession?.id) {
      return NextResponse.json({ role: "VIEWER" }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { id: userSession.id },
      select: {
        isSuperAdmin: true,
        companies: {
          orderBy: { createdAt: "asc" },
          select: {
            role: true,
            companyId: true,
            company: {
              select: { name: true, isActive: true },
            },
          },
        },
      },
    })

    if (!user) {
      return NextResponse.json({ role: "VIEWER" })
    }

    // İlk aktif firma veya ilk firma
    const activeCompany = user.companies.find(c => c.company.isActive) || user.companies[0]

    return NextResponse.json({ 
      role: activeCompany?.role || "VIEWER",
      companyId: activeCompany?.companyId,
      companyName: activeCompany?.company.name,
      isSuperAdmin: user.isSuperAdmin
    })
  } catch (error) {
    console.error("User role fetch error:", error)
    return NextResponse.json({ role: "VIEWER" }, { status: 500 })
  }
}

