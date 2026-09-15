import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { requireSuperAdmin } from "@/lib/auth/require-super-admin"
import {
  describeSablonError,
  documentTemplateModel,
  normalizeSablon,
} from "@/lib/personel/belge-sablonlari.server"

export const dynamic = "force-dynamic"

/**
 * PUT — katalog şablonunu güncelle. DELETE — sil. İkisi de süper admin.
 *
 * İkisi de FİRMA KOPYALARINI ETKİLEMEZ: kopya bağımsız bir satırdır (bkz. prisma
 * DocumentTemplate yorumu). Silinen şablonun anahtarını `sourceKey` olarak taşıyan
 * kopyalar çalışmaya devam eder; yalnız "hangi kalıptan türedi" izi karşılıksız
 * kalır. Bu bilinçli: aksi halde Kobipo'nun katalog temizliği müşterinin kullandığı
 * belgeyi ortadan kaldırırdı.
 */

/** Kapsam kapısı: bu uç YALNIZ katalog satırlarına dokunur. */
async function katalogSatiri(id: string) {
  const model = documentTemplateModel()
  if (!model) return { model: null, kayit: null }
  const kayit = await model.findUnique({ where: { id } })
  // companyId dolu satır bir FİRMANIN şablonudur; sistem admin ucu ona yazmaz.
  // Yazsaydı panelden yapılan bir düzeltme müşterinin özelleştirdiği metni ezerdi.
  return { model, kayit: kayit && kayit.companyId === null ? kayit : null }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error

  const { id } = await params
  try {
    const { model, kayit } = await katalogSatiri(id)
    if (!model) return NextResponse.json({ error: describeSablonError(null) }, { status: 500 })
    if (!kayit) return NextResponse.json({ error: "Katalog şablonu bulunamadı" }, { status: 404 })

    const body = await request.json()

    // Kısmi güncelleme: yalnız gelen alanlar yazılır. Gövde ile başlık BİRLİKTE
    // doğrulanır çünkü normalizeSablon ikisini de ister.
    const { hata, veri } = normalizeSablon({
      title: body?.title ?? kayit.title,
      body: body?.body ?? kayit.body,
      category: body?.category !== undefined ? body.category : kayit.category,
      description: body?.description !== undefined ? body.description : kayit.description,
      sortOrder: body?.sortOrder ?? kayit.sortOrder,
      isActive: body?.isActive ?? kayit.isActive,
    })
    if (hata || !veri) return NextResponse.json({ error: hata ?? "Geçersiz şablon" }, { status: 400 })

    // `key` DEĞİŞTİRİLMEZ: firma kopyaları onu `sourceKey` olarak taşıyor, ad
    // değişince anahtar de değişseydi kopyanın izi kopardı.
    const guncel = await model.update({ where: { id }, data: veri })
    return NextResponse.json({ data: guncel })
  } catch (error) {
    console.error("document template PUT error:", error)
    return NextResponse.json({ error: describeSablonError(error) }, { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error

  const { id } = await params
  try {
    const { model, kayit } = await katalogSatiri(id)
    if (!model) return NextResponse.json({ error: describeSablonError(null) }, { status: 500 })
    if (!kayit) return NextResponse.json({ error: "Katalog şablonu bulunamadı" }, { status: 404 })

    await model.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return NextResponse.json({ error: "Katalog şablonu bulunamadı" }, { status: 404 })
    }
    console.error("document template DELETE error:", error)
    return NextResponse.json({ error: describeSablonError(error) }, { status: 500 })
  }
}
