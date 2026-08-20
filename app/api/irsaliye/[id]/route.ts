import { accessDeniedResponse, isAccessDeniedError, withApiErrors } from "@/lib/api/errors"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { getCurrentUser } from "@/lib/auth/session"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { adjustWarehouseStock, ensureDefaultWarehouseId, revertStockByReference } from "@/lib/stock/warehouse"

export const dynamic = "force-dynamic"

const VALID_STATUSES = ["DRAFT", "SENT", "DELIVERED", "CANCELLED"]

// PrismaClient ya da $transaction içindeki client — ikisi de bu modelleri taşır.
type StockDb = Pick<
  typeof prisma,
  "warehouse" | "warehouseStock" | "product" | "stockMovement" | "waybillItem"
>

/**
 * İrsaliye kalemlerini stoğa işler (`IN`, reference = "waybill:<id>"). Hizmet ürünleri
 * ve ürün kartı bağlı olmayan satırlar atlanır. Çağıran, geri alma/idempotentlik
 * kararını verir — burada koşulsuz yazılır.
 */
async function applyWaybillStock(
  tx: StockDb,
  args: { companyId: string; waybillId: string; waybillNo: string; createdBy?: string | null },
) {
  const items = await tx.waybillItem.findMany({ where: { waybillId: args.waybillId } })
  const productIds = Array.from(
    new Set(items.map((i) => i.productId).filter((x): x is string => Boolean(x))),
  )
  const serviceIds = new Set(
    productIds.length > 0
      ? (
          await tx.product.findMany({
            where: { id: { in: productIds }, isService: true },
            select: { id: true },
          })
        ).map((p) => p.id)
      : [],
  )
  const whId = await ensureDefaultWarehouseId(tx, args.companyId)
  for (const it of items) {
    if (!it.productId || serviceIds.has(it.productId)) continue
    const qty = Number(it.quantity) || 0
    if (qty <= 0) continue
    await adjustWarehouseStock(tx, {
      companyId: args.companyId,
      productId: it.productId,
      warehouseId: whId,
      delta: qty,
      type: "IN",
      description: `${args.waybillNo} - Alış irsaliyesi (stok girişi)`,
      reference: `waybill:${args.waybillId}`,
      createdBy: args.createdBy ?? null,
    })
  }
}

export const GET = withApiErrors(async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const waybill = await prisma.waybill.findUnique({
    where: { id },
    include: {
      customer: true,
      supplier: true,
      invoice: { select: { id: true, invoiceNo: true } },
      items: { include: { product: true }, orderBy: { order: "asc" } },
    },
  })
  if (!waybill) return NextResponse.json({ error: "Waybill not found" }, { status: 404 })

  await ensureCompanyAccess(waybill.companyId)
  return NextResponse.json(waybill)
})

