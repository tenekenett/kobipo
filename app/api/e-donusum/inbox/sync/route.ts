import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { getCurrentUser } from "@/lib/auth/session"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyWrite } from "@/lib/middleware/company"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import {
  resolveCompanyEInvoiceProvider,
  COMPANY_PROVIDER_SELECT,
} from "@/lib/integrations/e-invoice/company-provider"
import { voidInvoice } from "@/lib/integrations/e-invoice/void-invoice"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * Mysoft'tan gelen e-faturaları çekip DB'ye upsert eder.
 *
 * Body (opsiyonel):
 *  - companyId  (zorunlu)
 *  - days       (default 30)  — son N gün
 *  - startDate  (ISO)         — verilirse days override
 *  - endDate    (ISO)
 *
 * Davranış:
 *  - (companyId, uuid) unique → mevcut kayıtlar update edilir
 *  - Yeni kayıtlar insert edilir
 *  - Status/tutar gibi alanlar Mysoft'ta değiştiyse yansır
 *  - rawJson hep güncellenir (Mysoft yanıtının tamamı)
 *  - isLinkedToPurchase + linkedInvoiceId Kobipo iç akışı — sync sırasında DOKUNULMAZ
 */
export const POST = withApiErrors(async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const { days, startDate: rawStart, endDate: rawEnd } = body || {}
    // companyId dashboard'dan slug gelebilir → cuid'e çevir. [[resolve-company.ts]]
    const companyId = await resolveCompanyId(body?.companyId)
    if (!companyId) {
      return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    }

    await ensureCompanyWrite(companyId)
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

    const end = rawEnd ? new Date(rawEnd) : new Date()
    const daysNum = Number(days) > 0 ? Number(days) : 30
    const start = rawStart
      ? new Date(rawStart)
      : new Date(end.getTime() - daysNum * 24 * 60 * 60 * 1000)

    const result = await provider.listIncomingInvoices({
      startDate: start,
      endDate: end,
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    // KDV oran dağılımı: Mysoft'un raw'ı içinde vatTotalTra0..20 ve
    // taxableVatTotalTra0..20 anahtarları var. Hepsini JSON olarak saklayıp
    // KDV beyanname raporlarında kullanabiliyoruz.
    const extractVatBreakdown = (raw: any): Record<string, number> => {
      const out: Record<string, number> = {}
      if (!raw || typeof raw !== "object") return out
      for (const key of Object.keys(raw)) {
        if (/^(vatTotalTra|taxableVatTotalTra)\d+$/.test(key)) {
          const v = Number(raw[key])
          if (Number.isFinite(v) && v !== 0) out[key] = v
        }
      }
      return out
    }

    let inserted = 0
    let updated = 0
    let skipped = 0
    let voidedLinked = 0
    const errors: Array<{ uuid: string; error: string }> = []

    // Mevcut kayıtları TEK sorguda oku. Önceden her fatura için ayrı findUnique
    // atılıyordu; sayfalama düzeltmesiyle liste 100'den ~500'e çıkınca bu, istek
    // başına yüzlerce gereksiz gidiş-dönüş demekti (senkron dakikalara uzuyordu).
    const uuids = result.data.map((r) => r.uuid).filter((u): u is string => Boolean(u))
    const existingRows = await prisma.incomingInvoice.findMany({
      where: { companyId, uuid: { in: uuids } },
      select: { uuid: true, status: true, linkedInvoiceId: true },
    })
    const existingByUuid = new Map(existingRows.map((r) => [r.uuid, r]))

    const processRow = async (row: (typeof result.data)[number]) => {
      if (!row.uuid) {
        skipped++
        return
      }
      try {
        // Yerel yanıt durumunu (KABUL/RED) koru: uygulama içinden Kabul/Reddet
        // yaptıktan sonra Mysoft bunu HEMEN yansıtmayabilir (propagasyon gecikmesi).
        // O aralıkta gelen non-terminal status ("YANIT_BEKLENIYOR" vb.) yerel yanıtı
        // GERİ EZERSE: (1) Kabul/Reddet butonları yeniden açılır, (2) daha kötüsü
        // "reddedilmiş fatura dönüştürülemez" koruması (status==='RED') bypass olup
        // reddedilen faturadan yeniden borç yaratılabilir. Bu yüzden yerelde KABUL/RED
        // varken, Mysoft henüz terminal (KABUL/RED) döndürmediyse yereli koruyoruz.
        const existing = existingByUuid.get(row.uuid)
        const localStatusUpper = (existing?.status || "").toUpperCase()
        const incomingStatusUpper = (row.status || "").toUpperCase()
        const localIsTerminal = localStatusUpper === "KABUL" || localStatusUpper === "RED"
        const incomingIsTerminal =
          incomingStatusUpper === "KABUL" || incomingStatusUpper === "RED"
        const effectiveStatus =
          localIsTerminal && !incomingIsTerminal ? existing!.status : row.status

        const data: Prisma.IncomingInvoiceUpsertArgs["create"] = {
          companyId,
          uuid: row.uuid,
          invoiceNo: row.invoiceNo,
          docDate: row.date ? new Date(row.date) : null,
          senderTaxNumber: row.sender.taxNumber,
          senderName: row.sender.name,
          profile: row.profile,
          invoiceType: row.invoiceType,
          currencyCode: row.currency,
          currencyRate: row.currencyRate !== null ? new Prisma.Decimal(row.currencyRate) : null,
          taxExclusiveAmount:
            row.taxExclusiveAmount !== null ? new Prisma.Decimal(row.taxExclusiveAmount) : null,
          taxInclusiveAmount:
            row.taxInclusiveAmount !== null ? new Prisma.Decimal(row.taxInclusiveAmount) : null,
          vatAmount: row.vatAmount !== null ? new Prisma.Decimal(row.vatAmount) : null,
          payableAmount: row.totalAmount !== null ? new Prisma.Decimal(row.totalAmount) : null,
          vatBreakdown: extractVatBreakdown(row.raw),
          status: effectiveStatus,
          envelopeStatusCode: row.envelopeStatusCode,
          envelopeStatusDesc: row.envelopeStatusDesc,
          isArchived: row.isArchived,
          raw: row.raw as Prisma.InputJsonValue,
          syncedAt: new Date(),
        }
        // Update'te isLinkedToPurchase + linkedInvoiceId kasten dışarıda — Kobipo iç akışı.
        const { companyId: _c, uuid: _u, ...updateData } = data
        const result2 = await prisma.incomingInvoice.upsert({
          where: { companyId_uuid: { companyId, uuid: row.uuid } },
          create: data,
          update: updateData,
        })
        // Insert mi update mi? createdAt = updatedAt ise insert, değilse update.
        if (result2.createdAt.getTime() === result2.updatedAt.getTime()) {
          inserted++
        } else {
          updated++
        }

        // Gelen fatura RED (reddedilmiş) ve daha önce bir alış faturasına
        // dönüştürülmüşse (borç oluşturmuşsa), o faturayı da geçersiz kıl:
        // stok geri al + status=CANCELLED → tedarikçi borcu cariden otomatik düşer.
        // Bu, red işlemi uygulama içi "Reddet" (respond route) yerine doğrudan
        // GİB/portal üzerinden yapıldığında da borcun düşmesini garanti eder.
        // voidInvoice idempotenttir; zaten CANCELLED olan atlanır.
        if (
          (result2.status || "").toUpperCase() === "RED" &&
          result2.linkedInvoiceId
        ) {
          const linked = await prisma.invoice.findUnique({
            where: { id: result2.linkedInvoiceId },
            select: { id: true, status: true, invoiceNo: true },
          })
          if (linked && linked.status !== "CANCELLED") {
            await prisma.$transaction(async (tx) => {
              await voidInvoice(tx, {
                invoiceId: linked.id,
                companyId,
                invoiceNo: linked.invoiceNo,
                integrationStatus: "REJECTED:RED",
                createdBy: user.id,
              })
            })
            voidedLinked++
          }
        }
      } catch (e: any) {
        errors.push({ uuid: row.uuid, error: e?.message || "upsert error" })
      }
    }

    // Yazmaları sınırlı eşzamanlılıkla çalıştır. Tamamen sırayla gitmek ~500 kayıtta
    // dakikalar sürüyordu; sınırsız Promise.all ise bağlantı havuzunu tüketir.
    const CONCURRENCY = 10
    for (let i = 0; i < result.data.length; i += CONCURRENCY) {
      await Promise.all(result.data.slice(i, i + CONCURRENCY).map(processRow))
    }

    return NextResponse.json({
      dateRange: { startDate: start.toISOString(), endDate: end.toISOString() },
      fetched: result.data.length,
      inserted,
      updated,
      skipped,
      voidedLinked,
      errors,
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("inbox sync error:", error)
    return NextResponse.json(
      { error: message || "Sync sırasında hata oluştu." },
      { status: 500 },
    )
  }
})
