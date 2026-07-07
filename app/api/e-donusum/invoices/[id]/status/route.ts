import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { resolveCompanyEInvoiceProvider } from "@/lib/integrations/e-invoice/company-provider";

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

    if (statusResult.success) {
      // Veritabanını yeni durum ile güncelle
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { 
          status: statusResult.status, // APPROVED, PROCESSING, FAILED
          integrationStatus: `${statusResult.rawCode}: ${statusResult.message}` 
        }
      });

      return NextResponse.json(statusResult);
    } else {
      return NextResponse.json({ error: statusResult.error }, { status: 400 });
    }

  } catch (error: any) {
    console.error("Status Check Error:", error);
    return NextResponse.json({ error: "Sunucu hatası" }, { status: 500 });
  }
}