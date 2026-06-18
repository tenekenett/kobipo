import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { requireSuperAdmin } from "@/lib/auth/require-super-admin"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"

export const dynamic = "force-dynamic"

const ERR_NO_VERIFIED_VKN =
  "Kontör yüklemesi için firmanızın Mysoft mükellef VKN'si doğrulanmış olmalı. E-Dönüşüm Ayarları'ndan VKN doğrulayın."

/**
 * GET  — Siparişleri listele. ?all=1 (sistem-admin) hepsini; aksi halde ?companyId ile firma siparişleri.
 * POST — Yeni sipariş oluştur (firma kullanıcısı). Paket seçer; kontör firmanın doğrulanmış VKN'sine yüklenecek.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  if (searchParams.get("all") === "1") {
    const auth = await requireSuperAdmin()
    if ("error" in auth) return auth.error
    const orders = await prisma.kontorOrder.findMany({
      orderBy: { createdAt: "desc" },
      include: { company: { select: { id: true, name: true } } },
    })
    return NextResponse.json({ data: orders })
  }

  const companyId = searchParams.get("companyId")
  if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
  await ensureCompanyAccess(companyId)
  const orders = await prisma.kontorOrder.findMany({
    where: { companyId },
    orderBy: { createdAt: "desc" },
  })
  return NextResponse.json({ data: orders })
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const companyId = String(body?.companyId ?? "")
    const packageId = String(body?.packageId ?? "")
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    if (!packageId) return NextResponse.json({ error: "packageId zorunlu" }, { status: 400 })

    await ensureCompanyAccess(companyId)

    const pkg = await prisma.kontorPackage.findUnique({ where: { id: packageId } })
    if (!pkg || !pkg.isActive) {
      return NextResponse.json({ error: "Paket bulunamadı veya pasif" }, { status: 404 })
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { eDonusumTenantVkn: true },
    })
    const targetVkn = (company?.eDonusumTenantVkn || "").replace(/\D/g, "")
    if (targetVkn.length !== 10 && targetVkn.length !== 11) {
      return NextResponse.json({ error: ERR_NO_VERIFIED_VKN }, { status: 412 })
    }

    const order = await prisma.kontorOrder.create({
      data: {
        companyId,
        packageId: pkg.id,
        packageName: pkg.name,
        creditQty: pkg.creditQty,
        unitPrice: pkg.price,
        totalPrice: pkg.price,
        currency: pkg.currency,
        mysoftTariffCode: pkg.mysoftTariffCode,
        targetVkn,
        status: "PENDING_PAYMENT",
        paymentMethod: "HAVALE",
        createdById: user.id,
      },
    })
    return NextResponse.json(order)
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("kontor orders POST error:", error)
    return NextResponse.json({ error: message || "Internal server error" }, { status: 500 })
  }
}
