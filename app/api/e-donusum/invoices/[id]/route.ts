import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess, ensureCompanyWrite } from "@/lib/middleware/company"
import { createGibDraft } from "@/lib/integrations/e-invoice/send-invoice-helper"
import { revertInvoiceStock, ensureDefaultWarehouseId } from "@/lib/stock/warehouse"
import {
  prepareInvoiceStockOps,
  resolveInvoiceWarehouseId,
  revertInvoiceStockForEdit,
  sameStockLines,
  writeInvoiceStockOps,
} from "@/lib/stock/invoice-stock"
import { resolveSlugId } from "@/lib/slug-resolve"
import { Decimal } from "@prisma/client/runtime/library"
import { normalizeManualInvoiceNo } from "@/lib/utils/invoice-number"
import { revalidateDashboard } from "@/lib/dashboard/cache"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"
import {
  addLineTax,
  applyGlobalAdjustment,
  computeLineTax,
  emptyLineTaxSums,
  type LineTaxSums,
} from "@/lib/invoice/line-tax"


export const dynamic = 'force-dynamic'

function isMeaningfulInvoiceItem(item: any) {
  if (!item || typeof item !== "object") return false
  const hasProduct = typeof item.productId === "string" && item.productId.trim() !== ""
  const quantity = parseFloat(item.quantity) || 0
  const unitPrice = parseFloat(item.unitPrice) || 0
  const hasDescription = typeof item.description === "string" && item.description.trim() !== ""
  return hasProduct || quantity > 0 || unitPrice > 0 || hasDescription
}

