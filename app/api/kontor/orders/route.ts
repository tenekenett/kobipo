import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { requireSuperAdmin } from "@/lib/auth/require-super-admin"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { isPaytrEnabled, PAYTR_NOT_CONFIGURED_ERROR } from "@/lib/integrations/paytr/client"
import { generateUniquePaymentCode } from "@/lib/kontor/payment-code"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

const ERR_NO_VERIFIED_VKN =
  "Kontör yüklemesi için firmanızın VKN/TCKN bilgisi gerekli. Firma Ayarları'ndan firma VKN/TCKN bilginizi girin."

/**
 * GET  — Siparişleri listele. ?all=1 (sistem-admin) hepsini; aksi halde ?companyId ile firma siparişleri.
 * POST — Yeni sipariş oluştur (firma kullanıcısı). Paket seçer; kontör firmanın doğrulanmış VKN'sine yüklenecek.
 */
export const GET = withApiErrors(async function GET(request: Request) {
  try {
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

    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    // Başka firmanın id'siyle çağrıldığında fırlatır; POST'taki gibi 403'e çevrilir
    // (yakalanmazsa 500 dönüyordu — erişim yine engelliydi ama istemci hatayı okuyamıyordu).
    await ensureCompanyAccess(companyId)
    const orders = await prisma.kontorOrder.findMany({
      where: { companyId },
      orderBy: { createdAt: "desc" },
    })
    return NextResponse.json({ data: orders })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("kontor orders GET error:", error)
    return NextResponse.json({ error: message || "Internal server error" }, { status: 500 })
  }
})

export const POST = withApiErrors(async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    // companyId dashboard'dan slug gelebilir → cuid'e çevir (GET zaten çeviriyor). [[resolve-company.ts]]
    const companyId = (await resolveCompanyId(String(body?.companyId ?? ""))) ?? ""
    const packageId = String(body?.packageId ?? "")
    // Ödeme yöntemi: "CARD" (PayTR sanal POS) veya "HAVALE" (varsayılan, manuel onay).
    const paymentMethod = body?.paymentMethod === "CARD" ? "CARD" : "HAVALE"
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    if (!packageId) return NextResponse.json({ error: "packageId zorunlu" }, { status: 400 })
    if (paymentMethod === "CARD" && !isPaytrEnabled()) {
      return NextResponse.json({ error: PAYTR_NOT_CONFIGURED_ERROR }, { status: 400 })
    }

    await ensureCompanyAccess(companyId)

    const pkg = await prisma.kontorPackage.findUnique({ where: { id: packageId } })
    if (!pkg || !pkg.isActive) {
      return NextResponse.json({ error: "Paket bulunamadı veya pasif" }, { status: 404 })
    }

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { eDonusumTenantVkn: true, taxNumber: true },
    })
    // VKN doğrulama akışı kaldırıldı — eDonusumTenantVkn boşsa firmanın kendi
    // VKN/TCKN'sine fallback yap. Yalnız hiçbir yerde VKN tanımlı değilse engelle.
    const targetVkn = (company?.eDonusumTenantVkn || company?.taxNumber || "").replace(/\D/g, "")
    if (targetVkn.length !== 10 && targetVkn.length !== 11) {
      return NextResponse.json({ error: ERR_NO_VERIFIED_VKN }, { status: 412 })
    }

    // Havale siparişine referans kodu: müşteri bunu banka açıklamasına yazar, admin
    // dekontla hesap hareketini bununla eşleştirir ([[lib/kontor/payment-code.ts]]).
    const paymentCode = paymentMethod === "HAVALE" ? await generateUniquePaymentCode() : null

    const order = await prisma.kontorOrder.create({
      data: {
        companyId,
        paymentCode,
        packageId: pkg.id,
        packageName: pkg.name,
        creditQty: pkg.creditQty,
        unitPrice: pkg.price,
        totalPrice: pkg.price,
        currency: pkg.currency,
        mysoftTariffCode: pkg.mysoftTariffCode,
        targetVkn,
        status: "PENDING_PAYMENT",
        paymentMethod,
        paymentProvider: paymentMethod === "CARD" ? "PAYTR" : null,
        createdById: user.id,
      },
    })
    return NextResponse.json(order)
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("kontor orders POST error:", error)
    return NextResponse.json({ error: message || "Internal server error" }, { status: 500 })
  }
})
