import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { requireSuperAdmin } from "@/lib/auth/require-super-admin"
import { prisma } from "@/lib/db/prisma"
import { isPaytrEnabled } from "@/lib/integrations/paytr/client"

export const dynamic = "force-dynamic"

/**
 * GET  — Satılabilir kontör paketleri.
 *        ?all=1 (sistem-admin) tüm paketleri, aksi halde sadece aktif olanları döner.
 * POST — Yeni paket oluştur (sadece sistem-admin).
 */
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const wantAll = searchParams.get("all") === "1"

  // "all" yalnızca sistem-admin'e açık.
  let includeInactive = false
  if (wantAll) {
    const auth = await requireSuperAdmin()
    if ("error" in auth) return auth.error
    includeInactive = true
  }

  const packages = await prisma.kontorPackage.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { price: "asc" }],
  })
  // paytrEnabled: kart ödeme butonunu yalnızca PayTR yapılandırılmışsa göstermek için.
  return NextResponse.json({ data: packages, paytrEnabled: isPaytrEnabled() })
}

export async function POST(request: Request) {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error

  try {
    const body = await request.json()
    const name = String(body?.name ?? "").trim()
    const creditQty = Number(body?.creditQty)
    const price = Number(body?.price)
    const mysoftTariffCode = String(body?.mysoftTariffCode ?? "").trim()

    if (!name) return NextResponse.json({ error: "Paket adı zorunlu" }, { status: 400 })
    if (!Number.isInteger(creditQty) || creditQty <= 0) {
      return NextResponse.json({ error: "Kontör adedi pozitif tam sayı olmalı" }, { status: 400 })
    }
    if (!Number.isFinite(price) || price < 0) {
      return NextResponse.json({ error: "Fiyat geçersiz" }, { status: 400 })
    }
    if (!mysoftTariffCode) {
      return NextResponse.json({ error: "Mysoft tarife kodu zorunlu" }, { status: 400 })
    }

    const validityMonths =
      body?.validityMonths != null && Number.isFinite(Number(body.validityMonths))
        ? Number(body.validityMonths)
        : null

    // KDV oranı: boş bırakılırsa NULL yazılır ve faturalandırma sistem varsayılanını
    // (%20) kullanır — bkz. lib/billing/vat.ts. Fiyat KDV DAHİL'dir; oran yalnız
    // matrah/KDV ayrıştırmasını değiştirir, müşterinin ödediği tutarı DEĞİL.
    const rawVat = body?.vatRate
    const vatRate =
      rawVat != null && String(rawVat).trim() !== "" && Number.isFinite(Number(rawVat))
        ? Math.min(100, Math.max(0, Number(rawVat)))
        : null

    const created = await prisma.kontorPackage.create({
      data: {
        name,
        description: body?.description ? String(body.description).trim() : null,
        creditQty,
        price,
        currency: body?.currency ? String(body.currency).trim() : "TRY",
        mysoftTariffCode,
        validityMonths,
        vatRate,
        isActive: body?.isActive == null ? true : Boolean(body.isActive),
        sortOrder: Number.isInteger(Number(body?.sortOrder)) ? Number(body.sortOrder) : 0,
      },
    })
    return NextResponse.json(created)
  } catch (error: any) {
    console.error("kontor packages POST error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}
