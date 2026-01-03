import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"

export async function GET() {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user?.email) {
      return NextResponse.json({ isSuperAdmin: false }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { isSuperAdmin: true }
    })

    return NextResponse.json({ 
      isSuperAdmin: user?.isSuperAdmin || false 
    })
  } catch (error) {
    console.error("Super admin check error:", error)
    return NextResponse.json({ isSuperAdmin: false }, { status: 500 })
  }
}