function normalizeInvoiceItem(item: any) {
  return {
    productId: item.productId || null,
    description: typeof item.description === "string" ? String(item.description).trim() : "",
    // Satır açıklaması: mal/hizmet adının altına basılan serbest metin
    // (Mysoft invoiceDetail.note). description'dan AYRI tutulur.
    note: typeof item.note === "string" && item.note.trim() ? String(item.note).trim() : null,
    unit:
      typeof item.unit === "string" && item.unit.trim()
        ? String(item.unit).trim().toUpperCase()
        : "ADET",
    quantity: parseFloat(item.quantity) || 0,
    unitPrice: parseFloat(item.unitPrice) || 0,
    discountRate: parseFloat(item.discountRate) || 0,
    discountAmount: parseFloat(item.discountAmount) || 0,
    discountMode:
      typeof item.discountMode === "string" && item.discountMode.toUpperCase() === "AMOUNT"
        ? "AMOUNT"
        : "PERCENT",
    vatRate: parseFloat(item.vatRate) || 0,
    withholdingRate: parseFloat(item.withholdingRate) || 0,
    withholdingCode:
      typeof item.withholdingCode === "string" && item.withholdingCode.trim()
        ? item.withholdingCode.trim()
        : null,
    withholdingName:
      typeof item.withholdingName === "string" && item.withholdingName.trim()
        ? item.withholdingName.trim()
        : null,
    // GEKAP maktu: birim başına ₺ (oran değil), miktarla çarpılır, iskontodan
    // etkilenmez — bkz. lib/invoice/line-tax.ts.
    gekapUnitAmount: Math.max(0, parseFloat(item.gekapUnitAmount) || 0),
    exciseRate: parseFloat(item.exciseRate) || 0,
    // ÖTV GİB liste kodu (0071/0073/0074...). GİB payload'ında tax[].taxCode.
    exciseCode:
      typeof item.exciseCode === "string" && item.exciseCode.trim()
        ? item.exciseCode.trim()
        : null,
    // KDV dışı "Diğer Vergi" (ör. Konaklama Vergisi): matrahın üzerine eklenir.
    otherTaxRate: parseFloat(item.otherTaxRate) || 0,
    otherTaxName:
      typeof item.otherTaxName === "string" && item.otherTaxName.trim()
        ? item.otherTaxName.trim()
        : null,
    // Diğer Vergi GİB kodu (0059/4071/4080). GİB payload'ında tax[].taxCode.
    otherTaxCode:
      typeof item.otherTaxCode === "string" && item.otherTaxCode.trim()
        ? item.otherTaxCode.trim()
        : null,
    taxExemptionReasonCode:
      typeof item.taxExemptionReasonCode === "string" && item.taxExemptionReasonCode.trim()
        ? item.taxExemptionReasonCode.trim()
        : null,
    taxExemptionReason:
      typeof item.taxExemptionReason === "string" && item.taxExemptionReason.trim()
        ? item.taxExemptionReason.trim()
        : null,
  }
}
export const GET = withApiErrors(async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    resolvedParams.id = await resolveSlugId("invoice", resolvedParams.id, await resolveCompanyId(new URL(request.url).searchParams.get("companyId")))
    const { searchParams } = new URL(request.url)
    const queryCompanyId = (await resolveCompanyId(searchParams.get("companyId")))?.trim() || null

    const invoice = await prisma.invoice.findUnique({
      where: { id: resolvedParams.id },
      include: {
        company: {
          select: {
            id: true,
            name: true,
            taxNumber: true,
            taxOffice: true,
            address: true,
            city: true,
            phone: true,
            email: true,
          },
        },
        customer: true,
        supplier: true,
        items: {
          include: {
            product: true,
          },
          orderBy: { order: "asc" },
        },
        payments: {
          include: {
            account: {
              select: {
                id: true,
                name: true,
                type: true,
              },
            },
          },
          orderBy: {
            paymentDate: "desc",
          },
        },
      },
    })

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    await ensureCompanyAccess(invoice.companyId)

    if (queryCompanyId && queryCompanyId !== invoice.companyId) {
      return NextResponse.json(
        {
          error:
            "Bu fatura URL'deki firmaya ait değil. Üstten doğru şubeyi seçin veya Faturalar listesinden açın.",
          code: "COMPANY_MISMATCH",
        },
        { status: 400 }
      )
    }
    const company = await prisma.company.findUnique({
      where: { id: invoice.companyId },
      select: { isEDonusumEnabled: true },
    })
    if (!company) {
      return NextResponse.json({ error: "Company not found" }, { status: 404 })
    }

    // Gelen e-faturadan dönüştürülmüşse kaynak bilgisini ekle (preview'de "Geri"
    // butonu ve UI farklılıkları için).
    const incomingSource = await prisma.incomingInvoice.findFirst({
      where: { linkedInvoiceId: invoice.id },
      select: {
        uuid: true,
        invoiceNo: true,
        senderName: true,
        senderTaxNumber: true,
        profile: true,
      },
    })

    return NextResponse.json({
      ...invoice,
      profile: incomingSource?.profile ?? null,
      incomingSource: incomingSource
        ? {
            uuid: incomingSource.uuid,
            invoiceNo: incomingSource.invoiceNo,
            profile: incomingSource.profile,
            sender: {
              name: incomingSource.senderName,
              taxNumber: incomingSource.senderTaxNumber,
            },
          }
        : null,
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error fetching invoice:", error)
    return NextResponse.json(
      { error: message || "Internal server error" },
      { status: 500 }
    )
  }
})

