import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import {
  assertRestaurantModule,
  checkOptionEffectProducts,
  normalizeOptionInput,
  optionGroupInclude,
  serializeOptionGroup,
} from "@/lib/restoran/product-options"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

/**
 * Grubu günceller. Şıklar gönderildiyse grubun şık listesi TAMAMEN YENİLENİR
 * (sil + yaz): düzenleme diyaloğu grubu bir bütün olarak kaydediyor, tek tek
 * şık uçları açmak üç uç daha demekti. Şıkkın id'si değiştiği için geçmiş
 * adisyonlar etkilenmez — kalem seçenekleri KOPYA olarak saklanıyor.
 */
export const PATCH = withApiErrors(async function PATCH(request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const companyId = await resolveCompanyId(body.companyId)
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyWrite(companyId))

    const { id } = await params
    const existing = await prisma.productOptionGroup.findFirst({ where: { id, companyId } })
    if (!existing) return NextResponse.json({ error: "Seçenek grubu bulunamadı" }, { status: 404 })

    const data: Record<string, unknown> = {}
    if (body.name !== undefined) {
      const name = String(body.name || "").trim()
      if (!name) return NextResponse.json({ error: "Grup adı zorunlu" }, { status: 400 })
      data.name = name.slice(0, 80)
    }
    if (body.isRequired !== undefined) data.isRequired = body.isRequired === true
    if (body.isMulti !== undefined) data.isMulti = body.isMulti === true
    if (body.order !== undefined && Number.isFinite(Number(body.order))) {
      data.order = Math.max(0, Math.trunc(Number(body.order)))
    }

    if (body.options !== undefined) {
      const options = normalizeOptionInput(body.options)
      if (options.length === 0) {
        return NextResponse.json({ error: "En az bir seçenek gerekli" }, { status: 400 })
      }
      const effectError = await checkOptionEffectProducts(prisma, companyId, options)
      if (effectError) return NextResponse.json({ error: effectError }, { status: 400 })

      await prisma.$transaction([
        prisma.productOption.deleteMany({ where: { groupId: id } }),
        prisma.productOptionGroup.update({
          where: { id },
          data: { ...data, options: { create: options } },
        }),
      ])
    } else if (Object.keys(data).length > 0) {
      await prisma.productOptionGroup.update({ where: { id }, data })
    }

    const fresh = await prisma.productOptionGroup.findUnique({
      where: { id },
      include: optionGroupInclude,
    })
    return NextResponse.json(serializeOptionGroup(fresh!))
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error, error.message)
    }
    console.error("Error updating product option group:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

/** Grubu ve şıklarını siler (CASCADE). Geçmiş adisyon kalemleri etkilenmez. */
export const DELETE = withApiErrors(async function DELETE(request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyWrite(companyId))

    const { id } = await params
    const existing = await prisma.productOptionGroup.findFirst({ where: { id, companyId } })
    if (!existing) return NextResponse.json({ error: "Seçenek grubu bulunamadı" }, { status: 404 })

    await prisma.productOptionGroup.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error, error.message)
    }
    console.error("Error deleting product option group:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
