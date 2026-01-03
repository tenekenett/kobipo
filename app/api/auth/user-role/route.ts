import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"

export async function GET() {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.email) {
      return NextResponse.json({ role: "VIEWER" }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: {
        companies: {
          include: {
            company: {
              select: { id: true, name: true, isActive: true }
            }
          },
          orderBy: { createdAt: "asc" }
        }
      }
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

