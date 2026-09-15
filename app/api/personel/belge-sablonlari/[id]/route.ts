import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { withApiErrors } from "@/lib/api/errors"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import {
  describeSablonError,
  documentTemplateModel,
  normalizeSablon,
} from "@/lib/personel/belge-sablonlari.server"

export const dynamic = "force-dynamic"

/**
 * Firmanın KENDİ şablonunu günceller/siler.
 *
 * KATALOG SATIRINA DOKUNULMAZ: id bir katalog şablonunu gösteriyorsa 409 döner ve
 * istemciye "önce kopyala" der. Katalog satırı yazılabilir olsaydı bir firmanın
 * düzenlemesi BÜTÜN firmaların şablonunu değiştirirdi.
 */
async function firmaSatiri(id: string, companyId: string) {
  const model = documentTemplateModel()
  if (!model) return { model: null as null, kayit: null, katalog: false }
  const kayit = await model.findUnique({ where: { id } })
  if (!kayit) return { model, kayit: null, katalog: false }
  if (kayit.companyId === null) return { model, kayit: null, katalog: true }
  if (kayit.companyId !== companyId) return { model, kayit: null, katalog: false }
  return { model, kayit, katalog: false }
}

export const PUT = withApiErrors(async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const companyId = await resolveCompanyId(body?.companyId)
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  await ensureCompanyWrite(companyId)

  try {
    const { model, kayit, katalog } = await firmaSatiri(id, companyId)
    if (!model) return NextResponse.json({ error: describeSablonError(null) }, { status: 500 })
    if (katalog) {
      return NextResponse.json(
        { error: "Kobipo şablonu doğrudan düzenlenemez. Önce 'Kopyala ve düzenle' ile kendi kopyanızı oluşturun." },
        { status: 409 },
      )
    }
    if (!kayit) return NextResponse.json({ error: "Şablon bulunamadı" }, { status: 404 })

    const { hata, veri } = normalizeSablon({
      title: body?.title ?? kayit.title,
      body: body?.body ?? kayit.body,
      category: body?.category !== undefined ? body.category : kayit.category,
      description: body?.description !== undefined ? body.description : kayit.description,
      sortOrder: body?.sortOrder ?? kayit.sortOrder,
      isActive: body?.isActive ?? kayit.isActive,
    })
    if (hata || !veri) return NextResponse.json({ error: hata ?? "Geçersiz şablon" }, { status: 400 })

    // `key` ve `sourceKey` değişmez: ikisi de izdir, ad değişince kopmamalı.
    return NextResponse.json({ data: await model.update({ where: { id }, data: veri }) })
  } catch (error) {
    console.error("belge-sablonu PUT error:", error)
    return NextResponse.json({ error: describeSablonError(error) }, { status: 500 })
  }
})

export const DELETE = withApiErrors(async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const { searchParams } = new URL(request.url)
  const companyId = await resolveCompanyId(searchParams.get("companyId"))
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  await ensureCompanyWrite(companyId)

  try {
    const { model, kayit, katalog } = await firmaSatiri(id, companyId)
    if (!model) return NextResponse.json({ error: describeSablonError(null) }, { status: 500 })
    if (katalog) {
      return NextResponse.json(
        { error: "Kobipo şablonu silinemez. Listede görünmesini istemiyorsanız kopyalayıp pasife alın." },
        { status: 409 },
      )
    }
    if (!kayit) return NextResponse.json({ error: "Şablon bulunamadı" }, { status: 404 })

    // Katalogdan kopyalanmış bir satırı silmek, katalog şablonunu GERİ GETİRİR:
    // liste kuralı "kopya kataloğu gizler" olduğu için kopya gidince kalıp yeniden
    // görünür. Kullanıcı için bu "özelleştirmemi geri al" demektir; ekran da böyle
    // yazar.
    await model.delete({ where: { id } })
    return NextResponse.json({ ok: true, katalogGeriGeldi: Boolean(kayit.sourceKey) })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Şablon bulunamadı" }, { status: 404 })
    }
    console.error("belge-sablonu DELETE error:", error)
    return NextResponse.json({ error: describeSablonError(error) }, { status: 500 })
  }
})