export const PUT = withApiErrors(async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    resolvedParams.id = await resolveSlugId("invoice", resolvedParams.id, await resolveCompanyId(new URL(request.url).searchParams.get("companyId")))
    const invoice = await prisma.invoice.findUnique({
      where: { id: resolvedParams.id },
      // Kalemler stok mutabakatı için gerekli (düzenleme öncesi/sonrası kıyaslanır),
      // ödemeler ise tutarın tahsilatın altına düşürülmesini engellemek için.
      include: {
        items: {
          select: { productId: true, quantity: true, unitPrice: true },
          orderBy: { order: "asc" },
        },
        payments: { select: { amount: true } },
      },
    })

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    await ensureCompanyWrite(invoice.companyId)

    // ALIŞ FATURASI ALINAN bir belgedir: bizim kestiğimiz bir e-belge değil, karşı
    // tarafın gönderdiği belgenin bizdeki kaydı. Gelen e-faturadan dönüştürülenler
    // onay adımı olmasın diye doğrudan SENT kaydedilir (bkz. POST /invoices) — bu
    // "GİB'e gönderildi" demek DEĞİL. O yüzden alışta SENT de düzenlenebilir;
    // Mysoft'un boş bıraktığı birim fiyat/kalem ancak böyle düzeltilebiliyor.
    // Satışta kural değişmez: GİB'e giden belge düzenlenemez.
    // İptal edilmiş (reddedilen dahil) fatura hiçbir tipte düzenlenmez.
    const isPurchase = invoice.type === "PURCHASE"
    const isEditable =
      invoice.status === "DRAFT" || (isPurchase && invoice.status === "SENT")
    if (!isEditable) {
      return NextResponse.json(
        {
          error: isPurchase
            ? "Bu alış faturası iptal edilmiş; düzenlenemez."
            : "Yalnızca taslak faturalar düzenlenebilir. Gönderilmiş faturayı düzeltmek için iptal edip yeniden kesin.",
        },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { customerId, supplierId, date, dueDate, items, notes, globalDiscountAmount, globalChargeAmount, payableRoundingAmount, invoiceNo, category, tags, deliveryAddress, deliveryDistrict, deliveryCity, deliveryCountry, currency, exchangeRate, exchangeRateDate, returnOfInvoiceId, returnRefInvoiceNo, returnRefInvoiceDate, returnRefNote } = body

    /** Boş/boşluk metni null'a çevirir — atıf alanları temizlenebilmeli. */
    const trimOrNull = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)

    const manualNo = normalizeManualInvoiceNo(invoiceNo)
    if (!manualNo.ok) {
      return NextResponse.json({ error: manualNo.error }, { status: 400 })
    }
    const normalizedInvoiceNo = manualNo.value


    const normalizedItems =
      Array.isArray(items) && items.length > 0
        ? items.filter((item: any) => isMeaningfulInvoiceItem(item)).map((item: any) => normalizeInvoiceItem(item))
        : null

    if (Array.isArray(items) && items.length > 0 && normalizedItems && normalizedItems.length === 0) {
      return NextResponse.json(
        { error: "En az bir anlamlı fatura kalemi gerekli" },
        { status: 400 }
      )
    }

    // Recalculate totals if items changed
    let netAmount: Decimal = invoice.netAmount
    let vatAmount: Decimal = invoice.vatAmount
    let totalAmount: Decimal = invoice.totalAmount

    // Satır iskonto: mod AMOUNT ise tutar (brüt-aşan/negatif normalize edilir),
    // PERCENT ise oran. PUT yolunda Decimal kullanılır.
    const itemDiscountDec = (item: { quantity: number; unitPrice: number; discountRate: number; discountAmount: number; discountMode: string }) => {
      const gross = new Decimal(item.quantity).times(item.unitPrice)
      if (item.discountMode === "AMOUNT") {
        const raw = new Decimal(item.discountAmount || 0)
        const clampedMax = raw.gt(gross) ? gross : raw
        return clampedMax.lt(0) ? new Decimal(0) : clampedMax
      }
      return gross.times(new Decimal(item.discountRate || 0).div(100))
    }

    // Kalem gönderildiyse toplamlar ORTAK modülden kurulur (ÖTV/GEKAP matraha
    // girer). Matrah Decimal ile hesaplanır, vergi kırılımı number üzerinden —
    // POST/editör/GİB ile kuruşu kuruşuna aynı sonucu vermesi için tek formül şart.
    // Kalem gelmediyse `sums` null kalır ve saklı toplamlar üzerinden eski oransal
    // ölçekleme sürer (davranış değişmesin).
    let sums: LineTaxSums | null = null
    if (normalizedItems && normalizedItems.length > 0) {
      sums = emptyLineTaxSums()
      normalizedItems.forEach((item) => {
        const itemGross = new Decimal(item.quantity).times(item.unitPrice)
        const itemNet = itemGross.minus(itemDiscountDec(item)).toNumber()
        addLineTax(sums!, itemNet, computeLineTax(itemNet, item))
      })
      netAmount = new Decimal(sums.net)
      vatAmount = new Decimal(sums.vat)
      totalAmount = new Decimal(sums.total)
    }

    // Fatura altı (genel) iskonto: matrahtan oransal düşülür → KDV/total da aynı
    // oranda azalır. body'de globalDiscountAmount yoksa mevcut faturadakini koru.
    const incomingGlobalDiscount =
      globalDiscountAmount !== undefined
        ? new Decimal(Math.max(0, parseFloat(String(globalDiscountAmount)) || 0))
        : invoice.globalDiscountAmount
          ? new Decimal(invoice.globalDiscountAmount.toString())
          : new Decimal(0)
    const appliedGlobalDiscount = netAmount.gt(0)
      ? incomingGlobalDiscount.gt(netAmount) ? netAmount : incomingGlobalDiscount
      : new Decimal(0)
    // Fatura altı İLAVE (masraf): iskontonun tersi — KDV matrahını ARTIRIR.
    const appliedGlobalCharge = new Decimal(
      Math.max(0, parseFloat(globalChargeAmount) || 0),
    )
    if (netAmount.gt(0) && (appliedGlobalDiscount.gt(0) || appliedGlobalCharge.gt(0))) {
      const adjustedNet = netAmount.minus(appliedGlobalDiscount).plus(appliedGlobalCharge)
      if (sums) {
        // Oransal vergiler ölçeklenir, maktu GEKAP korunur.
        const adj = applyGlobalAdjustment(sums, adjustedNet.toNumber())
        netAmount = new Decimal(adj.net)
        vatAmount = new Decimal(adj.vat)
        totalAmount = new Decimal(adj.total)
      } else {
        // Kalem gelmedi: saklı toplamlar zaten kırılımsız, tek katsayı uygulanır.
        const adjustment = adjustedNet.div(netAmount)
        netAmount = adjustedNet
        vatAmount = vatAmount.times(adjustment)
        totalAmount = totalAmount.times(adjustment)
      }
    }

    // Dip toplam yuvarlaması: KDV'ye GİRMEZ, yalnız ödenecek tutara eklenir.
    const appliedRounding = new Decimal(parseFloat(payableRoundingAmount) || 0)
    totalAmount = totalAmount.plus(appliedRounding)

    // Tahsilat sınırı: ödeme ucu "kalan tutarı aşamaz" kuralını uyguluyor
    // (bkz. /api/faturalar/odemeler). Düzenleme toplamı tahsilatın ALTINA çekerse
    // aynı değişmez arkadan delinir ve fatura eksi kalanla kalırdı.
    const paidTotal = invoice.payments.reduce(
      (acc, payment) => acc.plus(new Decimal(payment.amount.toString())),
      new Decimal(0),
    )
    if (paidTotal.gt(0) && totalAmount.lt(paidTotal)) {
      return NextResponse.json(
        {
          error: `Fatura toplamı (${totalAmount.toFixed(2)}) bu faturaya işlenmiş tahsilatın (${paidTotal.toFixed(
            2,
          )}) altına indirilemez. Önce ödeme kaydını düzeltin.`,
        },
        { status: 400 },
      )
    }

    // ── STOK MUTABAKATI (hazırlık) ──────────────────────────────────────────
    // Fatura oluşturulurken stok ANINDA işlenir (bkz. POST /api/e-donusum/invoices).
    // Düzenleme aynı defteri güncellemek ZORUNDA: "10 kg aldım" faturasını 5 kg'a
    // çekince depoda 10 kg görünmeye devam ederse fatura ile stok sessizce ayrışır.
    //
    // Stoğa işlenmiş bir irsaliye bu faturaya bağlıysa mal depoya ZATEN irsaliyeyle
    // girmiştir; fatura stoğu hiç sahiplenmemiştir → düzenlemede de dokunulmaz
    // (çift stok önleme; POST'taki skipInvoiceStock ile aynı kural).
    const waybillOwnsStock =
      (await prisma.waybill.count({
        where: { invoiceId: resolvedParams.id, stockProcessed: true },
      })) > 0

    // Ürün/miktar/birim fiyat üçlüsü birebir aynıysa deftere DOKUNMA: her kaydetmede
    // geri alma + yeniden yazma çifti üretmek hareket listesini şişirir ve AVCO
    // ortalamasını eski fiyatla harmanlar (bkz. lib/stock/cost.ts AVG_COST_SELECT).
    const needsStockReconcile =
      normalizedItems !== null &&
      normalizedItems.length > 0 &&
      !waybillOwnsStock &&
      !sameStockLines(invoice.items, normalizedItems)

    // Reçete/maliyet okumaları transaction DIŞINDA: kilit süresi kısa kalsın.
    const newStockOps = needsStockReconcile
      ? await prepareInvoiceStockOps(prisma, {
          companyId: invoice.companyId,
          type: invoice.type,
          // Yön kayıttan okunur: tip düzenlemede kilitli (editör de kilitliyor),
          // dolayısıyla iadenin yönü de kesildiği gibi kalır.
          returnKind: invoice.returnKind,
          invoiceNo: normalizedInvoiceNo || invoice.invoiceNo,
          lines: (normalizedItems || []).map((item, index) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            order: index,
          })),
        })
      : []
    // Stok, oluşturmanın düştüğü depoya geri yazılır; faturada depo alanı yok.
    const stockWarehouseId = needsStockReconcile
      ? (await resolveInvoiceWarehouseId(prisma, {
          companyId: invoice.companyId,
          invoiceId: resolvedParams.id,
        })) || (await ensureDefaultWarehouseId(prisma, invoice.companyId))
      : null

    // Başlık + kalemler + stok TEK transaction: yarıda kalan bir düzenleme
    // (tutarlar yeni, stok eski) sessiz bir tutarsızlık bırakırdı.
    await prisma.$transaction(async (tx) => {
      await tx.invoice.update({
        where: { id: resolvedParams.id },
        data: {
          // Fatura No düzenlemesi (özellikle alışta tedarikçi belge no'su). Yalnız
          // dolu gelirse güncelle; boş bırakılırsa mevcut numarayı koru.
          // Doğrulama POST ile ORTAK (normalizeManualInvoiceNo) — burada yalnız trim
          // yapılıyordu, uzunluk/karakter sınırı yoktu.
          ...(normalizedInvoiceNo ? { invoiceNo: normalizedInvoiceNo } : {}),
          customerId: customerId !== undefined ? (customerId || null) : invoice.customerId,
          supplierId: supplierId !== undefined ? (supplierId || null) : invoice.supplierId,
          date: date ? new Date(date) : invoice.date,
          dueDate: dueDate !== undefined ? (dueDate ? new Date(dueDate) : null) : invoice.dueDate,
          totalAmount: totalAmount,
          vatAmount: vatAmount,
          netAmount: netAmount,
          globalDiscountAmount: appliedGlobalDiscount.gt(0) ? appliedGlobalDiscount : null,
          globalChargeAmount: appliedGlobalCharge.gt(0) ? appliedGlobalCharge : null,
          payableRoundingAmount: appliedRounding.isZero() ? null : appliedRounding,
          notes: notes !== undefined ? notes : invoice.notes,
          // Döviz: gönderilmediyse mevcut değer korunur. Alış faturasında karşı taraf
          // dövizli kesmiş olabilir; düzenlemede kur düzeltilebilmeli.
          ...(currency !== undefined ? { currency: currency || "TRY" } : {}),
          ...(exchangeRate !== undefined
            ? { exchangeRate: exchangeRate ? Number(exchangeRate) : null }
            : {}),
          ...(exchangeRateDate !== undefined
            ? { exchangeRateDate: exchangeRateDate ? new Date(exchangeRateDate) : null }
            : {}),
          // Sevk adresi — gönderilmediyse mevcut değere dokunma, boş gönderildiyse temizle.
          ...(deliveryAddress !== undefined
            ? { deliveryAddress: typeof deliveryAddress === "string" && deliveryAddress.trim() ? deliveryAddress.trim() : null }
            : {}),
          ...(deliveryDistrict !== undefined
            ? { deliveryDistrict: typeof deliveryDistrict === "string" && deliveryDistrict.trim() ? deliveryDistrict.trim() : null }
            : {}),
          ...(deliveryCity !== undefined
            ? { deliveryCity: typeof deliveryCity === "string" && deliveryCity.trim() ? deliveryCity.trim() : null }
            : {}),
          ...(deliveryCountry !== undefined
            ? { deliveryCountry: typeof deliveryCountry === "string" && deliveryCountry.trim() ? deliveryCountry.trim() : null }
            : {}),
          // Sınıflandırma — gönderilmediyse mevcut değer korunur (create ile aynı temizlik).
          ...(category !== undefined
            ? { category: typeof category === "string" && category.trim() ? category.trim() : null }
            : {}),
          ...(tags !== undefined
            ? {
                tags: Array.isArray(tags)
                  ? Array.from(
                      new Set(
                        tags
                          .map((t: unknown) => (typeof t === "string" ? t.trim() : ""))
                          .filter((t: string) => t.length > 0),
                      ),
                    )
                  : [],
              }
            : {}),
          // İade atıfları düzenlenebilir (yön DEĞİL: yön stok yönüdür ve tiple
          // birlikte kilitli). Asıl fatura no/tarihi belge kesildikten sonra
          // düzeltilebilmeli — e-belge gönderilmeden önce sık düzeltilen alan.
          ...(invoice.returnKind
            ? {
                ...(returnOfInvoiceId !== undefined ? { returnOfInvoiceId: trimOrNull(returnOfInvoiceId) } : {}),
                ...(returnRefInvoiceNo !== undefined ? { returnRefInvoiceNo: trimOrNull(returnRefInvoiceNo) } : {}),
                ...(returnRefNote !== undefined ? { returnRefNote: trimOrNull(returnRefNote) } : {}),
                ...(returnRefInvoiceDate !== undefined
                  ? { returnRefInvoiceDate: returnRefInvoiceDate ? new Date(returnRefInvoiceDate) : null }
                  : {}),
              }
            : {}),
        },
      })

      // Update items if provided
      if (normalizedItems && normalizedItems.length > 0) {
        // Delete existing items
        await tx.invoiceItem.deleteMany({
          where: { invoiceId: resolvedParams.id },
        })

        // Create new items
        await tx.invoiceItem.createMany({
          data: normalizedItems.map((item, index: number) => {
            const gross = new Decimal(item.quantity).times(item.unitPrice)
            const disc = itemDiscountDec(item)
            const net = gross.minus(disc)
            const tax = computeLineTax(net.toNumber(), item)
            return {
              invoiceId: resolvedParams.id,
              productId: item.productId || null,
              description: item.description,
              note: item.note,
              unit: item.unit,
              quantity: new Decimal(item.quantity),
              unitPrice: new Decimal(item.unitPrice),
              discountRate: item.discountMode === "AMOUNT" ? null : new Decimal(item.discountRate),
              discountAmount: disc,
              vatRate: new Decimal(item.vatRate),
              // KDV matrahı net DEĞİL, net + ÖTV + GEKAP'tır (bkz. computeLineTax).
              vatAmount: tax.vat,
              withholdingCode: item.withholdingCode,
              withholdingName: item.withholdingName,
              withholdingRate: new Decimal(item.withholdingRate),
              withholdingAmount: tax.withholding,
              exciseRate: new Decimal(item.exciseRate),
              exciseCode: item.exciseCode || null,
              exciseAmount: tax.excise,
              gekapUnitAmount: item.gekapUnitAmount || null,
              gekapAmount: tax.gekap || null,
              otherTaxRate: item.otherTaxRate ? new Decimal(item.otherTaxRate) : null,
              otherTaxAmount: tax.otherTax,
              otherTaxName: item.otherTaxName,
              otherTaxCode: item.otherTaxCode || null,
              totalAmount: tax.total,
              taxExemptionReasonCode: item.taxExemptionReasonCode,
              taxExemptionReason: item.taxExemptionReason,
              order: index,
            }
          }),
        })
      }

      // Eski stok etkisini geri al, yenisini yaz. Sıra önemli: geri alma
      // reference bazlı NET'e bakar, yeni hareketler yazıldıktan sonra çağrılırsa
      // onları da götürürdü.
      if (needsStockReconcile && stockWarehouseId) {
        await revertInvoiceStockForEdit(tx, {
          companyId: invoice.companyId,
          invoiceId: resolvedParams.id,
          invoiceNo: normalizedInvoiceNo || invoice.invoiceNo,
          createdBy: user.id,
        })
        await writeInvoiceStockOps(tx, {
          companyId: invoice.companyId,
          invoiceId: resolvedParams.id,
          invoiceNo: normalizedInvoiceNo || invoice.invoiceNo,
          type: invoice.type,
          returnKind: invoice.returnKind,
          warehouseId: stockWarehouseId,
          ops: newStockOps,
          createdBy: user.id,
        })
      }
    }, { timeout: 20000 })

    // Pano "Son faturalar" ve sayaçları düzenlenmiş tutarla tazelensin (POST ile aynı).
    revalidateDashboard(invoice.companyId)

    const invoiceWithItems = await prisma.invoice.findUnique({
      where: { id: resolvedParams.id },
      include: {
        customer: true,
        supplier: true,
        items: {
          include: {
            product: true,
          },
          orderBy: { order: "asc" },
        },
      },
    })

    return NextResponse.json(invoiceWithItems)
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    // Fatura No çakışması (@@unique([companyId, invoiceNo])) → net mesaj.
    if (error?.code === "P2002") {
      return NextResponse.json(
        { error: "Bu Fatura No bu firmada zaten kayıtlı. Farklı bir numara girin." },
        { status: 409 }
      )
    }
    console.error("Error updating invoice:", error)
    return NextResponse.json(
      { error: message || "Internal server error" },
      { status: 500 }
    )
  }
})

