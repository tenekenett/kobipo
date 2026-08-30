import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"
import { adjustWarehouseStock, ensureDefaultWarehouseId } from "@/lib/stock/warehouse"
import { parseMovementDate } from "@/lib/stock/movement-date"

export const dynamic = 'force-dynamic'


export const GET = withApiErrors(async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    const productId = searchParams.get("productId")

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)

    const where: any = {
      companyId,
    }

    if (productId) {
      where.productId = productId
    }

    const movements = await prisma.stockMovement.findMany({
      where,
      include: {
        product: true,
      },
      orderBy: { createdAt: "desc" },
    })

    return NextResponse.json(movements)
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error fetching stock movements:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
})

/** Miktarı hata mesajında okunur bas (14,4 hassasiyetli kolon). */
function formatQty(n: number): string {
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 4 }).format(n)
}

/**
 * Ürünün SEÇİLİ DEPODAKİ bakiyesi.
 *
 * Depo satırı yoksa iki hâl ayrılır: ürünün hiçbir deposunda satırı yoksa bakiye
 * hâlâ kartta duruyordur ve ilk işlemde VARSAYILAN depoya materyalize edilir
 * (materializeLegacyStock) — o depo için kart bakiyesi geçerlidir. Başka
 * depolarda satır varken bu depoda yoksa gerçekten 0 mal vardır.
 */
async function warehouseAvailable(
  companyId: string,
  productId: string,
  warehouseId: string,
  cardQuantity: number,
): Promise<number> {
  const row = await prisma.warehouseStock.findUnique({
    where: { warehouseId_productId: { warehouseId, productId } },
    select: { quantity: true },
  })
  if (row) return Number(row.quantity)

  const anyRow = await prisma.warehouseStock.findFirst({
    where: { productId, warehouse: { companyId } },
    select: { id: true },
  })
  if (anyRow) return 0

  const defaultId = await ensureDefaultWarehouseId(prisma, companyId)
  return warehouseId === defaultId ? cardQuantity : 0
}

