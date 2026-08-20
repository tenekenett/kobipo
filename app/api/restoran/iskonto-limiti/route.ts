import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { assertRestaurantModule } from "@/lib/restoran/tickets"
import { isValidLimitInput, normalizeDiscountLimit } from "@/lib/restoran/discount-limit"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * İskonto tavanı (Company.restaurantMaxDiscountPercent).
 *
 * Firma ayarı olduğu halde restoran altında duruyor: tek tüketicisi kafe/restoran
 * iskontosu ve ayar, etkisinin ÖLÇÜLDÜĞÜ ekrandan (Raporlar → İkram & Denetim)
 * yerinde düzenleniyor — açılış saatinin vardiya takviminde durmasıyla aynı
 * gerekçe (app/api/personel/opening-hours).
 *
 * OKUMA herkese açık: iskonto diyaloğu tavanı göstermek ve "Uygula"yı kilitlemek
 * için okur, yani kasiyer de görür. YAZMA yalnız ADMIN'de — tavanı, bağladığı
 * kişinin kendisi değiştirebilseydi kural olmazdı. (Şube müdürü de yazamaz;
 * şubelerde ana firmanın sahibi zaten sanal ADMIN'dir, bkz. lib/auth/user-context.)
 */
export const GET = withApiErrors(async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    const context = await ensureCompanyAccess(companyId)
    assertRestaurantModule(context)

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: { restaurantMaxDiscountPercent: true },
    })

    return NextResponse.json({
      maxDiscountPercent: normalizeDiscountLimit(company?.restaurantMaxDiscountPercent),
      canEdit: context.role === "ADMIN",
    })
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error, error.message)
    }
    console.error("Error fetching discount limit:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const PUT = withApiErrors(async function PUT(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const companyId = await resolveCompanyId(body.companyId)
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    const context = await ensureCompanyWrite(companyId)
    assertRestaurantModule(context)
    if (context.role !== "ADMIN") {
      return NextResponse.json(
        { error: "İskonto tavanını yalnızca firma yöneticisi değiştirebilir" },
        { status: 403 },
      )
    }

    // Tanınmayan değer sessizce "sınırsız"a düşmemeli: patron %50 yazar, sunucu
    // anlamaz, kayıt sınırsız olur ve kimse fark etmezdi. Bu yüzden doğrulama
    // `normalizeDiscountLimit`ten AYRI sorulur.
    const raw = body.maxDiscountPercent === undefined ? null : body.maxDiscountPercent
    if (!isValidLimitInput(raw)) {
      return NextResponse.json({ error: "Tavan 0 ile 100 arasında olmalı" }, { status: 400 })
    }
    const limit = normalizeDiscountLimit(raw)

    await prisma.company.update({
      where: { id: companyId },
      data: { restaurantMaxDiscountPercent: limit },
    })

    return NextResponse.json({ maxDiscountPercent: limit, canEdit: true })
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return accessDeniedResponse(error, error.message)
    }
    console.error("Error saving discount limit:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
