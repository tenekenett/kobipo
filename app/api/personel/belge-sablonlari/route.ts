import { NextResponse } from "next/server"
import { withApiErrors } from "@/lib/api/errors"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import {
  benzersizSablonAnahtari,
  describeSablonError,
  documentTemplateModel,
  firmaIcinSablonBul,
  firmaSablonlari,
  normalizeSablon,
} from "@/lib/personel/belge-sablonlari.server"

export const dynamic = "force-dynamic"

/**
 * Firmanın İK belge şablonları.
 *
 * GET  — Kobipo kataloğu + firmanın kendi şablonları, birleştirilmiş
 *        (kopyalanmış katalog satırı listeye İKİNCİ KEZ girmez).
 * POST — yeni şablon; `kaynakId` verilirse o şablonun KOPYASI üretilir.
 *
 * Kapsam kuralı tek yerde: lib/personel/belge-sablonlari.server.ts.
 */
export const GET = withApiErrors(async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const companyId = await resolveCompanyId(searchParams.get("companyId"))
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  await ensureCompanyAccess(companyId)

  try {
    // Yönetim ekranı pasifleri de ister (firmanın gizlediği şablonu geri açabilmek
    // için); doldurma ekranı istemez.
    const includeInactive = searchParams.get("includeInactive") === "1"
    return NextResponse.json({ data: await firmaSablonlari(companyId, { includeInactive }) })
  } catch (error) {
    console.error("belge-sablonlari GET error:", error)
    return NextResponse.json({ error: describeSablonError(error) }, { status: 500 })
  }
})

export const POST = withApiErrors(async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const companyId = await resolveCompanyId(body?.companyId)
  if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

  await ensureCompanyWrite(companyId)

  try {
    const model = documentTemplateModel()
    if (!model) return NextResponse.json({ error: describeSablonError(null) }, { status: 500 })

    // ---- Kopyala ve düzenle ----
    //
    // Katalog şablonu DÜZENLENMEZ, kopyalanır: kullanıcı metni değiştirdiğinde
    // kendi satırı doğar ve `sourceKey` hangi kalıptan geldiğini söyler. Rakip
    // üründeki asıl kusur bunun yokluğuydu — hazır şablonlar kilitliydi, içindeki
    // hata düzeltilemiyordu.
    if (body?.kaynakId) {
      const kaynak = await firmaIcinSablonBul(String(body.kaynakId), companyId)
      if (!kaynak) return NextResponse.json({ error: "Şablon bulunamadı" }, { status: 404 })

      // Zaten kopyalanmışsa ikinci kopya üretme: liste kuralı "kopya kataloğu
      // gizler" olduğu için ikinci kopya iki satır gösterir ve hangisi geçerli
      // belirsizleşirdi.
      if (kaynak.companyId === null) {
        const varOlan = await model.findFirst({ where: { companyId, sourceKey: kaynak.key } })
        if (varOlan) return NextResponse.json({ data: varOlan })
      }

      const kopya = await model.create({
        data: {
          companyId,
          key: await benzersizSablonAnahtari(kaynak.title, companyId),
          // Katalogdan kopyalandıysa iz katalog anahtarıdır; firmanın kendi
          // şablonundan çoğaltıldıysa iz TAŞINMAZ (o zaten kendi metnidir).
          sourceKey: kaynak.companyId === null ? kaynak.key : null,
          title: kaynak.companyId === null ? kaynak.title : `${kaynak.title} (kopya)`,
          category: kaynak.category,
          description: kaynak.description,
          body: kaynak.body,
          sortOrder: kaynak.sortOrder,
          isActive: true,
          createdBy: user.id,
        },
      })
      return NextResponse.json({ data: kopya }, { status: 201 })
    }

    // ---- Sıfırdan yeni şablon ----
    const { hata, veri } = normalizeSablon(body)
    if (hata || !veri) return NextResponse.json({ error: hata ?? "Geçersiz şablon" }, { status: 400 })

    const sablon = await model.create({
      data: {
        companyId,
        key: await benzersizSablonAnahtari(veri.title, companyId),
        sourceKey: null,
        ...veri,
        createdBy: user.id,
      },
    })
    return NextResponse.json({ data: sablon }, { status: 201 })
  } catch (error) {
    console.error("belge-sablonlari POST error:", error)
    return NextResponse.json({ error: describeSablonError(error) }, { status: 500 })
  }
})
