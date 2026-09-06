/**
 * Birleşik fatura listesi — gelen + giden.
 *
 * `app/api/faturalar/route.ts`ten ayıklandı: dışa aktarma da aynı üç kaynağı
 * aynı kurallarla birleştirmek zorunda. Ayrı yazılsaydı "ekranda 120 fatura
 * var, Excel'de 118" tipinde, bulunması çok zor farklar çıkardı.
 *
 * Kaynaklar:
 *  - Gelen : IncomingInvoice (Mysoft InvoiceInbox'tan çekilen e-faturalar)
 *          + Invoice (type=PURCHASE) (manuel girilen alış faturaları)
 *  - Giden : Invoice (type=SALES) (manuel + e-fatura olarak gönderilenler)
 */

import { prisma } from "@/lib/db/prisma"

/** Liste ekranının kaynak başına satır tavanı. */
export const INVOICE_LIST_DEFAULT_LIMIT = 500

export type InvoiceListDirection = "all" | "incoming" | "outgoing"

export type InvoiceListRow = {
  id: string
  slug: string | null
  direction: "incoming" | "outgoing"
  source: "mysoft_inbox" | "manual_purchase" | "manual_sales" | "manual_return" | "converted_inbox"
  date: string | null
  /** Aynı gün kayıtlarında deterministik (en yeni önce) sıralama için ikincil anahtar. */
  createdAt: string | null
  invoiceNo: string | null
  uuid: string | null
  counterparty: { name: string | null; taxNumber: string | null }
  currency: string | null
  netAmount: number | null
  vatAmount: number | null
  totalAmount: number | null
  status: string | null
  profile: string | null
  invoiceType: string | null
  /** Sınıflandırma (yalnız kendi faturalarımızda; gelen e-faturada yok). */
  category?: string | null
  tags?: string[]
  meta: Record<string, any>
}

export type InvoiceListOptions = {
  companyId: string
  direction?: InvoiceListDirection
  includeInbox?: boolean
  days?: number
  startDate?: string | null
  endDate?: string | null
  status?: string | null
  search?: string | null
  // --- Detaylı filtreler ---------------------------------------------------
  /** Karşı taraf ünvanı içerir (gelen: gönderici, alış: tedarikçi, satış: müşteri). */
  counterparty?: string | null
  /** Karşı tarafın VKN/TCKN'si içerir. */
  taxNumber?: string | null
  /**
   * Belge tutarı aralığı — faturanın KENDİ para biriminde. Döviz faturasında
   * "1000 TL üstü" araması 1000 USD üstünü de getirir; kur ile normalize etmek
   * satır bazında kur çarpımı gerektirir ve SQL'de sıralanamaz. Ekran bu sınırı
   * yazıyor.
   */
  minAmount?: number | null
  maxAmount?: number | null
  /**
   * Sınıflandırma. Gelen e-faturada kategori ALANI YOK: kategori seçilince
   * gelen kutusu kaynağı tümden dışarıda kalır (aksi halde kategorisi olmayan
   * satırlar filtreye rağmen listede kalırdı).
   */
  category?: string | null
  /** Kaynak başına satır tavanı. Dışa aktarma bunu yükseltir. */
  limit?: number
}

export type InvoiceListResult = {
  dateRange: { startDate: string; endDate: string }
  totals: {
    all: { count: number; sum: number }
    incoming: { count: number; sum: number }
    outgoing: { count: number; sum: number }
  }
  count: number
  data: InvoiceListRow[]
  /** Herhangi bir kaynak tavana dayandıysa true — çağıran uyarı gösterebilir. */
  truncated: boolean
  /**
   * Aralıktaki TÜM kategoriler — kategori filtresinden BAĞIMSIZ hesaplanır.
   * Listeden türetilseydi bir kategori seçildiği anda açılır kutuda yalnız o
   * kategori kalır ve kullanıcı başkasına geçemezdi.
   */
  categories: string[]
}