export const PUT = withApiErrors(async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const existing = await prisma.waybill.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "Waybill not found" }, { status: 404 })
  await ensureCompanyWrite(existing.companyId)

  const body = await request.json()
  const {
    status,
    waybillNo,
    supplierId,
    customerId,
    invoiceId,
    date,
    deliveryDate,
    carrier,
    vehicleNo,
    driverName,
    departureAddress,
    deliveryAddress,
    notes,
    items,
  } = body

  // İçerik düzenlemesi mi, yoksa yalnız durum/fatura bağı mı? Faturaya bağlı bir
  // irsaliyenin kalemleri/no'su değişirse fatura ile belge ayrışır — bunu engelliyoruz;
  // kullanıcı önce eşleştirmeyi kaldırır.
  const contentEdit = [
    waybillNo,
    supplierId,
    customerId,
    date,
    deliveryDate,
    carrier,
    vehicleNo,
    driverName,
    departureAddress,
    deliveryAddress,
    notes,
    items,
  ].some((v) => v !== undefined)
  if (existing.invoiceId && contentEdit) {
    return NextResponse.json(
      { error: "Bu irsaliye bir faturaya bağlı. Düzenlemek için önce fatura eşleştirmesini kaldırın." },
      { status: 409 },
    )
  }

  const data: any = {}
  if (status !== undefined) {
    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: "Geçersiz durum" }, { status: 400 })
    }
    data.status = status
  }
  if (waybillNo !== undefined) {
    const trimmed = String(waybillNo || "").trim()
    if (!trimmed) {
      return NextResponse.json({ error: "İrsaliye no boş olamaz" }, { status: 400 })
    }
    data.waybillNo = trimmed
  }
  if (supplierId !== undefined && existing.type === "PURCHASE") {
    if (!supplierId) {
      return NextResponse.json({ error: "Alış irsaliyesi için tedarikçi seçilmelidir" }, { status: 400 })
    }
    const supplier = await prisma.supplier.findFirst({
      where: { id: String(supplierId), companyId: existing.companyId },
      select: { id: true },
    })
    if (!supplier) return NextResponse.json({ error: "Tedarikçi bulunamadı" }, { status: 404 })
    data.supplierId = supplier.id
  }
  if (customerId !== undefined && existing.type === "SALES") {
    if (!customerId) {
      return NextResponse.json({ error: "Satış irsaliyesi için müşteri seçilmelidir" }, { status: 400 })
    }
    const customer = await prisma.customer.findFirst({
      where: { id: String(customerId), companyId: existing.companyId },
      select: { id: true },
    })
    if (!customer) return NextResponse.json({ error: "Müşteri bulunamadı" }, { status: 404 })
    data.customerId = customer.id
  }

  // Fatura eşleştirme: mevcut bir faturaya bağla ya da bağı çöz.
  let linkedInvoice: { id: string; invoiceNo: string } | null = null
  if (invoiceId !== undefined) {
    if (invoiceId) {
      const invoice = await prisma.invoice.findFirst({
        where: { id: String(invoiceId), companyId: existing.companyId },
        select: { id: true, invoiceNo: true, type: true, supplierId: true },
      })
      if (!invoice) return NextResponse.json({ error: "Fatura bulunamadı" }, { status: 404 })
      if (existing.type === "PURCHASE" && invoice.type !== "PURCHASE") {
        return NextResponse.json({ error: "Alış irsaliyesi yalnız alış faturasına bağlanabilir" }, { status: 400 })
      }
      data.invoiceId = invoice.id
      linkedInvoice = { id: invoice.id, invoiceNo: invoice.invoiceNo }
    } else {
      data.invoiceId = null
    }
  }
  if (date !== undefined) data.date = date ? new Date(date) : existing.date
  if (deliveryDate !== undefined) data.deliveryDate = deliveryDate ? new Date(deliveryDate) : null
  if (carrier !== undefined) data.carrier = carrier || null
  if (vehicleNo !== undefined) data.vehicleNo = vehicleNo || null
  if (driverName !== undefined) data.driverName = driverName || null
  if (departureAddress !== undefined) data.departureAddress = departureAddress || null
  if (deliveryAddress !== undefined) data.deliveryAddress = deliveryAddress || null
  if (notes !== undefined) data.notes = notes || null

  if (Array.isArray(items)) {
    const normalized = items
      .filter((item: any) => item?.description && String(item.description).trim())
      .map((item: any, index: number) => ({
        productId: item.productId || null,
        description: String(item.description).trim(),
        quantity: Number(item.quantity || 0),
        unit: item.unit ? String(item.unit) : null,
        weight: item.weight !== undefined && item.weight !== null && item.weight !== "" ? Number(item.weight) : null,
        notes: item.notes ? String(item.notes) : null,
        order: index,
      }))
    if (!normalized.length) {
      return NextResponse.json({ error: "En az bir geçerli kalem gerekli" }, { status: 400 })
    }
    data.items = { deleteMany: {}, create: normalized }
  }

  let waybill
  try {
    waybill = await prisma.waybill.update({
      where: { id },
      data,
      include: {
        customer: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
        invoice: { select: { id: true, invoiceNo: true } },
        _count: { select: { items: true } },
      },
    })
  } catch (error: any) {
    // Kapı reddi (modül/sayfa/rol) 403 döner; buradaki diğer dallar veri hatası içindir.
    if (isAccessDeniedError(error)) return accessDeniedResponse(error)
    if (error?.code === "P2002") {
      return NextResponse.json({ error: "Bu irsaliye no zaten kayıtlı" }, { status: 409 })
    }
    throw error
  }

  // Alış irsaliyesi stok girişi: "Teslim alındı" (DELIVERED) olunca kalemler BİR KEZ
  // stoğa girer; bu durumdan çıkınca geri alınır. reference = "waybill:<id>". Böylece
  // faturaya bağlanınca fatura stoğu tekrar İŞLEMEZ (çift stok önlenir). Hizmet ürünleri
  // stok takibi yapmaz → atlanır. stockProcessed bayrağı idempotentliği garanti eder.
  const itemsChanged = Array.isArray(items)
  if (existing.type === "PURCHASE" && (status !== undefined || itemsChanged)) {
    const nowDelivered = waybill.status === "DELIVERED"
    const reference = `waybill:${existing.id}`
    try {
      if (nowDelivered && !existing.stockProcessed) {
        await prisma.$transaction(async (tx) => {
          await applyWaybillStock(tx, {
            companyId: existing.companyId,
            waybillId: existing.id,
            waybillNo: waybill.waybillNo,
            createdBy: user.id,
          })
          await tx.waybill.update({ where: { id: existing.id }, data: { stockProcessed: true } })
        })
        ;(waybill as { stockProcessed?: boolean }).stockProcessed = true
      } else if (nowDelivered && existing.stockProcessed && itemsChanged) {
        // Kalemler değişti ve mal zaten stoğa girmişti: eski girişi geri al, yeni
        // kalemlerle tekrar işle. Geri alma aynı reference'a yazıldığı için net 0'a
        // düşer, sonraki giriş temiz başlar (bkz. revertStockByReference).
        await prisma.$transaction(async (tx) => {
          await revertStockByReference(tx, {
            companyId: existing.companyId,
            reference,
            description: `${waybill.waybillNo} - İrsaliye düzenlendi (eski giriş geri alındı)`,
            createdBy: user.id,
          })
          await applyWaybillStock(tx, {
            companyId: existing.companyId,
            waybillId: existing.id,
            waybillNo: waybill.waybillNo,
            createdBy: user.id,
          })
        })
      } else if (!nowDelivered && existing.stockProcessed) {
        await prisma.$transaction(async (tx) => {
          await revertStockByReference(tx, {
            companyId: existing.companyId,
            reference,
            description: `${waybill.waybillNo} - İrsaliye stok geri alındı`,
            createdBy: user.id,
          })
          await tx.waybill.update({ where: { id: existing.id }, data: { stockProcessed: false } })
        })
        ;(waybill as { stockProcessed?: boolean }).stockProcessed = false
      }
    } catch (stockErr) {
      // Kapı reddi (modül/sayfa/rol) 403 döner; buradaki diğer dallar veri hatası içindir.
      if (isAccessDeniedError(stockErr)) return accessDeniedResponse(stockErr)
      console.error("[İrsaliye stok işleme hatası]", stockErr)
    }
  }

  // FATURA EŞLEŞTİRME sonrası çift stok temizliği: mal irsaliyeyle stoğa girdiyse ve
  // sonradan bağlanan fatura kendi girişini yapmışsa (fatura irsaliyeden önce/bağsız
  // kesilmiş demektir) fatura hareketleri geri alınır — stok sahibi irsaliyedir.
  // Fatura kesilirken irsaliye zaten bağlıysa hareket hiç oluşmaz, geri alma no-op olur.
  let invoiceStockReverted = false
  if (linkedInvoice && existing.type === "PURCHASE" && waybill.stockProcessed) {
    try {
      const had = await prisma.stockMovement.count({
        where: { companyId: existing.companyId, reference: linkedInvoice.id },
      })
      if (had > 0) {
        await prisma.$transaction(async (tx) => {
          await revertStockByReference(tx, {
            companyId: existing.companyId,
            reference: linkedInvoice!.id,
            description: `${linkedInvoice!.invoiceNo} - İrsaliye ile eşleştirildi (fatura stok girişi geri alındı)`,
            createdBy: user.id,
          })
        })
        invoiceStockReverted = true
      }
    } catch (stockErr) {
      // Kapı reddi (modül/sayfa/rol) 403 döner; buradaki diğer dallar veri hatası içindir.
      if (isAccessDeniedError(stockErr)) return accessDeniedResponse(stockErr)
      console.error("[İrsaliye-fatura eşleştirme stok hatası]", stockErr)
    }
  }

  return NextResponse.json({ ...waybill, invoiceStockReverted })
})

export const DELETE = withApiErrors(async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const existing = await prisma.waybill.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "Waybill not found" }, { status: 404 })
  await ensureCompanyWrite(existing.companyId)

  await prisma.waybill.delete({ where: { id } })
  return NextResponse.json({ message: "Waybill deleted" })
})
