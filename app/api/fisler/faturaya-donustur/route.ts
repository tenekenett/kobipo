import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { generateInvoiceNumber } from "@/lib/utils/invoice-number"

export const dynamic = "force-dynamic"

/**
 * Birden çok fişi TEK resmî faturaya dönüştürür.
 *
 * Kural: seçilen fişler aynı tip (hepsi satış ya da hepsi alış) ve AYNI cari
 * (müşteri/tedarikçi) olmalıdır. Fişler dönüşmeden önce ekonomik etkiyi zaten
 * işlemiştir (stok düşmüş, tahsilat kaydedilmiş); bu yüzden dönüştürme:
 *  - Konsolide bir Invoice (isReceipt=false, DRAFT) oluşturur, kalemleri kopyalar.
 *  - Stoğu TEKRAR işlemez (çift stok önleme).
 *  - Fişlerin ödemelerini yeni faturaya taşır (kasa etkilenmez, fatura ödenmiş görünür).
 *  - Fişleri status=CONVERTED + convertedInvoiceId ile işaretler (cari/raporlardan düşer).
 *  - Satış için otomatik muhasebe fişini yeni faturada oluşturur.
 */
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const companyId = await resolveCompanyId(body.companyId)
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })

    await ensureCompanyAccess(companyId)

    const receiptIds: string[] = Array.isArray(body.receiptIds)
      ? body.receiptIds.filter((x: any) => typeof x === "string" && x.trim())
      : []
    if (receiptIds.length === 0) {
      return NextResponse.json({ error: "En az bir fiş seçin" }, { status: 400 })
    }

    const receipts = await prisma.invoice.findMany({
      where: {
        id: { in: receiptIds },
        companyId,
        isReceipt: true,
        status: { notIn: ["CANCELLED", "CONVERTED"] },
      },
      include: { items: { orderBy: { order: "asc" } } },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    })

    if (receipts.length === 0) {
      return NextResponse.json({ error: "Dönüştürülebilir fiş bulunamadı" }, { status: 404 })
    }
    if (receipts.length !== receiptIds.length) {
      return NextResponse.json(
        { error: "Seçilen fişlerden bazıları dönüştürülemez (iptal/dönüştürülmüş olabilir)" },
        { status: 400 },
      )
    }

    // Tümü aynı tip olmalı.
    const type = receipts[0].type
    if (receipts.some((r) => r.type !== type)) {
      return NextResponse.json(
        { error: "Satış ve alış fişleri aynı faturada birleştirilemez" },
        { status: 400 },
      )
    }

    // Tümü aynı cari olmalı (ve cari seçili olmalı — resmî fatura carisiz kesilemez).
    const isSales = type === "SALES"
    const counterpartyId = isSales ? receipts[0].customerId : receipts[0].supplierId
    if (!counterpartyId) {
      return NextResponse.json(
        {
          error: isSales
            ? "Faturaya dönüştürmek için fişlerde müşteri seçili olmalı"
            : "Faturaya dönüştürmek için fişlerde tedarikçi seçili olmalı",
        },
        { status: 400 },
      )
    }
    const sameCari = receipts.every((r) => (isSales ? r.customerId : r.supplierId) === counterpartyId)
    if (!sameCari) {
      return NextResponse.json(
        { error: "Yalnızca aynı cariye ait fişler tek faturada birleştirilebilir" },
        { status: 400 },
      )
    }

    // Konsolide toplamlar (fişlerin sunucuda kayıtlı tutarlarının toplamı).
    const sum = (pick: (r: (typeof receipts)[number]) => any) =>
      receipts.reduce((s, r) => s + Number(pick(r) || 0), 0)
    const netAmount = sum((r) => r.netAmount)
    const vatAmount = sum((r) => r.vatAmount)
    const totalAmount = sum((r) => r.totalAmount)
    const globalDiscountAmount = sum((r) => r.globalDiscountAmount)

    const invoiceNo = await generateInvoiceNumber(
      companyId,
      type as "SALES" | "PURCHASE" | "RETURN",
      undefined,
      false,
    )

    // Konsolide kalemler: tüm fişlerin kalemlerini sırayla kopyala.
    let order = 0
    const items = receipts.flatMap((r) =>
      r.items.map((it) => ({
        ...(it.productId ? { product: { connect: { id: it.productId } } } : {}),
        description: it.description,
        unit: it.unit,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        discountRate: it.discountRate,
        discountAmount: it.discountAmount,
        vatRate: it.vatRate,
        vatAmount: it.vatAmount,
        withholdingCode: it.withholdingCode,
        withholdingName: it.withholdingName,
        withholdingRate: it.withholdingRate,
        withholdingAmount: it.withholdingAmount,
        exciseRate: it.exciseRate,
        exciseCode: it.exciseCode,
        exciseAmount: it.exciseAmount,
        otherTaxName: it.otherTaxName,
        otherTaxCode: it.otherTaxCode,
        otherTaxRate: it.otherTaxRate,
        otherTaxAmount: it.otherTaxAmount,
        totalAmount: it.totalAmount,
        taxExemptionReasonCode: it.taxExemptionReasonCode,
        taxExemptionReason: it.taxExemptionReason,
        order: order++,
      })),
    )

    const receiptNos = receipts.map((r) => r.invoiceNo).join(", ")

    const invoice = await prisma.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
          companyId,
          invoiceNo,
          type,
          invoiceType: "MANUAL",
          isReceipt: false,
          status: "DRAFT",
          customerId: isSales ? counterpartyId : null,
          supplierId: isSales ? null : counterpartyId,
          date: new Date(),
          currency: receipts[0].currency || "TRY",
          totalAmount,
          vatAmount,
          netAmount,
          globalDiscountAmount: globalDiscountAmount > 0 ? globalDiscountAmount : null,
          notes: `${receipts.length} fişten toplu dönüştürüldü: ${receiptNos}`,
          createdBy: user.id,
          items: { create: items },
        },
      })

      // Fiş ödemelerini yeni faturaya taşı (kasa değişmez; fatura ödenmiş görünür).
      await tx.invoicePayment.updateMany({
        where: { invoiceId: { in: receiptIds } },
        data: { invoiceId: created.id },
      })

      // Fişleri dönüştürülmüş olarak işaretle → cari ekstre/raporlardan düşer,
      // "Fişler" listesinden kalkar. Stok hareketleri fişlerde kalır (tek sefer).
      await tx.invoice.updateMany({
        where: { id: { in: receiptIds } },
        data: { status: "CONVERTED", convertedInvoiceId: created.id },
      })

      return created
    })

    // Otomatik muhasebe fişi: yalnızca satış faturasında (fişler oluşturmamıştı).
    if (isSales && netAmount > 0) {
      try {
        const plans = await prisma.accountPlan.findMany({
          where: { companyId, code: { in: ["120", "600", "391"] } },
          select: { id: true, code: true },
        })
        const plan120 = plans.find((p) => p.code === "120")
        const plan600 = plans.find((p) => p.code === "600")
        const plan391 = plans.find((p) => p.code === "391")
        if (plan120 && plan600) {
          const last = await prisma.accountingEntry.findFirst({
            where: { companyId },
            orderBy: { createdAt: "desc" },
            select: { entryNo: true },
          })
          const nextNo = (Number(last?.entryNo || 0) + 1).toString().padStart(6, "0")
          await prisma.accountingEntry.create({
            data: {
              companyId,
              entryNo: nextNo,
              date: new Date(),
              description: `${invoice.invoiceNo} satış faturası otomatik fişi (fişten dönüştürme)`,
              debitAccountId: plan120.id,
              creditAccountId: plan600.id,
              amount: netAmount,
              reference: invoice.id,
              referenceType: "INVOICE_AUTO",
              createdBy: user.id,
            },
          })
          if (plan391 && vatAmount > 0) {
            const vatNo = (Number(nextNo) + 1).toString().padStart(6, "0")
            await prisma.accountingEntry.create({
              data: {
                companyId,
                entryNo: vatNo,
                date: new Date(),
                description: `${invoice.invoiceNo} KDV otomatik fişi (fişten dönüştürme)`,
                debitAccountId: plan120.id,
                creditAccountId: plan391.id,
                amount: vatAmount,
                reference: invoice.id,
                referenceType: "INVOICE_AUTO_VAT",
                createdBy: user.id,
              },
            })
          }
        }
      } catch (e) {
        console.error("[Fiş dönüştürme] muhasebe fişi oluşturulamadı:", e)
      }
    }

    return NextResponse.json(
      { id: invoice.id, invoiceNo: invoice.invoiceNo, slug: invoice.slug, count: receipts.length },
      { status: 201 },
    )
  } catch (error: any) {
    if (error?.message?.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error converting receipts to invoice:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
