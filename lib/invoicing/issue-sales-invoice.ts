// Kobipo'nun KENDİ satışları için otomatik satış faturası — TEK giriş noktası.
// Plan: docs/faturalandirma/PLAN.md
//
// İki satış kanalı (kontör ve paket/abonelik) aynı servisi çağırır; kanal farkı yalnız
// siparişin okunmasında, belgenin kurulmasında değil. Servis OTURUMSUZ çalışabilir —
// PayTR bildirimi oturumsuz gelir; yetki kontrolü ÇAĞIRANIN sorumluluğundadır.
//
// FATURA SATICI FİRMADA AÇILIR (Kobipo'nun tüzel kişisi), alıcı firmada değil. Alıcı,
// satıcının cari kartlarından biri olur. Bu yüzden buradaki `companyId` her yerde
// satıcıyı gösterir; siparişin `companyId`si ALICIdır — ikisi karıştırılmamalı.
//
// YENİDEN ÇALIŞTIRILABİLİR: her adım nerede kaldığını faturanın durumundan okur.
// DRAFT → Mysoft taslağı → GİB'e kesinleştirme → tahsilat kaydı. Ortada patlayan bir
// deneme, ikinci çağrıda kaldığı yerden devam eder; belge iki kez kesilmez.

import { prisma } from "@/lib/db/prisma"
import { generateInvoiceNumber } from "@/lib/utils/invoice-number"
import {
  createGibDraft,
  finalizeGibDraft,
} from "@/lib/integrations/e-invoice/send-invoice-helper"
import { buildInternetSalesInfo } from "@/lib/invoice/internet-sales"
import { resolveVatRate, splitVatInclusive } from "@/lib/billing/vat"
import { checkInvoiceGates, resolveSellerCompanyId, stopAtDraft } from "@/lib/invoicing/config"
import { makeUniqueSlug, slugify } from "@/lib/slug"

export type IssueKind = "KONTOR" | "PACKAGE"

export type IssueResult =
  /** Belge kesildi (ya da zaten kesilmişti). */
  | { ok: true; invoiceId: string; invoiceNo: string; alreadyIssued: boolean }
  /** Kapılardan döndü — HATA DEĞİL, `invoiceError` yazılmaz. */
  | { ok: false; skipped: true; reason: string }
  /** Gerçek hata — siparişe `invoiceError` yazılır, sipariş akışı etkilenmez. */
  | { ok: false; skipped: false; error: string }

const skip = (reason: string): IssueResult => ({ ok: false, skipped: true, reason })

/** Siparişin kanaldan bağımsız, faturalamaya yeten görünümü. */
type OrderView = {
  id: string
  buyerCompanyId: string
  gross: number
  currency: string
  paidAt: Date | null
  /** "CARD" | "HAVALE" — internet satış ödeme şeklini belirler. */
  paymentMethod: string
  isTest: boolean
  invoiceId: string | null
  vatRate: number
  /** Belgede basılacak mal/hizmet adı. */
  description: string
  /** Belgeye yazılacak insan-okunur sipariş referansı (cuid basmayalım). */
  reference: string
  /** Satış kaleminin bağlanacağı hizmet ürününün adı. */
  productName: string
  billing: BillingInfo
}

type BillingInfo = {
  name: string
  taxNumber: string
  taxOffice: string | null
  address: string | null
  city: string | null
  district: string | null
  email: string | null
}

const trimOrNull = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : ""
  return s ? s : null
}

/**
 * Fatura bilgisini sipariş snapshot'ından, eksik alanları alıcı firma kartından
 * tamamlayarak çözer. Snapshot ÖNCELİKLİDİR: satın alma anında ne beyan edildiyse
 * belge onunla uyumlu olmalı — firma kartı sonradan değişmiş olabilir.
 */
