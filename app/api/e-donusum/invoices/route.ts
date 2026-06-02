import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { createEInvoiceProvider } from "@/lib/integrations/e-invoice/factory"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import { generateInvoiceNumber } from "@/lib/utils/invoice-number"
import { ensureUsageLimit } from "@/lib/middleware/usage"
import { decryptSecret } from "@/lib/crypto/secrets"


export const dynamic = 'force-dynamic'

function isMeaningfulInvoiceItem(item: any) {
  if (!item || typeof item !== "object") return false
  const hasProduct = typeof item.productId === "string" && item.productId.trim() !== ""
  const quantity = parseFloat(item.quantity) || 0
  const unitPrice = parseFloat(item.unitPrice) || 0
  const hasDescription = typeof item.description === "string" && item.description.trim() !== ""
  return hasProduct || quantity > 0 || unitPrice > 0 || hasDescription
}

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const companyId = searchParams.get("companyId")
    const type = searchParams.get("type")
    const status = searchParams.get("status")

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId is required" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)
const company = await prisma.company.findUnique({
  where: { id: companyId },
  select: { 
    isEDonusumEnabled: true,
    name: true,         
    taxNumber: true,    
    taxOffice: true,    
    address: true,      
    city: true,         
    eDonusumIntegrator: true,
    eDonusumProvider: true,
    eDonusumApiUsername: true,
    eDonusumApiPassword: true,
    eDonusumApiUrl: true,
    invoiceSeriesPrefix: true
    
  },
})
    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 })
    }

    const where: any = {
      companyId,
    }

    if (type) {
      where.type = type
    }

    if (status) {
      where.status = status
    }

    const invoices = await prisma.invoice.findMany({
      where,
      include: {
        customer: true,
        supplier: true,
        items: {
          include: {
            product: true,
          },
        },
        payments: {
          select: {
            amount: true,
          },
        },
      },
      orderBy: { date: "desc" },
    })

    return NextResponse.json(invoices)
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error fetching invoices:", error)
    return NextResponse.json(
      { error: message || "Internal server error" },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const {
      companyId,
      invoiceNo,
      type,
      invoiceType,
      customerId,
      supplierId,
      date,
      dueDate,
      currency,
      exchangeRate,
      exchangeRateDate,
      items,
      notes,
      sendInvoice,
      fromIncomingUuid,
    } = body

    if (!companyId || !type || !invoiceType || !items || items.length === 0) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    await ensureCompanyAccess(companyId)

const company = await prisma.company.findUnique({
  where: { id: companyId },
  select: { 
    isEDonusumEnabled: true,
    eDonusumIntegrator: true, 
    eDonusumProvider: true,   
    eDonusumApiUsername: true, 
    eDonusumApiPassword: true, 
    eDonusumApiUrl: true,
    eDonusumTenantVkn: true,
    invoiceSeriesPrefix: true,
    eFaturaPrefix: true,
    eArchivePrefix: true,
    name: true,
    taxNumber: true,
    taxOffice: true,
    address: true,
    city: true,
  },
})
    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 })
    }

    if (!company.isEDonusumEnabled && (invoiceType === "E_INVOICE" || invoiceType === "E_ARCHIVE")) {
      return NextResponse.json(
        { error: "Bu firmada e-fatura ozelligi kapali" },
        { status: 400 }
      )
    }

    if (type !== "SALES" && type !== "PURCHASE" && type !== "RETURN") {
      return NextResponse.json(
        { error: "Geçersiz fatura tipi" },
        { status: 400 }
      )
    }

    let finalInvoiceNo = invoiceNo
    if (!finalInvoiceNo) {
      finalInvoiceNo = await generateInvoiceNumber(
        companyId,
        type as "SALES" | "PURCHASE" | "RETURN",
        date ? new Date(date) : undefined
      )
    }

    const normalizedItems = (items as any[])
      .filter((item) => isMeaningfulInvoiceItem(item))
      .map((item) => ({
        productId: item.productId || null,
        description: typeof item.description === "string" ? String(item.description).trim() : "",
        unit: typeof item.unit === "string" && item.unit.trim() ? String(item.unit).trim().toUpperCase() : "ADET",
        quantity: parseFloat(item.quantity) || 0,
        unitPrice: parseFloat(item.unitPrice) || 0,
        // Alış faturasında ürünün satış fiyatını güncellemek için (opsiyonel).
        salePrice:
          item.salePrice != null && item.salePrice !== "" && !Number.isNaN(parseFloat(item.salePrice))
            ? parseFloat(item.salePrice)
            : null,
        discountRate: parseFloat(item.discountRate) || 0,
        vatRate: parseFloat(item.vatRate) || 0,
        withholdingRate: parseFloat(item.withholdingRate) || 0,
        exciseRate: parseFloat(item.exciseRate) || 0,
        taxExemptionReasonCode:
          typeof item.taxExemptionReasonCode === "string" && item.taxExemptionReasonCode.trim()
            ? item.taxExemptionReasonCode.trim()
            : null,
        taxExemptionReason:
          typeof item.taxExemptionReason === "string" && item.taxExemptionReason.trim()
            ? item.taxExemptionReason.trim()
            : null,
      }))

    if (normalizedItems.length === 0) {
      return NextResponse.json(
        { error: "En az bir anlamlı fatura kalemi gerekli" },
        { status: 400 }
      )
    }

    // Calculate totals
    let netAmount = 0
    let vatAmount = 0
    let totalAmount = 0

    normalizedItems.forEach((item) => {
      const itemGross = item.quantity * item.unitPrice
      const itemDiscount = itemGross * (item.discountRate / 100)
      const itemNet = itemGross - itemDiscount
      const itemVat = itemNet * (item.vatRate / 100)
      const itemWithholding = itemNet * (item.withholdingRate / 100)
      const itemExcise = itemNet * (item.exciseRate / 100)
      const itemTotal = itemNet + itemVat + itemExcise - itemWithholding

      netAmount += itemNet
      vatAmount += itemVat
      totalAmount += itemTotal
    })

    try {
      await ensureUsageLimit(companyId, "invoices_monthly", 1)
    } catch (limitErr: any) {
      return NextResponse.json(
        { error: limitErr?.message || "Aylik fatura limiti asildi" },
        { status: 429 }
      )
    }

    const invoice = await prisma.invoice.create({
      data: {
        companyId,
        invoiceNo: finalInvoiceNo,
        type,
        invoiceType,
        customerId: customerId || null,
        supplierId: supplierId || null,
        date: new Date(date),
        dueDate: dueDate ? new Date(dueDate) : null,
        currency: currency || "TRY",
        exchangeRate: exchangeRate ? Number(exchangeRate) : null,
        exchangeRateDate: exchangeRateDate ? new Date(exchangeRateDate) : null,
        totalAmount,
        vatAmount,
        netAmount,
        notes,
        status: "DRAFT",
        createdBy: user.id,
        items: {
          create: normalizedItems.map((item, index: number) => ({
            ...(item.productId ? { product: { connect: { id: item.productId } } } : {}),
            description: item.description,
            unit: item.unit,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discountRate: item.discountRate || null,
            discountAmount: item.quantity * item.unitPrice * (item.discountRate / 100),
            vatRate: item.vatRate,
            vatAmount: (item.quantity * item.unitPrice - item.quantity * item.unitPrice * (item.discountRate / 100)) * (item.vatRate / 100),
            withholdingRate: item.withholdingRate || null,
            withholdingAmount: (item.quantity * item.unitPrice - item.quantity * item.unitPrice * (item.discountRate / 100)) * (item.withholdingRate / 100),
            exciseRate: item.exciseRate || null,
            exciseAmount: (item.quantity * item.unitPrice - item.quantity * item.unitPrice * (item.discountRate / 100)) * (item.exciseRate / 100),
            totalAmount:
              (item.quantity * item.unitPrice - item.quantity * item.unitPrice * (item.discountRate / 100)) *
              (1 + item.vatRate / 100 + item.exciseRate / 100 - item.withholdingRate / 100),
            taxExemptionReasonCode: item.taxExemptionReasonCode,
            taxExemptionReason: item.taxExemptionReason,
            order: index,
          })),
        },
      },
      include: {
        customer: true,
        supplier: true,
        items: true,
      },
    })

    // Stok hareketi: Satış, Satın alma, İade işlemlerinde stok güncelle
    for (const item of invoice.items) {
      // 1. Ürün ID'sini garantiye al
      const safeProductId = item.productId || (item as any).product?.id || null;
      if (!safeProductId) {
        console.warn(`[Stok Uyarı] Ürün ID bulunamadı. Fatura Kalemi Atlandı: ${item.description}`);
        continue; 
      }

      // 2. Fatura Tipini büyük harfe zorla ve boşlukları temizle
      const safeType = String(type || "").trim().toUpperCase();

      let stockQuantityChange = 0;
      let moveType = "UNKNOWN";

      // Schema: stockMovement.type ∈ { IN, OUT, TRANSFER, ADJUSTMENT }.
      // Rapor ve detay endpoint'leri "IN" / "OUT" üzerinden filtreliyor — eski kodda
      // PURCHASE/SALE yazılıyordu, bu yüzden hareketler stok detayında gözükmüyordu.
      // stockQuantityChange tarafı zaten signed; product.stockQuantity doğru güncellenir.
      if (safeType === "SALES") {
        stockQuantityChange = -Number(item.quantity);
        moveType = "OUT";
      } else if (safeType === "PURCHASE") {
        stockQuantityChange = Number(item.quantity);
        moveType = "IN";
      } else if (safeType === "RETURN") {
        stockQuantityChange = Number(item.quantity);
        moveType = "IN";
      }

      if (stockQuantityChange !== 0) {
        try {
          // Stok hareketi oluştur
          await prisma.stockMovement.create({
            data: {
              companyId,
              productId: safeProductId,
              type: moveType,
              quantity: stockQuantityChange,
              unitPrice: item.unitPrice ?? null,
              description: `${invoice.invoiceNo} - ${safeType === "SALES" ? "Satış" : safeType === "PURCHASE" ? "Satın alma" : "İade"} faturası`,
              reference: invoice.id,
              //referenceType: "INVOICE",
              createdBy: user.id,
            },
          });

          // Ürünün stok miktarını güncelle
          await prisma.product.update({
            where: { id: safeProductId },
            data: {
              stockQuantity: {
                increment: stockQuantityChange,
              },
            },
          });
          
          console.log(`[Stok Başarılı] ${safeProductId} ID'li ürünün stoğu ${stockQuantityChange} kadar güncellendi.`);
        } catch (stockError) {
          console.error("[Stok Hata] Stok işlemi sırasında veritabanı hatası oluştu: ", stockError);
        }
      }
    }

    // Alış faturası: kullanıcı satır üzerinde yeni bir satış fiyatı girdiyse
    // ilgili ürünün kartındaki satış fiyatını güncelle.
    if (String(type || "").trim().toUpperCase() === "PURCHASE") {
      for (const item of normalizedItems) {
        if (item.productId && item.salePrice != null && item.salePrice > 0) {
          try {
            await prisma.product.update({
              where: { id: item.productId },
              data: { salePrice: item.salePrice },
            });
          } catch (priceError) {
            console.error("[Satış Fiyatı Güncelleme Hatası] ", priceError);
          }
        }
      }
    }

    // Gelen e-faturadan dönüştürme: IncomingInvoice'ı yeni fatura ile bağla
    // ve faturayı doğrudan onaylanmış (SENT) statüsünde kaydet. Gelen fatura
    // zaten resmi olarak GİB'den geldiği için Kobipo tarafında ek bir onay
    // adımına gerek yok; kullanıcı kaydet butonuna basınca işlem tamamlanır.
    if (fromIncomingUuid && type === "PURCHASE") {
      try {
        await prisma.incomingInvoice.update({
          where: { companyId_uuid: { companyId, uuid: String(fromIncomingUuid) } },
          data: { isLinkedToPurchase: true, linkedInvoiceId: invoice.id },
        })
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { status: "SENT" },
        })
      } catch (linkErr) {
        console.error("[IncomingInvoice link/auto-approve hatası]", linkErr)
      }
    }

    // Otomatik muhasebe fişi: Satış faturaları için temel kayıt.
    if (type === "SALES") {
      const companyPlans = await prisma.accountPlan.findMany({
        where: { companyId, code: { in: ["120", "600", "391"] } },
        select: { id: true, code: true },
      })
      const plan120 = companyPlans.find((plan) => plan.code === "120")
      const plan600 = companyPlans.find((plan) => plan.code === "600")
      const plan391 = companyPlans.find((plan) => plan.code === "391")

      if (plan120 && plan600 && Number(netAmount) > 0) {
        const lastEntry = await prisma.accountingEntry.findFirst({
          where: { companyId },
          orderBy: { createdAt: "desc" },
          select: { entryNo: true },
        })
        const nextNo = (Number(lastEntry?.entryNo || 0) + 1).toString().padStart(6, "0")

        await prisma.accountingEntry.create({
          data: {
            companyId,
            entryNo: nextNo,
            date: new Date(date),
            description: `${invoice.invoiceNo} satış faturası otomatik fişi`,
            debitAccountId: plan120.id,
            creditAccountId: plan600.id,
            amount: Number(netAmount),
            reference: invoice.id,
            referenceType: "INVOICE_AUTO",
            createdBy: user.id,
          },
        })

        if (plan391 && Number(vatAmount) > 0) {
          const vatNo = (Number(nextNo) + 1).toString().padStart(6, "0")
          await prisma.accountingEntry.create({
            data: {
              companyId,
              entryNo: vatNo,
              date: new Date(date),
              description: `${invoice.invoiceNo} KDV otomatik fişi`,
              debitAccountId: plan120.id,
              creditAccountId: plan391.id,
              amount: Number(vatAmount),
              reference: invoice.id,
              referenceType: "INVOICE_AUTO_VAT",
              createdBy: user.id,
            },
          })
        }
      }
    }

    // Send invoice if requested
    if (
      company.isEDonusumEnabled &&
      sendInvoice &&
      type === "SALES" &&
      (invoiceType === "E_INVOICE" || invoiceType === "E_ARCHIVE")
    ) {
      try {
        assertEInvoiceRuntimeReady()
        
        // Şifreyi çöz
        const plainPassword = company.eDonusumApiPassword ? decryptSecret(company.eDonusumApiPassword) : "";
        
        const tenantVkn = (company.eDonusumTenantVkn || "").replace(/\D/g, "")
        const provider = createEInvoiceProvider({
           providerName: "mysoft",
           username: company.eDonusumApiUsername || "",
           passwordText: plainPassword,
           apiUrl: company.eDonusumApiUrl || undefined,
           vknTckn: tenantVkn || undefined,
        })

// Belge tipine göre prefix seç:
// E_INVOICE → eFaturaPrefix, E_ARCHIVE → eArchivePrefix
// invoiceSeriesPrefix Kobipo iç fatura numarası içindir (SAT-2026-XXXX),
// Mysoft numaratörü DEĞİL — buraya KARIŞTIRMA. Kullanıcı seçmediyse undefined geç:
// provider Mysoft'tan aktif default numaratörü otomatik seçecek.
const resolvedPrefix: string | undefined =
  invoiceType === "E_INVOICE"
    ? company.eFaturaPrefix || undefined
    : company.eArchivePrefix || undefined

const invoiceData = {
  // Mysoft'a belge tipini açıkça gönder (EFATURA vs EARSIVFATURA seçimi için)
  invoiceType,
  prefix: resolvedPrefix,
  tenantIdentifierNumber: tenantVkn || undefined,
  // connectorGuid/pkAlias/gbAlias — Mysoft tenantIdentifierNumber'dan kendi
  // seçer. Sample payload'dan gelen random/generic değerleri göndermiyoruz.
  invoiceNo: invoice.invoiceNo,
  date: invoice.date,
  dueDate: invoice.dueDate || undefined,
  // GÖNDEREN (Sistemi Kullanan Firma)
  sender: {
    name: company.name,
    taxNumber: company.taxNumber,
    taxOffice: company.taxOffice,
    address: company.address,
    city: company.city,
  },
  
  // MÜŞTERİ (Faturanın Kesildiği Kişi/Firma)
  customer: invoice.customer
    ? {
        name: invoice.customer.name,
        taxNumber: invoice.customer.taxNumber || undefined,
        taxOffice: invoice.customer.taxOffice || undefined,
        address: invoice.customer.address || undefined,
        city: invoice.customer.city || undefined,
        country: invoice.customer.country || undefined,
      }
    : undefined,
    
  // TEDARİKÇİ (Alış Faturasıysa)
  supplier: invoice.supplier
    ? {
        name: invoice.supplier.name,
        taxNumber: invoice.supplier.taxNumber || undefined,
        taxOffice: invoice.supplier.taxOffice || undefined,
        address: invoice.supplier.address || undefined,
        city: invoice.supplier.city || undefined,
        country: invoice.supplier.country || undefined,
      }
    : undefined,
    
  // FATURA KALEMLERİ (Ürünler)
  items: invoice.items.map((item) => ({
    description: item.description,
    quantity: Number(item.quantity),
    unitPrice: Number(item.unitPrice),
    vatRate: Number(item.vatRate),
    productId: item.productId || undefined,
    taxExemptionReasonCode: item.taxExemptionReasonCode || undefined,
    taxExemptionReason: item.taxExemptionReason || undefined,
  })),
  
  notes: invoice.notes || undefined,
};

        const response = await provider.sendInvoice(invoiceData)

        if (response.success && response.uuid) {
          await prisma.invoice.update({
            where: { id: invoice.id },
            data: {
              uuid: response.uuid,
              status: "SENT",
              integrationId: provider.name,
              integrationStatus: "SENT",
            },
          })

          return NextResponse.json({
            ...invoice,
            uuid: response.uuid,
            status: "SENT",
          })
        }
        if (!response.success) {
          const rawError: string = response.error || "UNKNOWN"
          const lower = rawError.toLowerCase()
          const isNumeratorError =
            lower.includes("numaratör") ||
            lower.includes("numarator") ||
            lower.includes("aktif numaratör tanımlı değil")
          const isPkNotFoundError =
            lower.includes("fatura pk") ||
            lower.includes("pk bilgisi bulunamadı")
          let friendlyError: string
          if (isNumeratorError) {
            // E-Fatura için "uygun numaratör bulunamadı" mesajı yanıltıcı: alıcının
            // GİB'de e-Fatura mükellefi olmaması da bu hatayı tetikliyor.
            if (invoiceType === "E_INVOICE") {
              friendlyError = resolvedPrefix
                ? `${rawError} → İki olası sebep: (1) "${resolvedPrefix}" prefix'i Mysoft panelinde E-Fatura için tanımlı/aktif değil. (2) Müşterinin VKN'si GİB'de kayıtlı bir e-Fatura mükellefi değil — bu durumda fatura E-Arşiv olarak kesilmeli.`
                : `${rawError} → (1) Mysoft'ta E-Fatura numaratörü yok, veya (2) müşteri GİB'de e-Fatura mükellefi değil → E-Arşiv olarak kesin.`
            } else {
              friendlyError = resolvedPrefix
                ? `${rawError} → "${resolvedPrefix}" prefix'i Mysoft panelinde tanımlı/aktif değil. Seri No Tanımları sayfasından doğru prefix'i seçin veya yeni numaratör ekleyin.`
                : `${rawError} Seri No Tanımları sayfasından bu belge tipi için aktif bir numaratör ekleyin.`
            }
          } else if (isPkNotFoundError) {
            friendlyError =
              invoiceType === "E_INVOICE"
                ? `${rawError} → Müşteri GİB'de kayıtlı bir e-Fatura mükellefi değil. Müşteri VKN/TCKN'sini kontrol edin; mükellef değilse E-Arşiv olarak gönderin.`
                : `${rawError} → Müşterinin VKN/TCKN bilgisini Müşteri Kartı'ndan kontrol edin.`
          } else {
            friendlyError = rawError
          }
          await prisma.invoice.update({
            where: { id: invoice.id },
            data: { integrationStatus: `ERROR:${friendlyError}` },
          })
        }
      } catch (error) {
        console.error("Error sending invoice:", error)
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { integrationStatus: `ERROR:${(error as Error).message}` },
        })
        // Continue with invoice creation even if sending fails
      }
    }

    return NextResponse.json(invoice, { status: 201 })
  } catch (error: any) {
    if (error.message.includes("Access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("Error creating invoice:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
}

