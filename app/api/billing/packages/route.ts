import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { requireSuperAdmin } from "@/lib/auth/require-super-admin"
import { prisma } from "@/lib/db/prisma"
import { sanitizeDisabledModules } from "@/lib/modules"
import { getSellablePlans } from "@/lib/billing/catalog"
import { isPaytrEnabled } from "@/lib/integrations/paytr/client"

export const dynamic = "force-dynamic"

/**
 * Satılabilir hazır paketler (bundle = Plan tablosu, deneme planı hariç).
 * GET  — aktif paketler herkese; ?all=1 (süper admin) pasifler dahil.
 * POST — yeni paket oluştur (süper admin).
 */
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const wantAll = new URL(request.url).searchParams.get("all") === "1"
  let includeInactive = false
  if (wantAll) {
    const auth = await requireSuperAdmin()
    if ("error" in auth) return auth.error
    includeInactive = true
  }

  const packages = await getSellablePlans(includeInactive)
  return NextResponse.json({ data: packages, paytrEnabled: isPaytrEnabled() })
}

/** Ada göre benzersiz paket kodu üretir (TR karakterleri sadeleştirir). */
function makeCode(name: string): string {
  const base = name
    .toLocaleUpperCase("tr-TR")
    .replace(/İ/g, "I").replace(/Ş/g, "S").replace(/Ğ/g, "G")
    .replace(/Ü/g, "U").replace(/Ö/g, "O").replace(/Ç/g, "C")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24)
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase()
  return `${base || "PKG"}_${suffix}`
}

export async function POST(request: Request) {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error

  try {
    const body = await request.json()
    const name = String(body?.name ?? "").trim()
    if (!name) return NextResponse.json({ error: "Paket adı zorunlu" }, { status: 400 })

    const monthlyPrice = Number(body?.monthlyPrice)
    if (!Number.isFinite(monthlyPrice) || monthlyPrice < 0) {
      return NextResponse.json({ error: "Aylık fiyat geçersiz" }, { status: 400 })
    }
    const yearlyPrice =
      body?.yearlyPrice == null || body?.yearlyPrice === ""
        ? null
        : Number(body.yearlyPrice)
    if (yearlyPrice != null && (!Number.isFinite(yearlyPrice) || yearlyPrice < 0)) {
      return NextResponse.json({ error: "Yıllık fiyat geçersiz" }, { status: 400 })
    }

    const includedModules = sanitizeDisabledModules(body?.includedModules)
    const includedBranches = Math.max(0, Math.floor(Number(body?.includedBranches) || 0))
    // Ek firma pakete AYRI girer; şube adedinden türetilmez. (Eskiden maxCompanies =
    // includedBranches + 1 yazılıyor ve iki kavram tek sayaca biniyordu.)
    const includedCompanies = Math.max(0, Math.floor(Number(body?.includedCompanies) || 0))
    const maxUsers = Math.max(1, Math.floor(Number(body?.maxUsers) || 1))

    const created = await prisma.plan.create({
      data: {
        code: makeCode(name),
        name,
        description: body?.description ? String(body.description).trim() : null,
        monthlyPrice,
        yearlyPrice,
        includedModules,
        includedBranches,
        includedCompanies,
        maxUsers,
        highlighted: Boolean(body?.highlighted),
        sortOrder: Number.isFinite(Number(body?.sortOrder)) ? Number(body.sortOrder) : 0,
        isActive: body?.isActive == null ? true : Boolean(body.isActive),
      },
    })
    return NextResponse.json(created)
  } catch (error: any) {
    console.error("billing packages POST error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}
