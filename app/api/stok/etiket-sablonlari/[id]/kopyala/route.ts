import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { resolveSlugId } from "@/lib/slug-resolve"

export const dynamic = "force-dynamic"

// Şablonu başka bir şubeye (Company) kopyalar. Şablonlar şube kapsamlı
// olduğundan "çoklu şube ataması" yerine bu kopyalama akışı kullanılır.
// Yetki: kullanıcının HEM kaynak HEM hedef şubeye erişimi olmalı.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const sourceCompanyId = await resolveCompanyId(body.companyId)
    const targetCompanyId = await resolveCompanyId(body.targetCompanyId)

    if (!targetCompanyId) {
      return NextResponse.json({ error: "targetCompanyId zorunludur" }, { status: 400 })
    }

    const resolvedParams = await params
    resolvedParams.id = await resolveSlugId("labelTemplate", resolvedParams.id, sourceCompanyId)

    const source = await prisma.labelTemplate.findUnique({
      where: { id: resolvedParams.id },
    })
    if (!source) {
      return NextResponse.json({ error: "Şablon bulunamadı" }, { status: 404 })
    }

    await ensureCompanyWrite(source.companyId)
    await ensureCompanyWrite(targetCompanyId)

    if (targetCompanyId === source.companyId) {
      return NextResponse.json(
        { error: "Şablon zaten bu şubede — farklı bir şube seçin." },
        { status: 400 }
      )
    }

    // slug boş bırakılır: DB trigger'ı hedef şube kapsamında yeniden üretir
    // (aynı isim varsa -2, -3 ... eklenir). Hedefte isDefault taşınmaz.
    const copy = await prisma.labelTemplate.create({
      data: {
        companyId: targetCompanyId,
        name: source.name,
        slug: "",
        labelType: source.labelType,
        design: source.design as Prisma.InputJsonValue,
        isDefault: false,
      },
      select: { id: true, name: true, slug: true, companyId: true },
    })

    return NextResponse.json(copy, { status: 201 })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error copying label template:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
