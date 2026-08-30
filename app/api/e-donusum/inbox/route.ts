import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import {
  resolveCompanyEInvoiceProvider,
  COMPANY_PROVIDER_SELECT,
} from "@/lib/integrations/e-invoice/company-provider"
import { parseTrNumber } from "@/lib/format"
import {
  isForeignCurrency,
  roundKurus,
  toTryAmount,
} from "@/lib/integrations/e-invoice/incoming-amount"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Gelen e-fatura listesi.
 *
 * Default kaynak: DB (önceden sync ile çekilmiş kayıtlar). Hızlıdır, paginate edilebilir.
 * source=live verilirse Mysoft'a canlı çağrı yapar — DB'ye yazmaz, ham snapshot döner.
 *
 * Query params:
 *  - companyId   (zorunlu)
 *  - source      ("db" default | "live")
 *  - days        DB modunda son N gün; live modda çağrı aralığı (default 30)
 *  - startDate   ISO; verilirse days override
 *  - endDate     ISO
 *  - dateField   DB modunda aralığın uygulanacağı eksen:
 *                "docDate" (fatura tarihi, default) | "sentDate" (gönderilme tarihi)
 *  - raw         "1" → live modda Mysoft ham JSON da döner
 *
 * DB modunda detaylı filtreler (hepsi opsiyonel ve hepsi SUNUCUDA uygulanır —
 * sayfalama varken istemcide filtrelemek "aradığım fatura sayfada olmadığı için
 * bulunamıyor" demek olurdu):
 *  - status      "KABUL" | "RED" | "BEKLEMEDE" (terminal olmayan her durum)
 *  - profile     TEMELFATURA | TICARIFATURA | EARSIVFATURA ...
 *  - linked      "linked" | "unlinked" (alış faturasına dönüştürülmüş mü)
 *  - q           genel arama: fatura no / gönderici ünvanı / VKN / ETTN
 *  - sender      gönderici ünvanı içerir
 *  - taxNumber   gönderici VKN/TCKN içerir
 *  - minAmount / maxAmount   ödenecek tutar aralığı
 *  - page        1'den başlar (default 1)
 *  - pageSize    default 100, max 500
 */
export const GET = withApiErrors(async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const url = new URL(request.url)
    const companyId = await resolveCompanyId(url.searchParams.get("companyId"))
    if (!companyId) {
      return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    }

    await ensureCompanyAccess(companyId)

    const source = url.searchParams.get("source") === "live" ? "live" : "db"
    const days = Number(url.searchParams.get("days") || "30")
    const endParam = url.searchParams.get("endDate")
    const startParam = url.searchParams.get("startDate")
    const end = endParam ? new Date(endParam) : new Date()
    const start = startParam
      ? new Date(startParam)
      : new Date(end.getTime() - Math.max(1, days) * 24 * 60 * 60 * 1000)

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return NextResponse.json({ error: "Tarih aralığı geçersiz." }, { status: 400 })
    }
    if (start > end) {
      return NextResponse.json(
        { error: "Başlangıç tarihi bitiş tarihinden sonra olamaz." },
        { status: 400 },
      )
    }

    if (source === "db") {
      const trimmed = (key: string) => (url.searchParams.get(key) || "").trim()
      const statusParam = trimmed("status").toUpperCase()
      const profile = trimmed("profile")
      const linked = trimmed("linked")
      const q = trimmed("q")
      const sender = trimmed("sender")
      const taxNumber = trimmed("taxNumber")
      const minAmountRaw = trimmed("minAmount")
      const maxAmountRaw = trimmed("maxAmount")

      const page = Math.max(1, Number(url.searchParams.get("page") || "1") || 1)
      const pageSize = Math.min(
        500,
        Math.max(1, Number(url.searchParams.get("pageSize") || "100") || 100),
      )

      // Filtreler AND dizisinde toplanır: "q" kendi OR'unu taşıdığı için düz nesne
      // yayılımıyla birleştirmek (ikinci bir OR anahtarı) öncekini sessizce ezerdi.
      const and: Prisma.IncomingInvoiceWhereInput[] = []

      // Durum: KABUL/RED terminaldir, "BEKLEMEDE" = terminal OLMAYAN her şey. Mysoft
      // bekleyen için "YANIT_BEKLENIYOR" gibi farklı metinler döndürebiliyor, boş da
      // bırakabiliyor; düz eşitlik yazsaydık bekleyenlerin çoğu listeden düşerdi.
      const notStatus = (value: string): Prisma.IncomingInvoiceWhereInput => ({
        NOT: { status: { equals: value, mode: "insensitive" } },
      })
      if (statusParam === "BEKLEMEDE") {
        and.push({
          OR: [{ status: null }, { AND: [notStatus("KABUL"), notStatus("RED")] }],
        })
      } else if (statusParam) {
        and.push({ status: { equals: statusParam, mode: "insensitive" } })
      }

      if (profile) and.push({ profile })
      if (linked === "linked") and.push({ isLinkedToPurchase: true })
      if (linked === "unlinked") and.push({ isLinkedToPurchase: false })
      if (sender) and.push({ senderName: { contains: sender, mode: "insensitive" } })
      if (taxNumber) and.push({ senderTaxNumber: { contains: taxNumber } })
      // Sayıya çevrilemeyen tutar SESSİZCE YUTULMAZ. Önceden `Number.isFinite`
      // kontrolü tutmayan değeri atlıyordu: ekran "3 filtre uygulandı" derken
      // sunucu ikisini görmezden geliyor, kullanıcı da yanlış listeye bakıyordu.
      const minAmount = minAmountRaw ? parseTrNumber(minAmountRaw) : null
      const maxAmount = maxAmountRaw ? parseTrNumber(maxAmountRaw) : null
      if (minAmountRaw && minAmount === null) {
        return NextResponse.json(
          { error: "Tutar (min) sayı olmalı." },
          { status: 400 },
        )
      }
      if (maxAmountRaw && maxAmount === null) {
        return NextResponse.json(
          { error: "Tutar (max) sayı olmalı." },
          { status: 400 },
        )
      }
      if (minAmount !== null) {
        and.push({ payableAmount: { gte: new Prisma.Decimal(minAmount) } })
      }
      if (maxAmount !== null) {
        and.push({ payableAmount: { lte: new Prisma.Decimal(maxAmount) } })
      }
      if (q) {
        and.push({
          OR: [
            { invoiceNo: { contains: q, mode: "insensitive" } },
            { senderName: { contains: q, mode: "insensitive" } },
            { senderTaxNumber: { contains: q } },
            { uuid: { contains: q, mode: "insensitive" } },
          ],
        })
      }

      // Tarih aralığı hangi eksene uygulanacak: belge tarihi mi, zarfın GİB'e düştüğü
      // an mı? İkisi günlerce ayrışabiliyor (geçen ay düzenlenip bu hafta gönderilen
      // fatura), bu yüzden ölçüt kullanıcının seçimi.
      const dateField = url.searchParams.get("dateField") === "sentDate" ? "sentDate" : "docDate"
      const dateFilter = { gte: start, lte: end }

      const where: Prisma.IncomingInvoiceWhereInput = {
        companyId,
        ...(dateField === "sentDate" ? { sentDate: dateFilter } : { docDate: dateFilter }),
        ...(and.length ? { AND: and } : {}),
      }

      // Gönderilme tarihi Mysoft ham JSON'ından türetilir; alan hiç gelmemişse kolon
      // NULL kalır ve o kayıt bu eksende HİÇBİR aralığa düşmez. Sessizce kaybolmasın
      // diye sayısını da döndürüyoruz (ekran uyarı olarak gösterir).
      const missingSentDatePromise =
        dateField === "sentDate"
          ? prisma.incomingInvoice.count({
              where: { companyId, sentDate: null, ...(and.length ? { AND: and } : {}) },
            })
          : Promise.resolve(0)

      // Özet kartlar SAYFAYA DEĞİL filtrenin tamamına bakar; yoksa "sayfada 100 fatura"
      // ile "aralıkta 1.240 fatura" birbirine karışır ve toplamlar yanlış okunur.
      const [records, byStatus, linkedByCurrency, missingSentDate] = await Promise.all([
        prisma.incomingInvoice.findMany({
          where,
          // `raw` KASTEN dışarıda: fatura başına tam Mysoft JSON'u, 500 satırlık
          // sayfada boşuna megabaytlar demek. Gönderilme tarihi artık kolonda.
          select: {
            id: true,
            uuid: true,
            invoiceNo: true,
            docDate: true,
            sentDate: true,
            senderName: true,
            senderTaxNumber: true,
            profile: true,
            invoiceType: true,
            currencyCode: true,
            taxExclusiveAmount: true,
            vatAmount: true,
            payableAmount: true,
            status: true,
            envelopeStatusCode: true,
            envelopeStatusDesc: true,
            isArchived: true,
            isLinkedToPurchase: true,
            linkedInvoiceId: true,
            syncedAt: true,
          },
          orderBy:
            dateField === "sentDate"
              ? [{ sentDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }]
              : [{ docDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        // Para birimi ve kur da gruba giriyor: tutarlar faturanın KENDİ biriminde
        // saklanıyor, özet ise tek bir ₺ rakamı gösteriyor. Kur satır bazında
        // değiştiği için (aynı USD faturaları 46,99 ve 47,15 kurundan) yalnız
        // para birimine göre gruplamak yetmez — kur da anahtarın parçası. Böylece
        // toplam veritabanında hesaplanmaya devam eder, satırları çekmek gerekmez.
        prisma.incomingInvoice.groupBy({
          by: ["status", "currencyCode", "currencyRate"],
          where,
          _count: { _all: true },
          _sum: { payableAmount: true },
        }),
        prisma.incomingInvoice.groupBy({
          by: ["currencyCode", "currencyRate"],
          where: { AND: [where, { isLinkedToPurchase: true }] },
          _count: { _all: true },
          _sum: { payableAmount: true },
        }),
        missingSentDatePromise,
      ])

      // Tutarlar faturanın kendi para biriminde; özet tek bir ₺ rakamı gösterdiği
      // için kur ile çevriliyor. Kural ve gerekçesi: [[incoming-amount.ts]]
      const stats = {
        total: { count: 0, sum: 0 },
        accepted: { count: 0, sum: 0 },
        rejected: { count: 0, sum: 0 },
        pending: { count: 0, sum: 0 },
        linked: { count: 0, sum: 0 },
        // Özet ₺ cinsindendir; ekran bunu yazabilsin diye döviz kırılımı da gider.
        currency: { foreign: 0, unconverted: 0 },
      }
      for (const group of byStatus) {
        const count = group._count._all
        const { try: tryAmount, converted } = toTryAmount(
          group._sum.payableAmount,
          group.currencyRate,
          group.currencyCode,
        )
        const upper = (group.status || "").toUpperCase()
        const target =
          upper === "KABUL" ? stats.accepted : upper === "RED" ? stats.rejected : stats.pending
        target.count += count
        target.sum += tryAmount
        stats.total.count += count
        stats.total.sum += tryAmount
        if (isForeignCurrency(group.currencyCode)) {
          stats.currency.foreign += count
          if (!converted) stats.currency.unconverted += count
        }
      }
      for (const group of linkedByCurrency) {
        stats.linked.count += group._count._all
        stats.linked.sum += toTryAmount(
          group._sum.payableAmount,
          group.currencyRate,
          group.currencyCode,
        ).try
      }

      for (const bucket of [
        stats.total,
        stats.accepted,
        stats.rejected,
        stats.pending,
        stats.linked,
      ]) {
        bucket.sum = roundKurus(bucket.sum)
      }

      // Aralık boşsa: kayıt gerçekten yok mu, yoksa yalnız SEÇİLİ ARALIĞIN dışında
      // mı? İkisi kullanıcı için apayrı ("veri gelmemiş" ile "yanlış tarihe
      // bakıyorum") ama ekranda ikisi de boş tabloya benziyor. Filtreler korunur,
      // yalnız tarih koşulu düşürülür; sorgu SADECE boş sonuçta çalışır.
      let emptyHint: { latestDate: string | null; count: number } | null = null
      if (stats.total.count === 0) {
        const withoutDate: Prisma.IncomingInvoiceWhereInput = {
          companyId,
          ...(and.length ? { AND: and } : {}),
        }
        const [latest, countWithoutDate] = await Promise.all([
          prisma.incomingInvoice.findFirst({
            where: withoutDate,
            orderBy:
              dateField === "sentDate"
                ? [{ sentDate: { sort: "desc", nulls: "last" } }]
                : [{ docDate: { sort: "desc", nulls: "last" } }],
            select: { docDate: true, sentDate: true },
          }),
          prisma.incomingInvoice.count({ where: withoutDate }),
        ])
        const latestValue = dateField === "sentDate" ? latest?.sentDate : latest?.docDate
        emptyHint = {
          latestDate: latestValue ? latestValue.toISOString() : null,
          count: countWithoutDate,
        }
      }

      return NextResponse.json({
        source: "db",
        dateRange: { startDate: start.toISOString(), endDate: end.toISOString() },
        dateField,
        missingSentDate,
        emptyHint,
        count: records.length,
        total: stats.total.count,
        page,
        pageSize,
        pageCount: Math.max(1, Math.ceil(stats.total.count / pageSize)),
        stats,
        data: records.map((r) => ({
          id: r.id,
          uuid: r.uuid,
          invoiceNo: r.invoiceNo,
          date: r.docDate ? r.docDate.toISOString() : null,
          sentDate: r.sentDate ? r.sentDate.toISOString() : null,
          sender: { name: r.senderName, taxNumber: r.senderTaxNumber },
          profile: r.profile,
          invoiceType: r.invoiceType,
          currency: r.currencyCode,
          taxExclusiveAmount: r.taxExclusiveAmount,
          vatAmount: r.vatAmount,
          totalAmount: r.payableAmount,
          status: r.status,
          envelopeStatusCode: r.envelopeStatusCode,
          envelopeStatusDesc: r.envelopeStatusDesc,
          isArchived: r.isArchived,
          isLinkedToPurchase: r.isLinkedToPurchase,
          linkedInvoiceId: r.linkedInvoiceId,
          syncedAt: r.syncedAt.toISOString(),
        })),
      })
    }

    // source = live → Mysoft canlı (DB yazımı yok)
    assertEInvoiceRuntimeReady()
    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: COMPANY_PROVIDER_SELECT,
    })
    const resolved = resolveCompanyEInvoiceProvider(company)
    if (!resolved.ok) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status })
    }
    const provider = resolved.provider

    const wantRaw = url.searchParams.get("raw") === "1"
    const result = await provider.listIncomingInvoices({
      startDate: start,
      endDate: end,
      raw: wantRaw,
    })

    if (!result.success) {
      return NextResponse.json(
        { error: result.error, rawResponse: result.rawResponse ?? null },
        { status: 400 },
      )
    }

    return NextResponse.json({
      source: "live",
      dateRange: { startDate: start.toISOString(), endDate: end.toISOString() },
      count: result.data.length,
      // 90 günlük pencerelerden biri alınamadıysa liste EKSİKTİR — sessizce geçme.
      warnings: result.warnings ?? [],
      data: result.data,
      rawResponse: wantRaw ? result.rawResponse ?? null : undefined,
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("inbox route error:", error)
    return NextResponse.json(
      { error: message || "Gelen fatura listesi alınırken hata oluştu." },
      { status: 500 },
    )
  }
})
