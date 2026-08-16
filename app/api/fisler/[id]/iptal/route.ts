import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { resolveSlugId } from "@/lib/slug-resolve"
import { revertInvoiceStock } from "@/lib/stock/warehouse"
import { accessDeniedResponse } from "@/lib/api/errors"
import { revalidateDashboard } from "@/lib/dashboard/cache"

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

    // Tahsilatın kasa hareketi (`Transaction`) İKİ farklı yoldan doğabilir ve
    // ikisi aynı şey DEĞİLDİR:
    //
    //  a) Fişin kendi tahsilatı (odemeler POST) — hareket bu fiş için yazıldı,
    //     tutarının tamamı bu fişe ait. Fişle birlikte silinir.
    //  b) Cari ekranından girilen tahsilat — tek hareket birden çok faturaya
    //     dağıtılmış ya da fazlası avans olarak işlemde kalmış olabilir. Onu
    //     buradan silmek fişle ilgisi olmayan parayı da yok ederdi; kullanıcı
    //     Finans > Hareketler'e yönlendirilir (eski davranış).
    //
    // Ayrım tutardan okunur: hareketin TÜM dağıtımı bu fişteyse ve toplamı
    // hareketin tutarına eşitse, o hareket bu fişin kendi hareketidir.
    const linkedIds = [
      ...new Set(receipt.payments.map((p) => p.transactionId).filter(Boolean) as string[]),
    ]
    const ownTransactionIds: string[] = []
    if (linkedIds.length > 0) {
      const linkedTx = await prisma.transaction.findMany({
        where: { id: { in: linkedIds }, companyId },
        select: {
          id: true,
          amount: true,
          invoicePayments: { select: { amount: true, invoiceId: true } },
        },
      })
      for (const tx of linkedTx) {
        const allocated = tx.invoicePayments.reduce(
          (sum, p) => sum.plus(p.amount),
          new Prisma.Decimal(0),
        )
        const onlyThisReceipt = tx.invoicePayments.every((p) => p.invoiceId === receipt.id)
        if (onlyThisReceipt && allocated.equals(new Prisma.Decimal(tx.amount))) {
          ownTransactionIds.push(tx.id)
        }
      }
      if (ownTransactionIds.length < linkedIds.length) {
        return NextResponse.json(
          {
            error:
              "Bu fişe cari ekranından bağlanmış tahsilat/ödeme var. Önce Finans > Hareketler'den o kaydı silin, sonra fişi iptal edin.",
          },
          { status: 400 },
        )
      }
    }

    await prisma.$transaction(async (tx) => {
      await revertInvoiceStock(tx, {
        companyId,
        invoiceId: receipt.id,
        invoiceNo: receipt.invoiceNo,
        createdBy: user.id,
      })

      // Kasa etkisini geri al: ödeme anında satışta +tutar, alışta -tutar yazılmıştı.
      // Bakiye BİR KEZ düzeltilir — ödemeyle hareketi aynı anda yazan uç da tek
      // kez artırmıştı, hareketin silinmesi ayrıca bakiye düşürmez.
      for (const p of receipt.payments) {
        if (!p.accountId) continue
        const delta = receipt.type === "SALES" ? -Number(p.amount) : Number(p.amount)
        await tx.financialAccount.update({
          where: { id: p.accountId },
          data: { balance: { increment: new Prisma.Decimal(delta) } },
        })
      }

      // Fişin kendi kasa hareketleri de gider; bağlı ödemeler CASCADE ile
      // birlikte silinir (aşağıdaki deleteMany kalanları temizler).
      if (ownTransactionIds.length > 0) {
        await tx.transaction.deleteMany({ where: { id: { in: ownTransactionIds } } })
      }

      if (receipt.payments.length > 0) {
        await tx.invoicePayment.deleteMany({ where: { invoiceId: receipt.id } })
      }

      await tx.invoice.update({
        where: { id: receipt.id },
        data: { status: "CANCELLED" },
      })
    })

    revalidateDashboard(companyId)

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
