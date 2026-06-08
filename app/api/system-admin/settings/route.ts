import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"
import {
  getSystemSettings,
  normalizeSettings,
  saveSystemSettings,
} from "@/lib/system/settings"

export const dynamic = "force-dynamic"

async function requireSuperAdmin() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, isSuperAdmin: true },
  })
  if (!user?.isSuperAdmin) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }
  return { user }
}

export async function GET() {
  const auth = await requireSuperAdmin()
  if (auth.error) return auth.error

  const settings = await getSystemSettings()
  return NextResponse.json(settings)
}

export async function PUT(request: NextRequest) {
  const auth = await requireSuperAdmin()
  if (auth.error) return auth.error

  try {
    const body = await request.json()
    const normalized = normalizeSettings(body)

    if (Object.keys(normalized).length === 0) {
      return NextResponse.json({ error: "Geçerli ayar gönderilmedi" }, { status: 400 })
    }

    await saveSystemSettings(normalized)

    await prisma.systemLog.create({
      data: {
        userId: auth.user.id,
        action: "UPDATE_SYSTEM_SETTINGS",
        entity: "SystemSetting",
        details: `Sistem ayarları güncellendi: ${Object.keys(normalized).join(", ")}`,
        level: "INFO",
      },
    })

    const settings = await getSystemSettings()
    return NextResponse.json({ success: true, settings })
  } catch (error) {
    console.error("Update system settings error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
