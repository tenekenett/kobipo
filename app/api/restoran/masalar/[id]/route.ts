import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { assertRestaurantModule, TABLE_SHAPES } from "@/lib/restoran/tickets"

export const dynamic = "force-dynamic"

type Params = { params: Promise<{ id: string }> }

/**
 * Masayı günceller. Sürükle-bırak yerleşimi de buradan geçer: bırakma anında
 * tek masa için `{ x, y }` gönderilir — tüm planı yeniden yazmak gerekmez.
 */
export async function PATCH(request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const companyId = await resolveCompanyId(body.companyId)
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyWrite(companyId))

    const { id } = await params
    const existing = await prisma.restaurantTable.findFirst({ where: { id, companyId } })
    if (!existing) return NextResponse.json({ error: "Masa bulunamadı" }, { status: 404 })

    const data: Record<string, unknown> = {}

    if (body.name !== undefined) {
      const name = String(body.name || "").trim()
      if (!name) return NextResponse.json({ error: "Masa adı zorunlu" }, { status: 400 })
      const clash = await prisma.restaurantTable.findFirst({
        where: { companyId, name, id: { not: id } },
      })
      if (clash) return NextResponse.json({ error: "Bu adda bir masa zaten var" }, { status: 409 })
      data.name = name
    }

    if (body.areaId !== undefined) {
      const areaId = body.areaId ? String(body.areaId) : null
      if (areaId) {
        const area = await prisma.restaurantArea.findFirst({ where: { id: areaId, companyId } })
        if (!area) return NextResponse.json({ error: "Bölge bulunamadı" }, { status: 404 })
      }
      data.areaId = areaId
    }

    if (body.capacity !== undefined) {
      data.capacity = Number.isFinite(Number(body.capacity)) ? Number(body.capacity) : null
    }
    if (body.shape !== undefined && TABLE_SHAPES.includes(body.shape)) data.shape = body.shape
    if (body.x !== undefined && Number.isFinite(Number(body.x))) {
      data.x = Math.max(0, Math.trunc(Number(body.x)))
    }
    if (body.y !== undefined && Number.isFinite(Number(body.y))) {
      data.y = Math.max(0, Math.trunc(Number(body.y)))
    }
    if (body.width !== undefined) data.width = clampSize(body.width, existing.width)
    if (body.height !== undefined) data.height = clampSize(body.height, existing.height)

    // Temizlik damgası. `cleaned: true` → masa toplandı (damga silinir),
    // `false` → elle "toplanacak" işaretlenir (müşteri kalkmış ama hesap başka
    // masadan kapanmışsa garson kendi işaretler).
    if (body.cleaned !== undefined) {
      data.cleaningSince = body.cleaned ? null : (existing.cleaningSince ?? new Date())
    }

    if (body.isActive !== undefined) {
      const next = Boolean(body.isActive)
      if (!next) {
        const open = await prisma.restaurantTicket.count({ where: { tableId: id, status: "OPEN" } })
        if (open > 0) {
          return NextResponse.json(
            { error: "Masada açık adisyon var; önce adisyonu kapatın" },
            { status: 409 },
          )
        }
      }
      data.isActive = next
    }

    const table = await prisma.restaurantTable.update({ where: { id }, data })
    return NextResponse.json(table)
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error("Error updating restaurant table:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * Masayı kaldırır. Geçmiş adisyonu olan masa SİLİNMEZ, pasifleştirilir —
 * silinseydi (şemadaki SetNull) o adisyonlar masasız kalır, gün sonu raporunda
 * hangi masaya ait oldukları kaybolurdu. Hiç adisyonu olmayan (yanlışlıkla
 * açılmış) masa gerçekten silinir.
 */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })

    assertRestaurantModule(await ensureCompanyWrite(companyId))

    const { id } = await params
    const existing = await prisma.restaurantTable.findFirst({ where: { id, companyId } })
    if (!existing) return NextResponse.json({ error: "Masa bulunamadı" }, { status: 404 })

    const open = await prisma.restaurantTicket.count({ where: { tableId: id, status: "OPEN" } })
    if (open > 0) {
      return NextResponse.json(
        { error: "Masada açık adisyon var; önce adisyonu kapatın" },
        { status: 409 },
      )
    }

    const history = await prisma.restaurantTicket.count({ where: { tableId: id } })
    if (history > 0) {
      await prisma.restaurantTable.update({ where: { id }, data: { isActive: false } })
      return NextResponse.json({ success: true, deactivated: true })
    }

    await prisma.restaurantTable.delete({ where: { id } })
    return NextResponse.json({ success: true, deactivated: false })
  } catch (error: any) {
    if (error.message?.includes("Access denied")) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    console.error("Error deleting restaurant table:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/**
 * Ölçüler 1–40 hücre. Üst sınır kroki öğeleriyle AYNI: gerçek sınırı planın
 * kendi ızgarası koyuyor (ekran öğeyi kare tuvale sığdırıyor). Masaya ayrı ve
 * daha dar bir sınır koymak, tutamaçtan çekilen ölçünün sessizce başka bir
 * değere düşmesine yol açıyordu.
 */
function clampSize(value: unknown, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(40, Math.max(1, Math.trunc(n)))
}
