import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"

export const dynamic = "force-dynamic"

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

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

    const body = await request.json()
    const name = String(body.name ?? "").trim()
    if (!name) {
      return NextResponse.json({ error: "Firma adı zorunludur" }, { status: 400 })
    }

    const clean = (v: unknown) => {
      const s = String(v ?? "").trim()
      return s.length > 0 ? s : null
    }

    const taxNumber = clean(body.taxNumber)
    if (taxNumber) {
      const dup = await prisma.company.findFirst({
        where: { taxNumber },
        select: { id: true }
      })
      if (dup) {
        return NextResponse.json(
          { error: `Bu vergi numarası (${taxNumber}) zaten kayıtlı` },
          { status: 409 }
        )
      }
    }

    const company = await prisma.company.create({
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
        action: "CREATE_COMPANY",
        entity: "Company",
        entityId: company.id,
        details: `Firma "${company.name}" oluşturuldu`,
        level: "INFO"
      }
    })

    return NextResponse.json({ success: true, company }, { status: 201 })
  } catch (error) {
    console.error("Create company error:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
