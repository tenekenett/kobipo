import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { getCurrentUser } from "@/lib/auth/session";
import { createEInvoiceProvider } from "@/lib/integrations/e-invoice/factory";
import { decryptSecret } from "@/lib/crypto/secrets";

// BURADAKİ params KISMINI DEĞİŞTİRDİK (Promise yaptık)
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // PARAMS'I AWAIT İLE ÇÖZDÜK
    const resolvedParams = await params;

    const invoice = await prisma.invoice.findUnique({
      where: { id: resolvedParams.id }, // BURASI ARTIK resolvedParams.id OLDU
      include: { company: true }
    });

    if (!invoice || !invoice.uuid) {
      return NextResponse.json({ error: "Fatura veya UUID bulunamadı" }, { status: 404 });
    }

    const company = invoice.company;
    if (!company.eDonusumApiPassword) {
      return NextResponse.json({ error: "E-Dönüşüm şifresi bulunamadı" }, { status: 400 });
    }

    // Şifreyi çöz ve Provider'ı hazırla
    const plainPassword = decryptSecret(company.eDonusumApiPassword);
    const provider = createEInvoiceProvider({
      providerName: "mysoft",
      username: company.eDonusumApiUsername || "",
      passwordText: plainPassword,
      apiUrl: company.eDonusumApiUrl || undefined
    });

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