export const POST = withApiErrors(async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    body.companyId = await resolveCompanyId(body.companyId)
    const { companyId, productId, type, quantity, unitPrice, description, reference, warehouseId, scope } = body

    // Miktar 0 GEÇERLİDİR: ADJUSTMENT'ta "stok sıfır olsun" demenin tek yolu bu.
    // `!quantity` ile elenirken kullanıcı stoğu sıfırlayamıyordu.
    const quantityMissing = quantity === undefined || quantity === null || quantity === ""
    if (!companyId || !productId || !type || quantityMissing) {
      return NextResponse.json(
        { error: "companyId, productId, type, and quantity are required" },
        { status: 400 }
      )
    }

    await ensureCompanyWrite(companyId)

    const product = await prisma.product.findUnique({
      where: { id: productId },
    })

    if (!product || product.companyId !== companyId) {
      return NextResponse.json(
        { error: "Product not found" },
        { status: 404 }
      )
    }

    if (product.isService) {
      return NextResponse.json(
        { error: "Hizmet kaleminde stok hareketi olmaz" },
        { status: 400 }
      )
    }

    const raw = parseFloat(quantity)
    if (!Number.isFinite(raw)) {
      return NextResponse.json({ error: "Miktar sayı olmalı" }, { status: 400 })
    }

    // Fiş tarihi: mal dün geldi, kayıt bugün giriliyor olabilir (bkz. movement-date.ts).
    const parsedDate = parseMovementDate(body.date)
    if (!parsedDate.ok) {
      return NextResponse.json({ error: parsedDate.error }, { status: 400 })
    }

    // Depo verilmişse SAHİPLİĞİ doğrulanır: id istemciden geliyor ve firma değiştiren
    // bir ekranda eski firmanın deposu state'te kalabiliyor — doğrulamazsak stok
    // başka firmanın deposuna yazılır (canlıda böyle satırlar oluştu).
    // Depoyu kullanıcı mı seçti? Depo bazlı yetersizlik denetimi buna bağlı:
    // depo seçilmediğinde uç "en çok stoğun olduğu depo"yu kendi seçer ve orada
    // yetmemesi kullanıcının anlayabileceği bir hata değildir (fatura ekranındaki
    // hızlı düzeltme depo göndermez). Seçildiğinde ise "o depodan çıkar" denmiştir.
    const explicitWarehouse = Boolean(warehouseId)
    let targetWarehouseId: string
    if (warehouseId) {
      const wh = await prisma.warehouse.findFirst({
        where: { id: String(warehouseId), companyId },
        select: { id: true },
      })
      if (!wh) {
        return NextResponse.json({ error: "Depo bu firmaya ait değil" }, { status: 400 })
      }
      targetWarehouseId = wh.id
    } else {
      const existing = await prisma.warehouseStock.findFirst({
        where: { productId, warehouse: { companyId } },
        orderBy: { quantity: "desc" },
        select: { warehouseId: true },
      })
      targetWarehouseId = existing?.warehouseId ?? (await ensureDefaultWarehouseId(prisma, companyId))
    }

    const current = Number(product.stockQuantity)
    const available = await warehouseAvailable(companyId, productId, targetWarehouseId, current)

    // Hareketin İŞARETLİ değişimi. ADJUSTMENT'ta gövdedeki miktar HEDEF bakiyedir
    // (ekran "stok kaç olsun" diye sorar), deftere yazılan ise FARK olmalı: mutlak
    // değeri hareket olarak yazmak defteri kartla ayrıştırıyordu — hedef 1.097 girilen
    // bir üründe hareket toplamı milyonlara çıkıp raporları anlamsızlaştırdı.
    let delta: number
    if (type === "IN") {
      delta = Math.abs(raw)
    } else if (type === "OUT") {
      delta = -Math.abs(raw)
      if (current + delta < 0) {
        return NextResponse.json({ error: "Yetersiz stok" }, { status: 400 })
      }
      // Depo bazlı ikinci denetim: toplam yetse de MAL O DEPODA olmayabilir.
      // Yoksa depo satırı eksiye düşer ve depo dökümü kartla çelişir — kullanıcı
      // bunu "stok tutmuyor" diye yaşar.
      if (explicitWarehouse && available + delta < 0) {
        return NextResponse.json(
          { error: `Seçili depoda yeterli stok yok (mevcut: ${formatQty(available)})` },
          { status: 400 }
        )
      }
    } else if (type === "ADJUSTMENT") {
      if (raw < 0) {
        return NextResponse.json({ error: "Hedef stok negatif olamaz" }, { status: 400 })
      }
      // İki sayım kipi:
      //  • WAREHOUSE — hedef SEÇİLİ DEPONUN bakiyesidir (stok ekranındaki sayım
      //    penceresi böyle sorar). Çok depolu firmada tek doğru okuma budur:
      //    kart hedefini tek depoya yazmak o depoyu eksiye düşürebiliyordu.
      //  • COMPANY  — hedef KART bakiyesidir; tek depolu ekranların (fatura
      //    editöründeki hızlı düzeltme) eski davranışı, varsayılan.
      const base = String(scope || "").toUpperCase() === "WAREHOUSE" ? available : current
      delta = Math.round((raw - base) * 10000) / 10000
      if (current + delta < 0) {
        return NextResponse.json({ error: "Hedef stok kartı negatife düşürüyor" }, { status: 400 })
      }
      if (explicitWarehouse && available + delta < 0) {
        return NextResponse.json(
          { error: `Seçili depodaki bakiye negatife düşerdi (mevcut: ${formatQty(available)})` },
          { status: 400 }
        )
      }
    } else {
      return NextResponse.json(
        { error: "Geçersiz hareket tipi (IN | OUT | ADJUSTMENT)" },
        { status: 400 }
      )
    }

    if (delta === 0) {
      return NextResponse.json({ ok: true, stockQuantity: current, unchanged: true })
    }

    // Tek kapı: kart + depo bakiyesi + hareket birlikte yazılır. Eskiden bu uç
    // hareketi ve kartı elle yazıp WarehouseStock'a hiç dokunmuyordu; depo dökümü
    // kartla ayrışıyordu.
    await adjustWarehouseStock(prisma, {
      companyId,
      productId,
      warehouseId: targetWarehouseId,
      delta,
      type,
      unitPrice: unitPrice ? parseFloat(unitPrice) : null,
      description,
      reference,
      createdBy: user.id,
      date: parsedDate.date,
    })

    return NextResponse.json(
      { ok: true, stockQuantity: Math.round((current + delta) * 10000) / 10000, delta },
      { status: 201 }
    )
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error creating stock movement:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
})

