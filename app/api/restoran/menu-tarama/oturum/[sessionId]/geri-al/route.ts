/**
 * "Bu taramayı geri al" (plan §3.13).
 *
 *   PRODUCT      → ürün HİÇ kullanılmadıysa (fatura/adisyon/teklif/sipariş/irsaliye
 *                  kalemi, stok hareketi, reçete bileşeni yok) SİLİNİR; aksi halde
 *                  isSellable=false (satış ızgarasından düşer, geçmiş yerinde kalır).
 *   OPTION_GROUP → ürünle birlikte gider; ürün kaldıysa grup da kalır (dokunulmadı).
 *   PRICE        → geri alınmaz: eski fiyat saklanmıyor, kullanıcı menü ekranından düzeltir.
 *   UNLISTED     → isSellable=true (menüye geri açılır).
 *
 * Her hedefe ne yapıldığı yazılır (`geriAlma`); ikinci çağrı aynı hedefi atlar.
 */

import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"
import { assertRestaurantModule } from "@/lib/restoran/tickets"
import { prisma } from "@/lib/db/prisma"
import { hedefleriOku, oturumBasi } from "@/lib/menu-ocr/kayit"
import type { MenuHedefi } from "@/lib/menu-ocr/turler"

export const dynamic = "force-dynamic"

type Sonuc = NonNullable<MenuHedefi["geriAlma"]>["sonuc"]

export const POST = withApiErrors(async function POST(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const { sessionId } = await params
    const body = await request.json().catch(() => ({}))
    const companyId = await resolveCompanyId(typeof body?.companyId === "string" ? body.companyId : null)
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })
    assertRestaurantModule(await ensureCompanyWrite(companyId))

    const satirlar = await prisma.documentScan.findMany({
      where: { companyId, kind: "MENU", sessionId },
      select: { id: true, targets: true, createdAt: true },
    })
    const bas = oturumBasi(satirlar)
    if (!bas) return NextResponse.json({ error: "Oturum bulunamadı" }, { status: 404 })

    const hedefler = hedefleriOku(bas.targets)
    const at = new Date().toISOString()
    const ozet: Record<Sonuc, number> = { silindi: 0, "menuden-kaldirildi": 0, "geri-acildi": 0, dokunulmadi: 0 }
    // Ürün silinince seçenek grubu cascade ile gider; aynı ürünün grubunu ayrıca işlemeyelim.
    const silinenUrunler = new Set<string>()

    const guncel: MenuHedefi[] = []
    for (const h of hedefler) {
      if (h.geriAlma) {
        guncel.push(h)
        continue
      }
      let sonuc: Sonuc = "dokunulmadi"
      if (h.type === "PRODUCT") {
        const urun = await prisma.product.findFirst({
          where: { id: h.id, companyId },
          select: {
            id: true,
            _count: { select: { invoiceItems: true, ticketItems: true, quoteItems: true, orderItems: true, waybillItems: true, stockMovements: true, usedInRecipes: true } },
          },
        })
        if (urun) {
          const kullanildi = Object.values(urun._count).some((n) => n > 0)
          if (kullanildi) {
            await prisma.product.update({ where: { id: urun.id }, data: { isSellable: false } })
            sonuc = "menuden-kaldirildi"
          } else {
            await prisma.product.delete({ where: { id: urun.id } })
            silinenUrunler.add(urun.id)
            sonuc = "silindi"
          }
        }
      } else if (h.type === "UNLISTED") {
        const r = await prisma.product.updateMany({ where: { id: h.id, companyId }, data: { isSellable: true } })
        if (r.count > 0) sonuc = "geri-acildi"
      }
      // OPTION_GROUP ve PRICE: dokunulmadı (yukarıdaki gerekçe).
      ozet[sonuc]++
      guncel.push({ ...h, geriAlma: { at, sonuc } })
    }

    await prisma.documentScan.update({ where: { id: bas.id }, data: { targets: guncel as unknown as Prisma.InputJsonValue } })
    return NextResponse.json({ ok: true, ozet, hedefler: guncel })
  } catch (error: any) {
    if (typeof error?.message === "string" && error.message.includes("Access denied")) return accessDeniedResponse(error, error.message)
    throw error
  }
})
