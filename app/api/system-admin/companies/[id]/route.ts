import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"

export const dynamic = "force-dynamic"

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)
    const resolvedParams = await params

    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const currentUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { isSuperAdmin: true, id: true }
    })

    if (!currentUser?.isSuperAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const existing = await prisma.company.findUnique({
      where: { id: resolvedParams.id },
      select: { id: true }
    })
    if (!existing) {
      return NextResponse.json({ error: "Firma bulunamadı" }, { status: 404 })
    }

    const body = await request.json()
    const name = String(body.name ?? "").trim()
    if (!name) {
      return NextResponse.json({ error: "Firma adı zorunludur" }, { status: 400 })
    }

    const clean = (v: unknown) => {
      const s = String(v ?? "").trim()
      return s.length > 0 ? s : null
    }

    // VKN benzersiz; başka firmada kullanılıyorsa hata ver.
    const taxNumber = clean(body.taxNumber)
    if (taxNumber) {
      const dup = await prisma.company.findFirst({
        where: { taxNumber, NOT: { id: resolvedParams.id } },
        select: { id: true }
      })
      if (dup) {
        return NextResponse.json(
          { error: `Bu vergi numarası (${taxNumber}) başka bir firmada kayıtlı` },
          { status: 409 }
        )
      }
    }

    const company = await prisma.company.update({
      where: { id: resolvedParams.id },
      data: {
        name,
        taxNumber,
        taxOffice: clean(body.taxOffice),
        city: clean(body.city),
        phone: clean(body.phone),
        email: clean(body.email),
        address: clean(body.address),
      },
    })

    await prisma.systemLog.create({
      data: {
        userId: currentUser.id,
        action: "UPDATE_COMPANY",
        entity: "Company",
        entityId: company.id,
        details: `Firma "${company.name}" bilgileri güncellendi`,
        level: "INFO"
      }
    })

    return NextResponse.json({ success: true, company })
  } catch (error) {
    console.error("Update company error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
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
      select: { isSuperAdmin: true, id: true }
    })

    if (!currentUser?.isSuperAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 })
    }

    const company = await prisma.company.findUnique({
      where: { id: resolvedParams.id },
      select: { id: true, name: true }
    })

    if (!company) {
      return NextResponse.json({ error: "Firma bulunamadı" }, { status: 404 })
    }

    // Firma silindiğinde ilişkili tüm veriler (müşteri, fatura, stok vb.)
    // şema seviyesinde onDelete: Cascade ile birlikte silinir.
    await prisma.company.delete({ where: { id: company.id } })

    // Log kaydı (entityId string olduğu için cascade'den etkilenmez)
    await prisma.systemLog.create({
      data: {
        userId: currentUser.id,
        action: "DELETE_COMPANY",
        entity: "Company",
        entityId: company.id,
        details: `Firma "${company.name}" ve tüm verileri silindi`,
        level: "WARN"
      }
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Delete company error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
