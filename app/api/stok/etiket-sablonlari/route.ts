import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { MAX_DESIGN_JSON_BYTES, normalizeLabelDesign } from "@/lib/labels/types"

export const dynamic = "force-dynamic"

// Etiket tasarım şablonları — liste. design alanı BİLEREK dışarıda bırakılır:
// görsel/emoji data-URI'ları yüzünden satır MB'larca olabilir; tam tasarım
// [id] GET ile tek tek çekilir.
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) {
      return NextResponse.json({ error: "companyId is required" }, { status: 400 })
    }

    await ensureCompanyAccess(companyId)

    const templates = await prisma.labelTemplate.findMany({
      where: { companyId },
      select: {
        id: true,
        name: true,
        slug: true,
        labelType: true,
        isDefault: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
    })

    return NextResponse.json(templates)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error fetching label templates:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const companyId = await resolveCompanyId(body.companyId)
    const name = typeof body.name === "string" ? body.name.trim() : ""

    if (!companyId || !name) {
      return NextResponse.json(
        { error: "companyId ve name zorunludur" },
        { status: 400 }
      )
    }
    if (!body.design || typeof body.design !== "object") {
      return NextResponse.json({ error: "design zorunludur" }, { status: 400 })
    }

    await ensureCompanyWrite(companyId)

    // Bozuk/eski payload'ı temizle; labelType kolonunu normalize edilmiş
    // tasarımın sayfa tipiyle senkron tut (ayrı bir body alanına güvenme).
    const design = normalizeLabelDesign(body.design)
    if (JSON.stringify(design).length > MAX_DESIGN_JSON_BYTES) {
      return NextResponse.json(
        { error: "Tasarım çok büyük — görselleri küçültün veya azaltın." },
        { status: 413 }
      )
    }

    const isDefault = Boolean(body.isDefault)
    const created = await prisma.$transaction(async (tx) => {
      if (isDefault) {
        await tx.labelTemplate.updateMany({
          where: { companyId },
          data: { isDefault: false },
        })
      }
      return tx.labelTemplate.create({
        data: {
          companyId,
          name,
          labelType: design.page.labelType,
          design: design as unknown as Prisma.InputJsonValue,
          isDefault,
        },
        select: { id: true, name: true, slug: true, labelType: true, isDefault: true },
      })
    })

    return NextResponse.json(created, { status: 201 })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error creating label template:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
