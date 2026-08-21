import { NextResponse } from "next/server"
import { requireSuperAdmin } from "@/lib/auth/require-super-admin"
import { prisma } from "@/lib/db/prisma"
import { makeUniqueSlug, slugify } from "@/lib/slug"
import {
  describeCatalogError,
  roleTemplateModel,
  sanitizeTemplatePaths,
} from "@/lib/nav/role-templates.server"

export const dynamic = "force-dynamic"

/**
 * Hazır rol kalıbı kataloğu — sistem yönetim paneli ucu.
 *
 * GET  — pasifler dahil tüm kalıplar + her birinden kaç firma rolü üretilmiş.
 * POST — yeni kalıp.
 *
 * Firma tarafı bu ucu KULLANMAZ; oradaki liste /api/company/role-templates'ten gelir
 * (yalnız aktifler, sayaç yok).
 */
export async function GET() {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error

  // Hata YUTULMAZ, sebebiyle döner. Sarmalanmamış bir istisnada Next JSON olmayan bir
  // 500 basıyor, panel de gövdeyi ayrıştıramayıp kendi tahminini ("migrasyon
  // uygulanmamış olabilir") gösteriyordu — migrasyonu uygulamış yöneticiyi yanlış yere
  // bakmaya gönderen tam olarak buydu. Katalog okunamıyorsa sebebini SUNUCU söyler.
  try {
    const model = roleTemplateModel()
    if (!model) throw new Error("stale-client")

    const [templates, usage] = await Promise.all([
      model.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
      // Kaç firma bu kalıptan rol üretmiş? Kalıbı değiştirmenin/silmenin etkisini
      // yöneticiye göstermek için: kalıp kopyalandığı için sayı "etkilenecek" değil
      // "bugüne kadar kullanılmış" demektir ve ekran bunu böyle yazar.
      prisma.companyRole.groupBy({
        by: ["templateKey"],
        _count: { _all: true },
        where: { templateKey: { not: null } },
      }),
    ])
    const usageByKey = new Map(usage.map((u) => [u.templateKey ?? "", u._count._all]))

    return NextResponse.json({
      data: templates.map((t) => ({ ...t, usageCount: usageByKey.get(t.key) ?? 0 })),
    })
  } catch (error) {
    console.error("role templates GET error:", error)
    return NextResponse.json({ error: describeCatalogError(error) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error

  try {
    const model = roleTemplateModel()
    if (!model) {
      return NextResponse.json({ error: describeCatalogError(null) }, { status: 500 })
    }

    const body = await request.json()
    const name = String(body?.name ?? "").trim()
    if (!name) return NextResponse.json({ error: "Kalıp adı zorunlu" }, { status: 400 })

    const { allowedPaths, writablePaths } = sanitizeTemplatePaths(
      body?.allowedPaths,
      body?.writablePaths
    )
    if (allowedPaths.length === 0) {
      return NextResponse.json({ error: "Kalıba en az bir sayfa seçin" }, { status: 400 })
    }

    // Anahtar ADDAN türetilir ama ada BAĞLI DEĞİLDİR: bir kez yazılır, ad sonradan
    // değişse bile sabit kalır (company_roles."templateKey" ona bakıyor).
    const key = await makeUniqueSlug(slugify(name) || "kalip", async (candidate) =>
      Boolean(await model.findUnique({ where: { key: candidate }, select: { id: true } }))
    )

    const created = await model.create({
      data: {
        key,
        name,
        description: body?.description ? String(body.description).trim() : null,
        allowedPaths,
        writablePaths,
        sortOrder: Number.isFinite(Number(body?.sortOrder)) ? Number(body.sortOrder) : 0,
        isActive: body?.isActive == null ? true : Boolean(body.isActive),
      },
    })

    await prisma.systemLog.create({
      data: {
        userId: auth.user.id,
        action: "CREATE_ROLE_TEMPLATE",
        entity: "RoleTemplate",
        entityId: created.id,
        details: `Hazır rol kalıbı "${created.name}" oluşturuldu (${allowedPaths.length} sayfa)`,
        level: "INFO",
      },
    })

    return NextResponse.json(created, { status: 201 })
  } catch (error: any) {
    console.error("role template POST error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}