function resolveBilling(
  order: {
    billingName: string | null
    billingTaxNumber: string | null
    billingTaxOffice: string | null
    billingAddress: string | null
    billingCity: string | null
    billingDistrict: string | null
    billingEmail: string | null
  },
  company: {
    name: string
    taxNumber: string | null
    taxOffice: string | null
    address: string | null
    city: string | null
    email: string | null
  },
): { ok: true; billing: BillingInfo } | { ok: false; error: string } {
  const name = trimOrNull(order.billingName) || trimOrNull(company.name)
  const rawVkn = (order.billingTaxNumber || company.taxNumber || "").replace(/\D/g, "")

  if (!name) return { ok: false, error: "Alıcı ünvanı yok — fatura kesilemez." }
  if (!/^\d{10,11}$/.test(rawVkn)) {
    return { ok: false, error: `Alıcı VKN/TCKN geçersiz ("${rawVkn || "boş"}") — fatura kesilemez.` }
  }
  // Tüm rakamları aynı olan placeholder (11111111111) gerçek mükellef değildir;
  // e-Fatura'da Mysoft "posta kutusu bulunamadı" der, e-Arşiv'de de belgeyi
  // düzeltilemez biçimde yanlış alıcıya bağlar.
  if (/^(\d)\1+$/.test(rawVkn)) {
    return { ok: false, error: `Alıcı VKN/TCKN placeholder değer ("${rawVkn}") — fatura kesilemez.` }
  }

  return {
    ok: true,
    billing: {
      name,
      taxNumber: rawVkn,
      taxOffice: trimOrNull(order.billingTaxOffice) || trimOrNull(company.taxOffice),
      address: trimOrNull(order.billingAddress) || trimOrNull(company.address),
      city: trimOrNull(order.billingCity) || trimOrNull(company.city),
      district: trimOrNull(order.billingDistrict),
      email: trimOrNull(order.billingEmail) || trimOrNull(company.email),
    },
  }
}

const COMPANY_BILLING_SELECT = {
  name: true,
  taxNumber: true,
  taxOffice: true,
  address: true,
  city: true,
  email: true,
} as const

/** Kontör siparişini ortak görünüme çevirir. */
async function loadKontorOrder(orderId: string): Promise<OrderView | { error: string } | null> {
  const order = await prisma.kontorOrder.findUnique({
    where: { id: orderId },
    include: {
      package: { select: { vatRate: true } },
      company: { select: COMPANY_BILLING_SELECT },
    },
  })
  if (!order) return null

  const billing = resolveBilling(order, order.company)
  if (!billing.ok) return { error: billing.error }

  return {
    id: order.id,
    buyerCompanyId: order.companyId,
    gross: Number(order.totalPrice),
    currency: order.currency || "TRY",
    // Havalede tahsilat anı admin onayıdır (paidAt yalnız kart akışında dolar).
    paidAt: order.paidAt ?? order.confirmedAt ?? null,
    paymentMethod: order.paymentMethod || "HAVALE",
    isTest: order.isTest,
    invoiceId: order.invoiceId,
    vatRate: resolveVatRate(order.package?.vatRate),
    description: `${order.packageName} — ${order.creditQty} adet e-Belge kontörü`,
    reference: order.paymentCode || order.id.slice(-8).toUpperCase(),
    productName: "E-Belge Kontörü",
    billing: billing.billing,
  }
}

/** Paket/abonelik siparişini ortak görünüme çevirir. */
async function loadPackageOrder(orderId: string): Promise<OrderView | { error: string } | null> {
  const order = await prisma.packageOrder.findUnique({
    where: { id: orderId },
    include: {
      plan: { select: { vatRate: true, name: true } },
      company: { select: COMPANY_BILLING_SELECT },
    },
  })
  if (!order) return null

  const billing = resolveBilling(order, order.company)
  if (!billing.ok) return { error: billing.error }

  const cycle = order.billingCycle === "YEARLY" ? "Yıllık" : "Aylık"
  const planLabel = order.planName || order.plan?.name || "Kobipo Abonelik"

  return {
    id: order.id,
    buyerCompanyId: order.companyId,
    gross: Number(order.amount),
    currency: order.currency || "TRY",
    paidAt: order.paidAt ?? null,
    // Paket ödemeleri PayTR sanal POS'undan geçer; havale akışı yoktur.
    paymentMethod: "CARD",
    isTest: order.isTest,
    invoiceId: order.invoiceId,
    vatRate: resolveVatRate(order.plan?.vatRate),
    description: `${planLabel} — ${cycle} abonelik`,
    reference: order.id.slice(-8).toUpperCase(),
    productName: "Kobipo Abonelik",
    billing: billing.billing,
  }
}