export async function fetchInvoiceList(options: InvoiceListOptions): Promise<InvoiceListResult> {
  const {
    companyId,
    direction = "all",
    includeInbox = true,
    days = 90,
    startDate,
    endDate,
    status,
    limit = INVOICE_LIST_DEFAULT_LIMIT,
  } = options
  const search = (options.search || "").trim()
  const counterparty = (options.counterparty || "").trim()
  const taxNumber = (options.taxNumber || "").trim()
  const category = (options.category || "").trim()
  const minAmount = options.minAmount ?? null
  const maxAmount = options.maxAmount ?? null

  /**
   * Durum süzgeci VİRGÜLLE ÇOKLU olabilir: "DRAFT,GIB_DRAFT".
   *
   * Tek değere kilitliyken "kesilmemiş satış faturaları"nı tek istekle sormak
   * mümkün değildi; oysa iş tarafında ikisi AYNI ŞEY — belge müşteriye gitmemiş
   * (K-BLG-04 kartı da ikisini birlikte sayıyor). Boş parçalar atılır, tek değer
   * eskisi gibi eşitlikle sorulur.
   */
  const statusList = (status || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  const statusWhere =
    statusList.length === 0
      ? {}
      : statusList.length === 1
        ? { status: statusList[0] }
        : { status: { in: statusList } }

  const end = endDate ? new Date(endDate) : new Date()
  const start = startDate
    ? new Date(startDate)
    : new Date(end.getTime() - Math.max(1, days) * 24 * 60 * 60 * 1000)

  /** Tutar aralığı — alan adı kaynağa göre değişiyor (gelen: payableAmount). */
  const amountFilter = (field: "payableAmount" | "totalAmount") =>
    minAmount === null && maxAmount === null
      ? {}
      : {
          [field]: {
            ...(minAmount !== null ? { gte: minAmount } : {}),
            ...(maxAmount !== null ? { lte: maxAmount } : {}),
          },
        }

  /**
   * Karşı taraf adı/VKN koşulu — ikisi de verilirse TEK `is` bloğunda AND'lenir.
   * Ayrı ayrı yazılsaydı (`{supplier:{name}}` + `{supplier:{taxNumber}}`) aynı
   * anahtar iki kez geçer ve ikincisi ilkini sessizce ezerdi.
   */
  const hasPartyFilter = Boolean(counterparty || taxNumber)
  const partyIs = () => ({
    ...(counterparty ? { name: { contains: counterparty, mode: "insensitive" as const } } : {}),
    ...(taxNumber ? { taxNumber: { contains: taxNumber } } : {}),
  })

  const out: InvoiceListRow[] = []
  let truncated = false

  // 1) Gelen — Mysoft InvoiceInbox (yalnızca includeInbox=true ise)
  // Kategori seçilmişse bu kaynak tümden atlanır: gelen e-faturada kategori alanı yok.
  if (direction !== "outgoing" && includeInbox && !category) {
    const incoming = await prisma.incomingInvoice.findMany({
      where: {
        companyId,
        docDate: { gte: start, lte: end },
        ...statusWhere,
        ...amountFilter("payableAmount"),
        // Koşullar AND dizisinde: "search" kendi OR'unu taşıdığı için düz nesne
        // yayılımıyla ikinci bir OR eklemek öncekini sessizce ezerdi.
        AND: [
          ...(search
            ? [
                {
                  OR: [
                    { invoiceNo: { contains: search, mode: "insensitive" as const } },
                    { senderName: { contains: search, mode: "insensitive" as const } },
                    { senderTaxNumber: { contains: search } },
                    { uuid: { contains: search } },
                  ],
                },
              ]
            : []),
          ...(counterparty
            ? [{ senderName: { contains: counterparty, mode: "insensitive" as const } }]
            : []),
          ...(taxNumber ? [{ senderTaxNumber: { contains: taxNumber } }] : []),
        ],
      },
      orderBy: [{ docDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: limit,
    })
    if (incoming.length >= limit) truncated = true
    for (const r of incoming) {
      out.push({
        id: `incoming:${r.id}`,
        slug: null,
        direction: "incoming",
        source: "mysoft_inbox",
        date: r.docDate ? r.docDate.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
        invoiceNo: r.invoiceNo,
        uuid: r.uuid,
        counterparty: { name: r.senderName, taxNumber: r.senderTaxNumber },
        currency: r.currencyCode,
        netAmount: r.taxExclusiveAmount ? Number(r.taxExclusiveAmount) : null,
        vatAmount: r.vatAmount ? Number(r.vatAmount) : null,
        totalAmount: r.payableAmount ? Number(r.payableAmount) : null,
        status: r.status,
        profile: r.profile,
        invoiceType: r.invoiceType,
        meta: {
          envelopeStatusCode: r.envelopeStatusCode,
          envelopeStatusDesc: r.envelopeStatusDesc,
          isArchived: r.isArchived,
          isLinkedToPurchase: r.isLinkedToPurchase,
          linkedInvoiceId: r.linkedInvoiceId,
          syncedAt: r.syncedAt.toISOString(),
        },
      })
    }
  }

  // 2) Manuel + içe aktarılmış alış — Invoice (type=PURCHASE)
  if (direction !== "outgoing") {
    const manualPurchases = await prisma.invoice.findMany({
      where: {
        companyId,
        type: "PURCHASE",
        isReceipt: false, // fişler bu listede değil; ayrı "Alış Fişleri" listesinde
        date: { gte: start, lte: end },
        ...statusWhere,
        ...(category ? { category } : {}),
        ...amountFilter("totalAmount"),
        AND: [
          ...(search
            ? [
                {
                  OR: [
                    { invoiceNo: { contains: search, mode: "insensitive" as const } },
                    {
                      supplier: {
                        is: { name: { contains: search, mode: "insensitive" as const } },
                      },
                    },
                    { supplier: { is: { taxNumber: { contains: search } } } },
                    { uuid: { contains: search } },
                  ],
                },
              ]
            : []),
          ...(hasPartyFilter ? [{ supplier: { is: partyIs() } }] : []),
        ],
      },
      include: { supplier: { select: { name: true, taxNumber: true } } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: limit,
    })
    if (manualPurchases.length >= limit) truncated = true

    // Hangi alış faturasının gelen e-faturadan dönüştürüldüğünü tespit et
    const purchaseIds = manualPurchases.map((p) => p.id)
    const linkedInbox =
      purchaseIds.length > 0
        ? await prisma.incomingInvoice.findMany({
            where: {
              companyId,
              linkedInvoiceId: { in: purchaseIds },
            },
            select: {
              linkedInvoiceId: true,
              uuid: true,
              profile: true,
              envelopeStatusCode: true,
              envelopeStatusDesc: true,
              syncedAt: true,
            },
          })
        : []
    const inboxByInvoiceId = new Map(
      linkedInbox.filter((x) => x.linkedInvoiceId).map((x) => [x.linkedInvoiceId as string, x]),
    )

    for (const r of manualPurchases) {
      const inbox = inboxByInvoiceId.get(r.id)
      const convertedFromInbox = Boolean(inbox)
      out.push({
        id: `invoice:${r.id}`,
        slug: r.slug,
        direction: "incoming",
        source: convertedFromInbox ? "converted_inbox" : "manual_purchase",
        date: r.date.toISOString(),
        createdAt: r.createdAt.toISOString(),
        invoiceNo: r.invoiceNo,
        uuid: r.uuid,
        counterparty: {
          name: r.supplier?.name ?? null,
          taxNumber: r.supplier?.taxNumber ?? null,
        },
        currency: r.currency,
        netAmount: Number(r.netAmount),
        vatAmount: Number(r.vatAmount),
        totalAmount: Number(r.totalAmount),
        status: r.status,
        profile: inbox?.profile ?? null,
        invoiceType: r.invoiceType,
        category: r.category ?? null,
        tags: r.tags ?? [],
        meta: {
          integrationStatus: r.integrationStatus,
          integrationId: r.integrationId,
          convertedFromInbox,
          inboxUuid: inbox?.uuid ?? null,
          envelopeStatusCode: inbox?.envelopeStatusCode ?? null,
          envelopeStatusDesc: inbox?.envelopeStatusDesc ?? null,
          syncedAt: inbox?.syncedAt ? inbox.syncedAt.toISOString() : null,
        },
      })
    }
  }

  // 3) Giden — bizim KESTİĞİMİZ belgeler: satış + iade (iki yön de). İade artık
  // e-Fatura olarak gönderilebiliyor; listede olmasaydı kullanıcı GİB'e yolladığı
  // belgeyi Kobipo'da hiçbir yerde bulamazdı.
  if (direction !== "incoming") {
    const sales = await prisma.invoice.findMany({
      where: {
        companyId,
        // `in` kullanılıyor, OR DEĞİL: aşağıdaki arama filtresi de `OR` anahtarı
        // koyuyor ve aynı nesnede ikinci `OR` birinciyi EZERDİ — arama yapıldığı
        // anda tip filtresi düşüp alış faturaları giden listesine sızardı.
        type: { in: ["SALES", "RETURN"] },
        isReceipt: false, // fişler bu listede değil; ayrı "Satış Fişleri" listesinde
        date: { gte: start, lte: end },
        ...statusWhere,
        ...(category ? { category } : {}),
        ...amountFilter("totalAmount"),
        AND: [
          ...(search
            ? [
                {
                  OR: [
                    { invoiceNo: { contains: search, mode: "insensitive" as const } },
                    { eDocumentNo: { contains: search, mode: "insensitive" as const } },
                    {
                      customer: {
                        is: { name: { contains: search, mode: "insensitive" as const } },
                      },
                    },
                    { customer: { is: { taxNumber: { contains: search } } } },
                    { uuid: { contains: search } },
                  ],
                },
              ]
            : []),
          // Karşı taraf müşteri VEYA tedarikçi olabilir: ALIŞ İADESİNİN karşı tarafı
          // tedarikçidir, yalnız müşteriye bakmak o satırı filtreden düşürürdü.
          ...(hasPartyFilter
            ? [{ OR: [{ customer: { is: partyIs() } }, { supplier: { is: partyIs() } }] }]
            : []),
        ],
      },
      // Tedarikçi de gerekli: ALIŞ İADESİNİN karşı tarafı tedarikçidir, yalnız
      // müşteriye bakan eski eşleme o satırı isimsiz gösterirdi.
      include: {
        customer: { select: { name: true, taxNumber: true } },
        supplier: { select: { name: true, taxNumber: true } },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: limit,
    })
    if (sales.length >= limit) truncated = true
    for (const r of sales) {
      out.push({
        id: `invoice:${r.id}`,
        slug: r.slug,
        direction: "outgoing",
        source: r.type === "RETURN" ? "manual_return" : "manual_sales",
        date: r.date.toISOString(),
        createdAt: r.createdAt.toISOString(),
        // GİB'e gönderim sonrası Mysoft'un atadığı resmi belge no (seçilen prefix
        // ile) varsa onu göster; yoksa iç seri numarası (SAT-...) gösterilir.
        invoiceNo: r.eDocumentNo || r.invoiceNo,
        uuid: r.uuid,
        counterparty: {
          name: r.customer?.name ?? r.supplier?.name ?? null,
          taxNumber: r.customer?.taxNumber ?? r.supplier?.taxNumber ?? null,
        },
        currency: r.currency,
        netAmount: Number(r.netAmount),
        vatAmount: Number(r.vatAmount),
        totalAmount: Number(r.totalAmount),
        status: r.status,
        profile: null,
        invoiceType: r.invoiceType,
        category: r.category ?? null,
        tags: r.tags ?? [],
        meta: {
          integrationStatus: r.integrationStatus,
          integrationId: r.integrationId,
          internalNo: r.invoiceNo,
        },
      })
    }
  }

  // Tarih azalan (en yeni önce). Aynı gün/tarihte ikincil anahtar olarak
  // createdAt azalan kullanılır — böylece sıralama deterministik olur.
  out.sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0
    const db = b.date ? new Date(b.date).getTime() : 0
    if (db !== da) return db - da
    const ca = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const cb = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return cb - ca
  })

  // Toplam metrikler
  const totals = {
    all: { count: out.length, sum: 0 },
    incoming: { count: 0, sum: 0 },
    outgoing: { count: 0, sum: 0 },
  }
  for (const r of out) {
    const amt = r.totalAmount || 0
    totals.all.sum += amt
    totals[r.direction].count += 1
    totals[r.direction].sum += amt
  }

  // Kategori seçenekleri: aralıktaki TÜM kategoriler, kategori filtresinden
  // bağımsız. Listeden türetilseydi bir kategori seçilir seçilmez açılır kutuda
  // yalnız o kategori kalır ve kullanıcı başkasına geçemezdi.
  const categoryGroups = await prisma.invoice.groupBy({
    by: ["category"],
    where: {
      companyId,
      isReceipt: false,
      date: { gte: start, lte: end },
      ...(direction === "incoming"
        ? { type: "PURCHASE" as const }
        : direction === "outgoing"
          ? { type: { in: ["SALES", "RETURN"] as const } }
          : {}),
      NOT: { category: null },
    },
  })
  const categories = categoryGroups
    .map((g) => (g.category || "").trim())
    .filter((c) => c.length > 0)
    .sort((a, b) => a.localeCompare(b, "tr"))

  return {
    dateRange: { startDate: start.toISOString(), endDate: end.toISOString() },
    totals,
    count: out.length,
    data: out,
    truncated,
    categories,
  }
}
