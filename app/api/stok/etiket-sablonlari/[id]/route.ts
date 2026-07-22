import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { resolveSlugId } from "@/lib/slug-resolve"
import { MAX_DESIGN_JSON_BYTES, normalizeLabelDesign } from "@/lib/labels/types"

export const dynamic = "force-dynamic"

// Tam şablon (design dahil) — editör şablon seçince çağırır.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    resolvedParams.id = await resolveSlugId(
      "labelTemplate",
      resolvedParams.id,
      await resolveCompanyId(new URL(request.url).searchParams.get("companyId"))
    )

    const template = await prisma.labelTemplate.findUnique({
      where: { id: resolvedParams.id },
    })
    if (!template) {
      return NextResponse.json({ error: "Şablon bulunamadı" }, { status: 404 })
    }

    await ensureCompanyAccess(template.companyId)

    return NextResponse.json(template)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error fetching label template:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const resolvedParams = await params
    resolvedParams.id = await resolveSlugId(
      "labelTemplate",
      resolvedParams.id,
      await resolveCompanyId(body.companyId ?? new URL(request.url).searchParams.get("companyId"))
    )

    const existing = await prisma.labelTemplate.findUnique({
      where: { id: resolvedParams.id },
      select: { id: true, companyId: true },
    })
    if (!existing) {
      return NextResponse.json({ error: "Şablon bulunamadı" }, { status: 404 })
    }

    await ensureCompanyWrite(existing.companyId)

    const data: Prisma.LabelTemplateUpdateInput = {}

    if (body.name !== undefined) {
      const name = typeof body.name === "string" ? body.name.trim() : ""
      if (!name) {
        return NextResponse.json({ error: "name boş olamaz" }, { status: 400 })
      }
      // Not: slug bilinçli olarak değişmez (insert-only konvansiyonu) — eski
      // linkler çalışmaya devam eder.
      data.name = name
    }

    if (body.design !== undefined) {
      if (!body.design || typeof body.design !== "object") {
        return NextResponse.json({ error: "design geçersiz" }, { status: 400 })
      }
      const design = normalizeLabelDesign(body.design)
      if (JSON.stringify(design).length > MAX_DESIGN_JSON_BYTES) {
        return NextResponse.json(
          { error: "Tasarım çok büyük — görselleri küçültün veya azaltın." },
          { status: 413 }
        )
      }
      data.design = design as unknown as Prisma.InputJsonValue
      data.labelType = design.page.labelType
    }

    const isDefault = body.isDefault === undefined ? undefined : Boolean(body.isDefault)

    const updated = await prisma.$transaction(async (tx) => {
      if (isDefault === true) {
        await tx.labelTemplate.updateMany({
          where: { companyId: existing.companyId, id: { not: existing.id } },
          data: { isDefault: false },
        })
      }
      return tx.labelTemplate.update({
        where: { id: existing.id },
        data: { ...data, ...(isDefault === undefined ? {} : { isDefault }) },
        select: { id: true, name: true, slug: true, labelType: true, isDefault: true },
      })
    })

    return NextResponse.json(updated)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error updating label template:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    resolvedParams.id = await resolveSlugId(
      "labelTemplate",
      resolvedParams.id,
      await resolveCompanyId(new URL(request.url).searchParams.get("companyId"))
    )

    const existing = await prisma.labelTemplate.findUnique({
      where: { id: resolvedParams.id },
      select: { id: true, companyId: true },
    })
    if (!existing) {
      return NextResponse.json({ error: "Şablon bulunamadı" }, { status: 404 })
    }

    await ensureCompanyWrite(existing.companyId)

    await prisma.labelTemplate.delete({ where: { id: existing.id } })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error deleting label template:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