/** Alıcıyı satıcının cari kartlarında bulur; yoksa açar. Eşleşme VKN üzerindendir. */
async function ensureCustomer(sellerCompanyId: string, billing: BillingInfo): Promise<string> {
  const existing = await prisma.customer.findFirst({
    where: { companyId: sellerCompanyId, taxNumber: billing.taxNumber },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  })
  if (existing) return existing.id

  const slug = await makeUniqueSlug(slugify(billing.name), async (candidate) =>
    Boolean(
      await prisma.customer.findFirst({
        where: { companyId: sellerCompanyId, slug: candidate },
        select: { id: true },
      }),
    ),
  )

  const created = await prisma.customer.create({
    data: {
      companyId: sellerCompanyId,
      name: billing.name,
      slug,
      taxNumber: billing.taxNumber,
      taxOffice: billing.taxOffice,
      address: billing.address,
      city: billing.city,
      district: billing.district,
      email: billing.email,
      note: "Kobipo müşterisi — otomatik faturalandırma ile açıldı.",
    },
    select: { id: true },
  })
  return created.id
}

/**
 * Satış kaleminin bağlanacağı HİZMET ürünü (stok işlemez). Bulunamazsa açılır;
 * açılamazsa kalem ürünsüz yazılır — belge ürün kartına bağlı olmadan da geçerlidir,
 * bu yüzden ürün oluşturma hatası faturayı düşürmez.
 */
async function ensureServiceProductId(
  sellerCompanyId: string,
  name: string,
  vatRate: number,
): Promise<string | null> {
  try {
    const existing = await prisma.product.findFirst({
      where: { companyId: sellerCompanyId, name },
      select: { id: true },
    })
    if (existing) return existing.id

    const slug = await makeUniqueSlug(slugify(name), async (candidate) =>
      Boolean(
        await prisma.product.findFirst({
          where: { companyId: sellerCompanyId, slug: candidate },
          select: { id: true },
        }),
      ),
    )

    const created = await prisma.product.create({
      data: {
        companyId: sellerCompanyId,
        name,
        slug,
        isService: true,
        isSellable: true,
        unit: "ADET",
        vatRate,
        salePriceVatIncluded: true,
      },
      select: { id: true },
    })
    return created.id
  } catch (e: any) {
    console.warn(`[faturalandirma] Hizmet ürünü hazırlanamadı ("${name}"):`, e?.message)
    return null
  }
}

/** Siparişe fatura bağını yazar; kaybeden yarış null döner. */
async function claimOrder(
  kind: IssueKind,
  orderId: string,
  invoiceId: string,
): Promise<boolean> {
  const data = { invoiceId, invoicedAt: new Date(), invoiceError: null }
  const where = { id: orderId, invoiceId: null }
  const res =
    kind === "KONTOR"
      ? await prisma.kontorOrder.updateMany({ where, data })
      : await prisma.packageOrder.updateMany({ where, data })
  return res.count > 0
}

async function noteAttempt(kind: IssueKind, orderId: string, error: string | null) {
  const data = { invoiceAttempts: { increment: 1 }, invoiceError: error }
  if (kind === "KONTOR") {
    await prisma.kontorOrder.update({ where: { id: orderId }, data })
  } else {
    await prisma.packageOrder.update({ where: { id: orderId }, data })
  }
}

/**
 * Bir siparişi faturalar. Kapılardan dönerse `skipped: true` verir (hata değil).
 *
 * Çağıran taraf sonucu YOK SAYABİLİR: fatura kesilememesi ne siparişi ne kontör
 * yüklemesini geçersiz kılar — ödeme alınmıştır, belge sonradan da kesilebilir.
 */
