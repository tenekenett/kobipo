import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { resolveSlugId } from "@/lib/slug-resolve"
import { revertInvoiceStock } from "@/lib/stock/warehouse"
import { accessDeniedResponse } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Fiş iptali. Fiş GİB'e gitmediği için sağlayıcıya (Mysoft) çağrı YOK — iptal
 * tamamen yereldir. Bu yüzden e-Arşiv iptal ucu (e-donusum/invoices/[id]/cancel)
 * kullanılamaz: o uç GİB'e gönderilmiş + e-Arşiv + 24 saat kuralına bağlıdır.
 *
 * Geri alınanlar:
 *  - Stok: revertInvoiceStock (reference bazlı; ters hareket aynı reference ile
 *    yazıldığından ikinci çağrıda net 0 çıkar → idempotent).
 *  - Ödeme + kasa: fiş ödemeleri silinir ve FinancialAccount.balance geri alınır.
 *    Fatura iptalinden (cancel/route.ts) farkı budur ve bilinçlidir: orada "bakiye
 *    sorguları CANCELLED'ı hariç tutuyor" denip ödemeye dokunulmuyor, ama balance
 *    SORGU DEĞİL, saklanan alandır (odemeler/route.ts ödeme anında +/- yazar).
 *    Fişler hızlı satışın nakit akışıyla doğrudan bağlı olduğundan, geri alınmazsa
 *    iptal edilen fişin parası kasada kalır.
 *  - Cari bakiye: ayrıca bir şey gerekmez; sorgular CANCELLED'ı zaten hariç tutar.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const companyId = await resolveCompanyId(body?.companyId)
    if (!companyId) return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })

    await ensureCompanyWrite(companyId)

    const { id: param } = await params
    const id = await resolveSlugId("invoice", param, companyId)

    const receipt = await prisma.invoice.findFirst({
      where: { id, companyId, isReceipt: true },
      select: {
        id: true,
        invoiceNo: true,
        status: true,
        type: true,
        payments: { select: { id: true, amount: true, accountId: true, transactionId: true } },
      },
    })

    if (!receipt) return NextResponse.json({ error: "Fiş bulunamadı" }, { status: 404 })

    if (receipt.status === "CANCELLED") {
      return NextResponse.json({ error: "Fiş zaten iptal edilmiş" }, { status: 400 })
    }
    if (receipt.status === "CONVERTED") {
      return NextResponse.json(
        {
          error:
            "Bu fiş resmî faturaya dönüştürülmüş. Önce faturayı iptal edin; fişin etkisi artık faturada.",
        },
        { status: 400 },
      )
    }

    // Cari ekranından girilen tahsilat/ödeme (transactionId dolu) kasaya Transaction
    // üzerinden yansır. Burada silersek Transaction ortada kalır ve kasa iki kez
    // düzeltilir; bu yüzden kullanıcıyı önce o kaydı kaldırmaya yönlendiriyoruz.
    const linked = receipt.payments.filter((p) => p.transactionId)
    if (linked.length > 0) {
      return NextResponse.json(
        {
          error:
            "Bu fişe cari ekranından bağlanmış tahsilat/ödeme var. Önce Finans > Hareketler'den o kaydı silin, sonra fişi iptal edin.",
        },
        { status: 400 },
      )
    }

    await prisma.$transaction(async (tx) => {
      await revertInvoiceStock(tx, {
        companyId,
        invoiceId: receipt.id,
        invoiceNo: receipt.invoiceNo,
        createdBy: user.id,
      })

      // Kasa etkisini geri al: ödeme anında satışta +tutar, alışta -tutar yazılmıştı.
      for (const p of receipt.payments) {
        if (!p.accountId) continue
        const delta = receipt.type === "SALES" ? -Number(p.amount) : Number(p.amount)
        await tx.financialAccount.update({
          where: { id: p.accountId },
          data: { balance: { increment: new Prisma.Decimal(delta) } },
        })
      }

      if (receipt.payments.length > 0) {
        await tx.invoicePayment.deleteMany({ where: { invoiceId: receipt.id } })
      }

      await tx.invoice.update({
        where: { id: receipt.id },
        data: { status: "CANCELLED" },
      })
    })

    return NextResponse.json({
      success: true,
      message: "Fiş iptal edildi; stok ve kasa etkisi geri alındı.",
    })
  } catch (error: any) {
    if (error?.message?.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error cancelling receipt:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
