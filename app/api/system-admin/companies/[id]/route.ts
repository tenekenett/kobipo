import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"
import { encryptSecret } from "@/lib/crypto/secrets"
import { EDonusumIntegrator, Prisma } from "@prisma/client"

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

    const clean = (v: unknown) => {
      const s = String(v ?? "").trim()
      return s.length > 0 ? s : null
    }

    // Ad yalnızca gönderildiyse güncellenir; gönderildiyse boş olamaz. Bu sayede
    // e-fatura kartı gibi kısmi güncellemeler adı silmez.
    if (body.name !== undefined && !String(body.name).trim()) {
      return NextResponse.json({ error: "Firma adı zorunludur" }, { status: 400 })
    }

    // VKN benzersiz; başka firmada kullanılıyorsa hata ver.
    const taxNumber = body.taxNumber !== undefined ? clean(body.taxNumber) : undefined
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

    // Tüm alanlar yalnızca payload'da gönderildiyse (undefined değilse) güncellenir;
    // gönderilmeyen alanlar DB'deki mevcut değeri ezmez (kısmi güncelleme güvenli).
    const data: Prisma.CompanyUpdateInput = {}

    if (body.name !== undefined) data.name = String(body.name).trim()
    if (taxNumber !== undefined) data.taxNumber = taxNumber
    if (body.taxOffice !== undefined) data.taxOffice = clean(body.taxOffice)
    if (body.city !== undefined) data.city = clean(body.city)
    if (body.phone !== undefined) data.phone = clean(body.phone)
    if (body.email !== undefined) data.email = clean(body.email)
    if (body.address !== undefined) data.address = clean(body.address)
    if (body.website !== undefined) data.website = clean(body.website)

    if (body.isEDonusumEnabled !== undefined) {
      data.isEDonusumEnabled = Boolean(body.isEDonusumEnabled)
    }
    if (body.eDonusumIntegrator !== undefined) {
      const integrator = String(body.eDonusumIntegrator)
      if (integrator in EDonusumIntegrator) {
        data.eDonusumIntegrator = integrator as EDonusumIntegrator
      }
    }
    if (body.eDonusumProvider !== undefined) data.eDonusumProvider = clean(body.eDonusumProvider)
    if (body.eDonusumApiUsername !== undefined) data.eDonusumApiUsername = clean(body.eDonusumApiUsername)
    if (body.eDonusumAlias !== undefined) data.eDonusumAlias = clean(body.eDonusumAlias)
    if (body.eDonusumApiUrl !== undefined) data.eDonusumApiUrl = clean(body.eDonusumApiUrl)

    // Şifre: yalnızca yeni (boş olmayan, "***" maskesi olmayan) bir değer geldiyse şifrele ve kaydet.
    if (
      typeof body.eDonusumApiPassword === "string" &&
      body.eDonusumApiPassword.trim() &&
      body.eDonusumApiPassword !== "***"
    ) {
      data.eDonusumApiPassword = encryptSecret(body.eDonusumApiPassword.trim())
    }

    if (body.eDonusumTenantVkn !== undefined) {
      const vkn = String(body.eDonusumTenantVkn ?? "").replace(/\D/g, "").slice(0, 11)
      data.eDonusumTenantVkn = vkn || null
    }
    if (body.eFaturaPrefix !== undefined) {
      const p = String(body.eFaturaPrefix ?? "").trim().toUpperCase().slice(0, 3)
      data.eFaturaPrefix = p || null
    }
    if (body.eArchivePrefix !== undefined) {
      const p = String(body.eArchivePrefix ?? "").trim().toUpperCase().slice(0, 3)
      data.eArchivePrefix = p || null
    }
    if (body.invoiceSeriesPrefix !== undefined) {
      data.invoiceSeriesPrefix = clean(body.invoiceSeriesPrefix)
    }

    const company = await prisma.company.update({
      where: { id: resolvedParams.id },
      data,
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