export async function issueSalesInvoiceForOrder(params: {
  kind: IssueKind
  orderId: string
}): Promise<IssueResult> {
  const { kind, orderId } = params

  const loaded =
    kind === "KONTOR" ? await loadKontorOrder(orderId) : await loadPackageOrder(orderId)
  if (!loaded) return { ok: false, skipped: false, error: "Sipariş bulunamadı" }
  if ("error" in loaded) {
    await noteAttempt(kind, orderId, loaded.error)
    return { ok: false, skipped: false, error: loaded.error }
  }
  const order = loaded

  const gate = checkInvoiceGates({ isTest: order.isTest, paidAt: order.paidAt })
  if (!gate.ok) {
    console.log(`[faturalandirma] ${kind} ${orderId} atlandı: ${gate.reason}`)
    return skip(gate.reason)
  }

  const sellerCompanyId = await resolveSellerCompanyId()
  if (!sellerCompanyId) {
    return { ok: false, skipped: false, error: "Satıcı firma çözülemedi (KOBIPO_SELLER_COMPANY_ID)" }
  }
  const seller = await prisma.company.findUnique({
    where: { id: sellerCompanyId },
    select: { id: true, isEDonusumEnabled: true },
  })
  if (!seller) return { ok: false, skipped: false, error: "Satıcı firma bulunamadı" }
  if (!seller.isEDonusumEnabled) {
    return { ok: false, skipped: false, error: "Satıcı firmada e-Dönüşüm kapalı" }
  }

  // Satıcı kendine fatura kesemez (iç test siparişi). Belge geçersiz olurdu.
  if (order.buyerCompanyId === sellerCompanyId) {
    return skip("Alıcı ile satıcı aynı firma — belge kesilmez")
  }

  try {
    let invoiceId = order.invoiceId

    // 1) TASLAK KAYIT — yalnız daha önce açılmadıysa.
    if (!invoiceId) {
      const split = splitVatInclusive(order.gross, order.vatRate)
      const customerId = await ensureCustomer(sellerCompanyId, order.billing)
      const productId = await ensureServiceProductId(
        sellerCompanyId,
        order.productName,
        split.vatRate,
      )
      const issuedAt = order.paidAt ?? new Date()
      const invoiceNo = await generateInvoiceNumber(sellerCompanyId, "SALES", issuedAt)

      const created = await prisma.invoice.create({
        data: {
          companyId: sellerCompanyId,
          invoiceNo,
          type: "SALES",
          // Alıcı e-Fatura mükellefiyse gönderim yardımcısı bunu E_INVOICE'a çevirir
          // (getGibAccount sorgusu) — burada belge tipini tahmin etmeye çalışmıyoruz.
          invoiceType: "E_ARCHIVE",
          customerId,
          date: issuedAt,
          currency: order.currency,
          netAmount: split.net,
          vatAmount: split.vat,
          totalAmount: split.gross,
          // İç yüzde ayrıştırmasının kuruş artığı; KDV'ye girmez, ödenecek tutarı
          // tahsil edilen tutara eşitler.
          payableRoundingAmount: split.rounding !== 0 ? split.rounding : null,
          status: "DRAFT",
          notes: `Kobipo sipariş no: ${order.reference}`,
          internetSalesInfo: buildInternetSalesInfo({
            paymentMethod: order.paymentMethod,
            paidAt: order.paidAt,
          }) as any,
          items: {
            create: [
              {
                ...(productId ? { product: { connect: { id: productId } } } : {}),
                description: order.description,
                unit: "ADET",
                quantity: 1,
                unitPrice: split.net,
                vatRate: split.vatRate,
                vatAmount: split.vat,
                totalAmount: split.net + split.vat,
                order: 0,
              },
            ],
          },
        },
        select: { id: true, invoiceNo: true },
      })

      // Yarışı burada çözüyoruz: iki callback aynı anda geldiyse yalnız biri siparişe
      // bağlanır, kaybeden az önce açtığı TASLAĞI siler (henüz GİB'e gitmedi).
      const claimed = await claimOrder(kind, orderId, created.id)
      if (!claimed) {
        await prisma.invoice.delete({ where: { id: created.id } }).catch(() => {})
        const fresh =
          kind === "KONTOR"
            ? await prisma.kontorOrder.findUnique({
                where: { id: orderId },
                select: { invoiceId: true },
              })
            : await prisma.packageOrder.findUnique({
                where: { id: orderId },
                select: { invoiceId: true },
              })
        return {
          ok: true,
          invoiceId: fresh?.invoiceId || created.id,
          invoiceNo: created.invoiceNo,
          alreadyIssued: true,
        }
      }
      invoiceId = created.id
    }

    // 2) NEREDE KALDIK? Belge durumu tek doğru kaynaktır.
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, invoiceNo: true, status: true, totalAmount: true, customerId: true },
    })
    if (!invoice) {
      // Bağ var ama belge silinmiş: bağı çöz ki bir sonraki deneme sıfırdan kessin.
      await claimOrderReset(kind, orderId)
      return { ok: false, skipped: false, error: "Bağlı fatura bulunamadı; bağ çözüldü, tekrar deneyin." }
    }

    if (invoice.status === "CANCELLED") {
      return { ok: false, skipped: false, error: "Bağlı fatura iptal edilmiş — elle müdahale gerekir." }
    }

    // 3) MYSOFT TASLAĞI
    if (invoice.status === "DRAFT") {
      const draft = await createGibDraft(invoice.id)
      if (!draft.ok) {
        await noteAttempt(kind, orderId, draft.error)
        return { ok: false, skipped: false, error: draft.error }
      }
    }

    // PROVA MODU: taslakta dur. Belge Mysoft'ta durur, GİB'e GİTMEZ — hukuken bir
    // fatura doğmaz. Taslak PDF'i incelenip `discardGibDraft` ile silinebilir.
    if (stopAtDraft()) {
      console.warn(
        `[faturalandirma] PROVA MODU (KOBIPO_INVOICE_STOP_AT_DRAFT): ${invoice.invoiceNo} ` +
          `Mysoft taslağında bırakıldı, GİB'e GÖNDERİLMEDİ. Tahsilat da yazılmadı.`,
      )
      return {
        ok: true,
        invoiceId: invoice.id,
        invoiceNo: invoice.invoiceNo,
        alreadyIssued: false,
      }
    }

    // 4) GİB'E KESİNLEŞTİRME
    const current = await prisma.invoice.findUnique({
      where: { id: invoice.id },
      select: { status: true },
    })
    if (current?.status === "GIB_DRAFT") {
      const sent = await finalizeGibDraft(invoice.id)
      if (!sent.ok) {
        await noteAttempt(kind, orderId, sent.error)
        return { ok: false, skipped: false, error: sent.error }
      }
    }

    // 5) TAHSİLAT — belge kesildikten SONRA. Ödeme zaten alınmıştır; kaydı yazmak
    // cari borcu kapatır. Hatası faturayı geçersiz kılmaz, yalnız loglanır.
    await recordCollection({
      sellerCompanyId,
      invoiceId: invoice.id,
      invoiceNo: invoice.invoiceNo,
      customerId: invoice.customerId,
      amount: Number(invoice.totalAmount),
      currency: order.currency,
      paidAt: order.paidAt ?? new Date(),
      paymentMethod: order.paymentMethod,
      reference: order.reference,
    })

    await noteAttempt(kind, orderId, null)

    await prisma.systemLog.create({
      data: {
        action: "SALES_INVOICE",
        entity: kind === "KONTOR" ? "KontorOrder" : "PackageOrder",
        details:
          `${kind} siparişi ${orderId} faturalandı: ${invoice.invoiceNo} ` +
          `(${order.gross} ${order.currency}, alıcı VKN ${order.billing.taxNumber})`,
        level: "INFO",
      },
    })

    return { ok: true, invoiceId: invoice.id, invoiceNo: invoice.invoiceNo, alreadyIssued: false }
  } catch (e: any) {
    const message = e?.message || "Faturalandırma sırasında beklenmeyen hata"
    console.error(`[faturalandirma] ${kind} ${orderId} hata:`, e)
    await noteAttempt(kind, orderId, message).catch(() => {})
    return { ok: false, skipped: false, error: message }
  }
}

