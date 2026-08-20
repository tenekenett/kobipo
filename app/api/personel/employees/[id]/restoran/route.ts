// Personelin RESTORAN aktivitesi — bugün için: uyguladığı hesap iskontoları.
//
// Neden İK kartında ayrı bir uç: personel modülü bugüne kadar tamamen operasyon
// dışıydı (bordro, izin, zimmet, belge). "Bu personel ne kadar indirim verdi"
// sorusunun cevabı adisyon tarafında duruyordu ve İK kartından görünmüyordu.
//
// Yeni veri ÜRETMEZ: `RestaurantTicket.discountEmployeeId` üzerinden okur.
// Ayrı bir "personel hakları defteri" tablosu bilinçli olarak YOK — para iki
// yerde yaşasaydı iskonto düzeltildiğinde ikisi ayrışırdı (aynı gerekçe:
// prisma/schema.prisma `RestaurantTable` başlığı).
//
// Eksen `closedAt`: açık adisyondaki iskonto hâlâ kaldırılabilir, iptal edilende
// tahsil edilmeyen bir para yoktur — denetim raporundaki kuralın aynısı.

import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { resolveSlugId } from "@/lib/slug-resolve"
import { discountReasonLabel, ticketDiscountOf, ticketTotals } from "@/lib/restoran/tickets"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

/** Kaç aylık geçmiş: kart bir özet penceresidir, sınırsız liste değil. */
const DEFAULT_MONTHS = 6
const MAX_ROWS = 100

export const GET = withApiErrors(async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    const { id: rawId } = await params
    const id = await resolveSlugId("employee", rawId, companyId)

    const employee = await prisma.employee.findUnique({
      where: { id },
      select: { id: true, companyId: true },
    })
    if (!employee) return NextResponse.json({ error: "Employee not found" }, { status: 404 })

    // Yetki personelin KENDİ firmasından türer — URL'deki companyId'den değil.
    const context = await ensureCompanyAccess(employee.companyId)

    // Restoran modülü kapalıysa boş dönülür, hata değil: personel kartı bu
    // sekmeyi sessizce gizlesin, bir İK ekranı modül hatasıyla kırılmasın.
    if ((context.disabledModules ?? []).includes("restaurant")) {
      return NextResponse.json({ enabled: false, summary: null, monthly: [], discounts: [] })
    }

    const months = Math.min(24, Math.max(1, Number(searchParams.get("months")) || DEFAULT_MONTHS))
    const start = new Date()
    start.setMonth(start.getMonth() - months)
    start.setHours(0, 0, 0, 0)

    const rows = await prisma.restaurantTicket.findMany({
      where: {
        companyId: employee.companyId,
        discountEmployeeId: employee.id,
        status: "CLOSED",
        closedAt: { gte: start },
      },
      select: {
        id: true,
        code: true,
        closedAt: true,
        discountType: true,
        discountValue: true,
        discountReasonCode: true,
        discountReason: true,
        table: { select: { name: true } },
        items: { select: { quantity: true, unitPrice: true, vatRate: true, status: true } },
      },
      orderBy: { closedAt: "desc" },
      take: MAX_ROWS,
    })

    const discounts = rows.map((t) => {
      const totals = ticketTotals(t.items, ticketDiscountOf(t))
      return {
        id: t.id,
        code: t.code,
        closedAt: t.closedAt?.toISOString() ?? null,
        tableName: t.table?.name ?? null,
        rate: t.discountType === "PERCENT" ? Number(t.discountValue ?? 0) : null,
        reasonLabel: discountReasonLabel(t.discountReasonCode),
        reason: t.discountReason,
        // KDV DAHİL brüt: "bu personel ne kadar indirim verdi" sorusunun cevabı
        // hesabın altındaki rakamdır, matrah karşılığı değil.
        value: totals.discount,
        /** İskontonun hesaba oranı — %5'lik bir indirimle %50'lik aynı satırda okunmasın. */
        share: totals.gross > 0 ? round2((totals.discount / totals.gross) * 100) : 0,
      }
    })

    // Aylık kırılım: tek bir toplam "arttı mı azaldı mı" sorusunu cevaplamıyor.
    const monthlyMap = new Map<string, { month: string; count: number; total: number }>()
    for (const d of discounts) {
      if (!d.closedAt) continue
      const month = d.closedAt.slice(0, 7) // YYYY-MM
      const bucket = monthlyMap.get(month) ?? { month, count: 0, total: 0 }
      bucket.count += 1
      bucket.total += d.value
      monthlyMap.set(month, bucket)
    }
    const monthly = [...monthlyMap.values()]
      .map((m) => ({ ...m, total: round2(m.total) }))
      .sort((a, b) => b.month.localeCompare(a.month))

    return NextResponse.json({
      enabled: true,
      months,
      // `truncated`: liste tavana dayandıysa toplam da eksiktir — arayüz bunu
      // söylemeli, yoksa kısmi bir rakam tam sanılır.
      truncated: rows.length === MAX_ROWS,
      summary: {
        count: discounts.length,
        total: round2(discounts.reduce((s, d) => s + d.value, 0)),
      },
      monthly,
      discounts,
    })
  } catch (error: any) {
    if (String(error?.message).includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("[Personel] Restoran aktivitesi hatası:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