export const POST = withApiErrors(async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    resolvedParams.id = await resolveSlugId("invoice", resolvedParams.id, await resolveCompanyId(new URL(request.url).searchParams.get("companyId")))

    // Yetki kontrolü için faturanın companyId'sini önce çek.
    const existing = await prisma.invoice.findUnique({
      where: { id: resolvedParams.id },
      select: { companyId: true, uuid: true, status: true },
    })
    if (!existing) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }
    await ensureCompanyWrite(existing.companyId)

    // Tekrar koruması: taslakta uuid dolu olsa da "gönderilmiş" DEĞİL — ayrım status ile.
    if (existing.status === "SENT") {
      return NextResponse.json(
        { error: "Bu fatura zaten Mysoft'a gönderilmiş. Yeniden göndermek için önce iptal edin." },
        { status: 400 }
      )
    }
    if (existing.status === "GIB_DRAFT") {
      return NextResponse.json(
        { error: "Bu fatura için zaten bir GİB taslağı var. Taslağı kesinleştirin veya geri alın." },
        { status: 400 }
      )
    }

    // İstemci E-Fatura için Ticari/Temel profili seçebilir.
    const body = await request.json().catch(() => ({}))
    const eInvoiceProfile =
      body?.eInvoiceProfile === "TEMELFATURA" || body?.eInvoiceProfile === "TICARIFATURA"
        ? body.eInvoiceProfile
        : undefined

    const result = await createGibDraft(resolvedParams.id, { eInvoiceProfile })
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, integrationStatus: result.integrationStatus },
        { status: result.status }
      )
    }

    const updated = await prisma.invoice.findUnique({
      where: { id: resolvedParams.id },
    })
    return NextResponse.json({
      success: true,
      uuid: result.uuid,
      integrationId: result.providerName,
      invoice: updated,
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("Error resending invoice:", error)
    return NextResponse.json(
      { error: message || "Internal server error" },
      { status: 500 }
    )
  }
})
export const DELETE = withApiErrors(async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const resolvedParams = await params
    resolvedParams.id = await resolveSlugId("invoice", resolvedParams.id, await resolveCompanyId(new URL(request.url).searchParams.get("companyId")))
    const invoiceId = resolvedParams.id

    // 1. Silinecek faturayı, içindeki ürünlerle (items) ve stokla bağlantılı olarak çekelim
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        items: true,
      },
    })

    if (!invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 })
    }

    await ensureCompanyWrite(invoice.companyId)

    // NOT: GİB'e gönderilmiş (uuid/ETTN) fatura da FİZİKSEL silinebilir. Bu silme
    // yalnızca Kobipo'daki LOKAL (ön muhasebe / cari) kaydı kaldırır; GİB'deki resmi
    // e-Fatura/e-Arşiv belgesine DOKUNMAZ (iptal etmez). Kullanıcı bu ayrımı silme
    // onay ekranındaki uyarıyla teyit eder; stok ve cari bakiye normal şekilde geri alınır.

    // 2-4. Stok iadesi + yan etkiler + faturanın kendisi tek atomik transaction'da.
    // Stok geri alma artık `revertInvoiceStock` ile yapılıyor: depo bazlı (WarehouseStock)
    // güncellenir, Σ(WarehouseStock)=Product.stockQuantity değişmezi korunur ve
    // idempotenttir (zaten iptal edilip stoğu geri alınmış faturayı silmek çift
    // geri alma yapmaz). Bağlı InvoiceItem/InvoicePayment/PaymentLink/Waybill
    // kayıtları şemada onDelete: Cascade olduğu için fatura silinince otomatik gider.
    try {
      await prisma.$transaction(async (tx) => {
        await revertInvoiceStock(tx, {
          companyId: invoice.companyId,
          invoiceId,
          invoiceNo: invoice.invoiceNo,
          createdBy: user.id,
        })

        // İlgili otomatik muhasebe fişlerini (AccountingEntry) sil (varsa).
        await tx.accountingEntry.deleteMany({
          where: {
            companyId: invoice.companyId,
            reference: invoice.id,
            referenceType: { in: ["INVOICE_AUTO", "INVOICE_AUTO_VAT"] },
          },
        })

        // Bu fatura bir gelen e-faturadan dönüştürülmüşse, kaynak kaydın bağlantısını
        // çöz → gelen e-fatura tekrar "Alış Faturasına Dönüştür" edilebilir hale gelsin.
        // (Aksi halde silinen faturaya bağlı kalıp "dönüştürülmüş" görünmeye devam eder.)
        await tx.incomingInvoice.updateMany({
          where: { linkedInvoiceId: invoiceId },
          data: { isLinkedToPurchase: false, linkedInvoiceId: null },
        })

        // Son olarak faturayı sil (bağlı kayıtlar cascade ile temizlenir).
        await tx.invoice.delete({ where: { id: invoiceId } })
      })
    } catch (deleteError: any) {
      if (deleteError?.code === "P2025") {
        // Fatura zaten silinmiş (çift tıklama / yarış durumu): başarı say.
        console.warn(`[Silme Uyarısı] Fatura zaten silinmiş veya bulunamadı. ID: ${invoiceId}`)
        return NextResponse.json({ success: true, message: "Fatura zaten silinmiş." })
      }
      throw deleteError
    }

    return NextResponse.json({ success: true, message: "Fatura ve stok hareketleri silindi/geri alındı." })
  } catch (error: any) {
    console.error("Error deleting invoice:", error)
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    )
  }
})