/**
 * Faturası kesilmiş ama CARİ KAYDI eksik kalmış bir siparişin tahsilatını tamamlar.
 *
 * Tahsilat hesabı (KOBIPO_CARD_ACCOUNT_ID / KOBIPO_BANK_ACCOUNT_ID) tanımsızken kesilen
 * faturalarda cari borç açık kalır. Hesap sonradan tanımlandığında bu fonksiyon eksik
 * `Transaction`'ı yazar; fatura ve ödeme kaydı yeniden ÜRETİLMEZ, yalnız tamamlanır.
 *
 * `issueSalesInvoiceForOrder`'dan ayrı tutuldu: o, deneme sayacını artırır ve
 * `SALES_INVOICE` log'u yazar — her gece tekrarlanınca gürültü olurdu.
 */
export async function reconcileOrderCollection(params: {
  kind: IssueKind
  orderId: string
}): Promise<void> {
  const loaded =
    params.kind === "KONTOR"
      ? await loadKontorOrder(params.orderId)
      : await loadPackageOrder(params.orderId)
  if (!loaded || "error" in loaded) return
  if (!loaded.invoiceId) return

  const invoice = await prisma.invoice.findUnique({
    where: { id: loaded.invoiceId },
    select: {
      id: true,
      companyId: true,
      invoiceNo: true,
      status: true,
      totalAmount: true,
      customerId: true,
    },
  })
  if (!invoice || invoice.status !== "SENT") return

  await recordCollection({
    sellerCompanyId: invoice.companyId,
    invoiceId: invoice.id,
    invoiceNo: invoice.invoiceNo,
    customerId: invoice.customerId,
    amount: Number(invoice.totalAmount),
    currency: loaded.currency,
    paidAt: loaded.paidAt ?? new Date(),
    paymentMethod: loaded.paymentMethod,
    reference: loaded.reference,
  })
}

