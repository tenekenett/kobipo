import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyExport } from "@/lib/middleware/company"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"
import { cekSenetStatusLabel, resolveCekSenetDirection } from "@/lib/cek-senet/labels"
import { renderMakbuzPdf } from "@/lib/pdf/documents/makbuz-document"

export const dynamic = "force-dynamic"

/**
 * Çek / senet tahsilat-ödeme makbuzu (PDF).
 *
 * Çek veya senetle yapılan tahsilat `Transaction` YAZMAZ (para henüz bir kasa/banka
 * kanalına girmemiştir, elde kıymetli evrak vardır) — bu yüzden kasa/banka makbuzu
 * ucu (`/api/finans/transactions/[id]/makbuz`) bu kayıtlara ulaşamıyordu ve çekle
 * tahsilat yapan kullanıcı müşterisine makbuz veremiyordu. Belge düzeni aynı
 * (`makbuz-document.ts`), yalnızca hesap satırı yerine evrak künyesi basılır.
 */
const fmtDate = (value: Date) => new Date(value).toLocaleDateString("tr-TR")

export const GET = withApiErrors(async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const { searchParams } = new URL(request.url)
    const type = searchParams.get("type")

    if (type !== "CHECK" && type !== "PROMISSORY_NOTE") {
      return NextResponse.json({ error: "type must be CHECK or PROMISSORY_NOTE" }, { status: 400 })
    }

    const include = {
      customer: { select: { name: true, taxNumber: true } },
      supplier: { select: { name: true, taxNumber: true } },
      company: {
        select: { name: true, taxNumber: true, taxOffice: true, address: true, city: true, phone: true },
      },
    } as const

    const record =
      type === "CHECK"
        ? await prisma.check.findUnique({ where: { id }, include })
        : await prisma.promissoryNote.findUnique({ where: { id }, include })

    if (!record) {
      return NextResponse.json(
        { error: type === "CHECK" ? "Çek bulunamadı" : "Senet bulunamadı" },
        { status: 404 },
      )
    }

    await ensureCompanyExport(record.companyId)

    const instrument = type === "CHECK" ? "Çek" : "Senet"
    // Alınan evrak tahsilattır, verilen evrak ödemedir. Cariden bağımsız tek eksen
    // `direction`; eski (null) kayıtlar için ekranla aynı düşüş kuralı uygulanır.
    const isReceived = resolveCekSenetDirection(record) === "RECEIVED"
    const kind = isReceived ? "Tahsilat" : "Ödeme"
    // `type` union'ı daraltmaz; ayrım evrakın kendi alanından yapılır.
    const evrakNo = "checkNo" in record ? record.checkNo : record.noteNo

    const extraRows: Array<{ label: string; value: string }> = [
      { label: `${instrument} No`, value: evrakNo },
    ]
    if ("checkNo" in record) {
      extraRows.push({ label: "Banka", value: record.bankName })
      if (record.branchName) extraRows.push({ label: "Şube", value: record.branchName })
      if (record.accountNo) extraRows.push({ label: "Hesap No", value: record.accountNo })
    }
    extraRows.push(
      { label: "Düzenleme Tarihi", value: fmtDate(record.issueDate) },
      { label: "Vade Tarihi", value: fmtDate(record.dueDate) },
      { label: "Durum", value: cekSenetStatusLabel(record.status) },
    )

    // Faturaya bağlıysa makbuzda hangi faturayı kapattığı görünsün.
    const invoice = record.invoiceId
      ? await prisma.invoice.findUnique({
          where: { id: record.invoiceId },
          select: { invoiceNo: true, eDocumentNo: true },
        })
      : null

    const pdfBuffer = await renderMakbuzPdf({
      kind,
      instrument,
      makbuzNo: evrakNo,
      // Makbuz evrakın TESLİM ALINDIĞI günü belgeler; vade değil düzenleme tarihi.
      date: record.issueDate,
      amount: Number(record.amount),
      currency: "TRY",
      description: record.notes,
      paymentMethod: instrument,
      account: null,
      extraRows,
      company: record.company || {},
      cari: record.customer
        ? { label: "MÜŞTERİ", name: record.customer.name, taxNumber: record.customer.taxNumber }
        : record.supplier
          ? { label: "TEDARİKÇİ", name: record.supplier.name, taxNumber: record.supplier.taxNumber }
          : null,
      invoices: invoice
        ? [{ invoiceNo: invoice.eDocumentNo || invoice.invoiceNo, amount: Number(record.amount) }]
        : [],
    })

    // Dosya adında Türkçe karakter var (Çek/Ödeme); başlık ASCII olmak zorunda, bu
    // yüzden ASCII yedeği + RFC 6266 `filename*` birlikte gönderilir.
    const fileName = `${instrument}-${kind}-Makbuzu-${evrakNo}.pdf`
    const asciiName = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "")

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    })
  } catch (error: any) {
    if (typeof error?.message === "string" && error.message.includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error generating cek/senet makbuz PDF:", error)
    return NextResponse.json({ error: "Makbuz üretilemedi" }, { status: 500 })
  }
})
