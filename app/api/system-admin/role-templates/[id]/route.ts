import { NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/auth/require-super-admin"
import { prisma } from "@/lib/db/prisma"
import {
  describeCatalogError,
  roleTemplateModel,
  sanitizeTemplatePaths,
} from "@/lib/nav/role-templates.server"
import { Prisma } from "@prisma/client"

export const dynamic = "force-dynamic"

/**
 * PUT — kalıbı güncelle. DELETE — kalıbı sil. İkisi de süper admin.
 *
 * İkisi de ÜRETİLMİŞ ROLLERİ ETKİLEMEZ: firma rolü kalıptan kopyalanır, bağlanmaz
 * (bkz. prisma RoleTemplate yorumu). Silinen kalıbın anahtarını taşıyan roller
 * çalışmaya devam eder; yalnız "hangi kalıptan üretildi" izi karşılıksız kalır.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error

  const { id } = await params
  try {
    // Bayat istemcide "undefined okunamıyor" yerine ne yapılacağını söyleyen mesaj.
    const model = roleTemplateModel()
    if (!model) {
      return NextResponse.json({ error: describeCatalogError(null) }, { status: 500 })
    }

    const body = await request.json()
    const data: Prisma.RoleTemplateUpdateInput = {}

    if (body?.name != null) {
      const name = String(body.name).trim()
      if (!name) return NextResponse.json({ error: "Kalıp adı boş olamaz" }, { status: 400 })
      data.name = name
    }
    if (body?.description !== undefined) {
      data.description = body.description ? String(body.description).trim() : null
    }
    // Sayfa listeleri BİRLİKTE gelir: yazma listesi görüntüleme listesinin alt kümesi
    // olmak zorunda, birini tek başına güncellemek o kuralı kaydın içinde bozardı.
    if (body?.allowedPaths !== undefined || body?.writablePaths !== undefined) {
      const { allowedPaths, writablePaths } = sanitizeTemplatePaths(
        body?.allowedPaths,
        body?.writablePaths
      )
      if (allowedPaths.length === 0) {
        return NextResponse.json({ error: "Kalıba en az bir sayfa seçin" }, { status: 400 })
      }
      data.allowedPaths = allowedPaths
      data.writablePaths = writablePaths
    }
    if (body?.sortOrder != null && Number.isFinite(Number(body.sortOrder))) {
      data.sortOrder = Number(body.sortOrder)
    }
    if (body?.isActive != null) data.isActive = Boolean(body.isActive)

    const updated = await model.update({ where: { id }, data })

    await prisma.systemLog.create({
      data: {
        userId: auth.user.id,
        action: "UPDATE_ROLE_TEMPLATE",
        entity: "RoleTemplate",
        entityId: updated.id,
        details: `Hazır rol kalıbı "${updated.name}" güncellendi (${Object.keys(data).join(", ")})`,
        level: "INFO",
      },
    })

    return NextResponse.json(updated)
  } catch (error: any) {
    if (error?.code === "P2025") {
      return NextResponse.json({ error: "Kalıp bulunamadı" }, { status: 404 })
    }
    console.error("role template PUT error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error

  const { id } = await params
  try {
    const model = roleTemplateModel()
    if (!model) {
      return NextResponse.json({ error: describeCatalogError(null) }, { status: 500 })
    }

    const deleted = await model.delete({ where: { id } })

    await prisma.systemLog.create({
      data: {
        userId: auth.user.id,
        action: "DELETE_ROLE_TEMPLATE",
        entity: "RoleTemplate",
        entityId: deleted.id,
        details: `Hazır rol kalıbı "${deleted.name}" silindi`,
        level: "WARN",
      },
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    if (error?.code === "P2025") {
      return NextResponse.json({ error: "Kalıp bulunamadı" }, { status: 404 })
    }
    console.error("role template DELETE error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}