/**
 * Ödeme akışlarından çağrılan sarmalayıcı: HİÇBİR koşulda fırlatmaz.
 *
 * Faturalandırma, ödemenin ve kontör yüklemesinin YAN İŞLEMİDİR. Burada atılan bir
 * istisna PayTR bildirimine "başarısız" dedirtir, PayTR tekrar dener ve akış
 * (yükleme/aktivasyon) gereksiz yere tekrarlanır. Sonuç yalnız loglanır.
 */
export async function issueInvoiceQuietly(params: {
  kind: IssueKind
  orderId: string
}): Promise<void> {
  try {
    const res = await issueSalesInvoiceForOrder(params)
    if (res.ok) {
      if (!res.alreadyIssued) {
        console.log(
          `[faturalandirma] ${params.kind} ${params.orderId} → fatura ${res.invoiceNo}`,
        )
      }
    } else if (!res.skipped) {
      console.error(
        `[faturalandirma] ${params.kind} ${params.orderId} faturalanamadı: ${res.error}`,
      )
    }
  } catch (e: any) {
    console.error(`[faturalandirma] ${params.kind} ${params.orderId} sarmalayıcı hata:`, e?.message)
  }
}

async function claimOrderReset(kind: IssueKind, orderId: string) {
  const data = { invoiceId: null, invoicedAt: null }
  if (kind === "KONTOR") {
    await prisma.kontorOrder.update({ where: { id: orderId }, data }).catch(() => {})
  } else {
    await prisma.packageOrder.update({ where: { id: orderId }, data }).catch(() => {})
  }
}

/**
 * Tahsilatı yazar: `InvoicePayment` (faturanın ödendiği bilgisi) + varsa `Transaction`
 * (cari ekstrede borcu KAPATAN satır).
 *
 * Transaction bir finansal hesap gerektirir (`accountId` zorunlu). Hesap
 * yapılandırılmadıysa yalnız InvoicePayment yazılır: fatura "ödendi" görünür ama cari
 * satırı açık kalır — bu görünür ve düzeltilebilir bir eksiklik, sessiz bir kayıp değil.
 */
