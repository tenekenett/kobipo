import { NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/auth/require-super-admin"
import {
  benzersizSablonAnahtari,
  describeSablonError,
  documentTemplateModel,
  normalizeSablon,
} from "@/lib/personel/belge-sablonlari.server"

export const dynamic = "force-dynamic"

/**
 * İK belge şablonu KATALOĞU — sistem yönetim paneli ucu.
 *
 * GET  — pasifler dahil tüm katalog şablonları + her birinin kaç firma tarafından
 *        kopyalandığı.
 * POST — yeni katalog şablonu.
 *
 * Firma tarafı bu ucu KULLANMAZ; oradaki liste /api/personel/belge-sablonlari'ndan
 * gelir (katalog + firmanın kendi şablonları, birleştirilmiş).
 */
export async function GET() {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error

  try {
    const model = documentTemplateModel()
    if (!model) throw new Error("stale-client")

    const [sablonlar, kopyalar] = await Promise.all([
      model.findMany({
        where: { companyId: null },
        orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
      }),
      // Kaç firma bu kalıbı kopyalamış? Kopya bağımsız olduğu için sayı
      // "etkilenecek" değil "bugüne kadar özelleştirilmiş" demektir; ekran bunu
      // böyle yazar — katalogda yapılan düzeltme o firmalara GİTMEZ.
      model.groupBy({
        by: ["sourceKey"],
        _count: { _all: true },
        where: { companyId: { not: null }, sourceKey: { not: null } },
      }),
    ])

    const kopyaSayisi = new Map(kopyalar.map((k) => [k.sourceKey ?? "", k._count._all]))

    return NextResponse.json({
      data: sablonlar.map((s) => ({ ...s, kopyaSayisi: kopyaSayisi.get(s.key) ?? 0 })),
    })
  } catch (error) {
    console.error("document templates GET error:", error)
    return NextResponse.json({ error: describeSablonError(error) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error

  try {
    const model = documentTemplateModel()
    if (!model) {
      return NextResponse.json({ error: describeSablonError(null) }, { status: 500 })
    }

    const body = await request.json()
    const { hata, veri } = normalizeSablon(body)
    if (hata || !veri) return NextResponse.json({ error: hata ?? "Geçersiz şablon" }, { status: 400 })

    const sablon = await model.create({
      data: {
        // companyId boş → KATALOG satırı. Bu ucun yazdığı tek kapsam budur.
        companyId: null,
        key: await benzersizSablonAnahtari(veri.title, null),
        ...veri,
        createdBy: auth.user.id,
      },
    })

    return NextResponse.json({ data: { ...sablon, kopyaSayisi: 0 } }, { status: 201 })
  } catch (error) {
    console.error("document templates POST error:", error)
    return NextResponse.json({ error: describeSablonError(error) }, { status: 500 })
  }
}
