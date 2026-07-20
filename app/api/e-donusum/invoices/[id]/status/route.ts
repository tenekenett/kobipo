import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { resolveCompanyEInvoiceProvider } from "@/lib/integrations/e-invoice/company-provider";
import { voidInvoice, evaluateGibVoid } from "@/lib/integrations/e-invoice/void-invoice";

// BURADAKİ params KISMINI DEĞİŞTİRDİK (Promise yaptık)
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // PARAMS'I AWAIT İLE ÇÖZDÜK
    const resolvedParams = await params;

    const invoice = await prisma.invoice.findUnique({
      where: { id: resolvedParams.id }, // BURASI ARTIK resolvedParams.id OLDU
      include: { company: { include: { parentCompany: { select: { taxNumber: true } } } } }
    });

    if (!invoice || !invoice.uuid) {
      return NextResponse.json({ error: "Fatura veya UUID bulunamadı" }, { status: 404 });
    }

    // Provider'ı çöz: firmanın kendi kimliği (manuel) yoksa bayi + firma VKN (Faz 4).
    const resolved = resolveCompanyEInvoiceProvider(invoice.company);
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }
    const provider = resolved.provider;

    // Durumu sorgula (TS kızmasın diye as any ekledik)
    const statusResult = await provider.getInvoiceStatus(invoice.uuid) as any;

    if (!statusResult.success) {
      return NextResponse.json({ error: statusResult.error }, { status: 400 });
    }

    // ÖNEMLİ: invoice.status'e ASLA ham entegratör statüsü ("REJECTED"/"APPROVED"/
    // "PROCESSING") yazma — cari/rapor sorguları status<>CANCELLED filtreler ve
    // "REJECTED" gibi bir değer faturayı bakiyeden DÜŞÜRMEZ. Bunun yerine
    // check-status ile aynı TEK karar noktasını (evaluateGibVoid) kullan: yalnızca
    // gerçek RED / IPTAL_EDILDI faturayı CANCELLED yapar (+ stok iade), böylece
    // reddedilen faturanın tutarı cari borç/alacaktan otomatik düşer.
    const { becomesVoid, integrationStatus } = evaluateGibVoid(statusResult);
    const shouldVoid = becomesVoid && invoice.status !== "CANCELLED";

    if (shouldVoid) {
      await prisma.$transaction(async (tx) => {
        await voidInvoice(tx, {
          invoiceId: invoice.id,
          companyId: invoice.companyId,
          invoiceNo: invoice.invoiceNo,
          integrationStatus,
          createdBy: user.id,
        });
      });
    } else {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { integrationStatus },
      });
    }

    return NextResponse.json(statusResult);
  } catch (error: any) {
    console.error("Status Check Error:", error);
    return NextResponse.json({ error: "Sunucu hatası" }, { status: 500 });
  }
}
