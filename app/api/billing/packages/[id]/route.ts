import { NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/auth/require-super-admin"
import { prisma } from "@/lib/db/prisma"
import { sanitizeDisabledModules } from "@/lib/modules"
import { logPricingChanges } from "@/lib/billing/pricing-history"
import { Prisma } from "@prisma/client"

export const dynamic = "force-dynamic"

/** PUT — paket güncelle. DELETE — paket sil. Her ikisi de süper admin. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error

  const { id } = await params
  try {
    const body = await request.json()
    const data: Prisma.PlanUpdateInput = {}

    if (body?.name != null) {
      const name = String(body.name).trim()
      if (!name) return NextResponse.json({ error: "Paket adı boş olamaz" }, { status: 400 })
      data.name = name
    }
    if (body?.description !== undefined) {
      data.description = body.description ? String(body.description).trim() : null
    }
    if (body?.monthlyPrice != null) {
      const v = Number(body.monthlyPrice)
      if (!Number.isFinite(v) || v < 0) return NextResponse.json({ error: "Aylık fiyat geçersiz" }, { status: 400 })
      data.monthlyPrice = v
    }
    if (body?.yearlyPrice !== undefined) {
      if (body.yearlyPrice === null || body.yearlyPrice === "") {
        data.yearlyPrice = null
      } else {
        const v = Number(body.yearlyPrice)
        if (!Number.isFinite(v) || v < 0) return NextResponse.json({ error: "Yıllık fiyat geçersiz" }, { status: 400 })
        data.yearlyPrice = v
      }
    }
    if (body?.includedModules !== undefined) {
      data.includedModules = sanitizeDisabledModules(body.includedModules)
    }
    if (body?.includedBranches != null) {
      data.includedBranches = Math.max(0, Math.floor(Number(body.includedBranches) || 0))
    }
    // Ek firma ayrı bir haktır — şube adedinden türetilmez.
    if (body?.includedCompanies != null) {
      data.includedCompanies = Math.max(0, Math.floor(Number(body.includedCompanies) || 0))
    }
    if (body?.maxUsers != null) {
      data.maxUsers = Math.max(1, Math.floor(Number(body.maxUsers) || 1))
    }
    if (body?.highlighted != null) data.highlighted = Boolean(body.highlighted)
    if (body?.sortOrder != null && Number.isFinite(Number(body.sortOrder))) {
      data.sortOrder = Number(body.sortOrder)
    }
    if (body?.isActive != null) data.isActive = Boolean(body.isActive)

    // Eski hâl UPDATE'ten ÖNCE okunur: sonrasında geri dönülemez biçimde kaybolur
    // ([[lib/billing/pricing-history.ts]]).
    const before = await prisma.plan.findUnique({ where: { id } })
    if (!before) return NextResponse.json({ error: "Paket bulunamadı" }, { status: 404 })

    const updated = await prisma.plan.update({ where: { id }, data })

    await logPricingChanges([
      {
        kind: "PLAN",
        targetKey: id,
        targetLabel: updated.name,
        before: {
          name: before.name,
          monthlyPrice: before.monthlyPrice,
          yearlyPrice: before.yearlyPrice,
          includedModules: before.includedModules,
          includedBranches: before.includedBranches,
          includedCompanies: before.includedCompanies,
          maxUsers: before.maxUsers,
          isActive: before.isActive,
        },
        after: {
          name: updated.name,
          monthlyPrice: updated.monthlyPrice,
          yearlyPrice: updated.yearlyPrice,
          includedModules: updated.includedModules,
          includedBranches: updated.includedBranches,
          includedCompanies: updated.includedCompanies,
          maxUsers: updated.maxUsers,
          isActive: updated.isActive,
        },
        changedById: auth.user.id,
      },
    ])

    return NextResponse.json(updated)
  } catch (error: any) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Paket bulunamadı" }, { status: 404 })
    }
    console.error("billing packages PUT error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error

  const { id } = await params
  try {
    // FK'lar (subscription.planId / packageOrder.planId) SET NULL olduğundan silme güvenli:
    // geçmiş abonelik/siparişler korunur, plan bağı boşalır. Ama planın FİYATI onunla
    // birlikte gider — eski siparişlerin neye dayandığı kalsın diye önce günlüğe yazılır.
    const before = await prisma.plan.findUnique({ where: { id } })
    await prisma.plan.delete({ where: { id } })

    if (before) {
      await logPricingChanges([
        {
          kind: "PLAN",
          targetKey: id,
          targetLabel: before.name,
          before: {
            monthlyPrice: before.monthlyPrice,
            yearlyPrice: before.yearlyPrice,
            includedModules: before.includedModules,
            isActive: before.isActive,
          },
          after: { monthlyPrice: null, yearlyPrice: null, includedModules: [], isActive: false },
          changedById: auth.user.id,
        },
      ])
    }

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Paket bulunamadı" }, { status: 404 })
    }
    console.error("billing packages DELETE error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}