async function recordCollection(params: {
  sellerCompanyId: string
  invoiceId: string
  invoiceNo: string
  customerId: string | null
  amount: number
  currency: string
  paidAt: Date
  paymentMethod: string
  reference: string
}) {
  try {
    const existing = await prisma.invoicePayment.findFirst({
      where: { invoiceId: params.invoiceId },
      select: { id: true, transactionId: true },
    })
    // Tahsilat TAM yazılmışsa (cari satırı da varsa) işimiz bitti.
    if (existing?.transactionId) return

    const isCard = params.paymentMethod.toUpperCase() === "CARD"
    // ÇAPRAZ YEDEKLEME YOK: her ödeme yöntemi KENDİ hesabına yazılır. Havale parası
    // PayTR'ye hiç uğramaz; yedekleyip kart hesabına yazmak, PayTR'de bekleyen tutarı
    // olduğundan büyük gösterir ve hakediş mutabakatını bozar. Hesap tanımlı değilse
    // cari satırı yazılmaz — eksik ama YANLIŞ olmayan kayıt tercih edilir.
    const accountId = (
      isCard ? process.env.KOBIPO_CARD_ACCOUNT_ID : process.env.KOBIPO_BANK_ACCOUNT_ID
    )?.trim()

    const account = accountId
      ? await prisma.financialAccount.findFirst({
          where: { id: accountId, companyId: params.sellerCompanyId },
          select: { id: true },
        })
      : null

    if (accountId && !account) {
      console.warn(
        `[faturalandirma] Tahsilat hesabı ${accountId} satıcı firmada bulunamadı — ` +
          `cari kaydı yazılmadan devam ediliyor.`,
      )
    }
    if (!account) {
      console.warn(
        `[faturalandirma] ${isCard ? "KOBIPO_CARD_ACCOUNT_ID" : "KOBIPO_BANK_ACCOUNT_ID"} ` +
          `tanımsız. ${params.invoiceNo} için cari borcu AÇIK kalacak; hesap tanımlanınca ` +
          `günlük iş eksik cari kaydını tamamlar.`,
      )
      // Fatura "ödendi" bilgisi yine de yazılır (bir kez).
      if (!existing) {
        await prisma.invoicePayment.create({
          data: {
            invoiceId: params.invoiceId,
            companyId: params.sellerCompanyId,
            amount: params.amount,
            paymentDate: params.paidAt,
            paymentMethod: isCard ? "CREDIT_CARD" : "BANK_TRANSFER",
            reference: params.reference,
            notes: "Otomatik faturalandırma — tahsilat hesabı tanımsız, cari kaydı bekliyor.",
          },
        })
      }
      return
    }

    await prisma.$transaction(async (db) => {
      const trx = await db.transaction.create({
        data: {
          companyId: params.sellerCompanyId,
          accountId: account.id,
          type: "INCOME",
          amount: params.amount,
          currency: params.currency,
          description: `Tahsilat — ${params.invoiceNo} (Kobipo sipariş ${params.reference})`,
          date: params.paidAt,
          customerId: params.customerId,
          reference: params.reference,
        },
      })
      await db.financialAccount.update({
        where: { id: account.id },
        data: { balance: { increment: params.amount } },
      })

      // KENDİNİ ONARMA: hesap sonradan tanımlandıysa, daha önce cari satırı olmadan
      // yazılmış ödeme kaydı GÜNCELLENİR — ikinci bir ödeme satırı yaratılmaz.
      if (existing) {
        await db.invoicePayment.update({
          where: { id: existing.id },
          data: {
            accountId: account.id,
            transactionId: trx.id,
            notes: "Otomatik faturalandırma — cari kaydı sonradan tamamlandı.",
          },
        })
      } else {
        await db.invoicePayment.create({
          data: {
            invoiceId: params.invoiceId,
            companyId: params.sellerCompanyId,
            amount: params.amount,
            paymentDate: params.paidAt,
            paymentMethod: isCard ? "CREDIT_CARD" : "BANK_TRANSFER",
            accountId: account.id,
            transactionId: trx.id,
            reference: params.reference,
            notes: "Otomatik faturalandırma — tahsilat sipariş ödemesinden yazıldı.",
          },
        })
      }
    })
  } catch (e: any) {
    // Tahsilat kaydı belgeyi geçersiz kılmaz; fatura kesilmiştir.
    console.error(`[faturalandirma] Tahsilat kaydı yazılamadı (${params.invoiceNo}):`, e?.message)
  }
}
