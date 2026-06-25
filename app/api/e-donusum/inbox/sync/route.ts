import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import { MysoftEInvoiceProvider } from "@/lib/integrations/e-invoice/mysoft-provider"
import { decryptSecret } from "@/lib/crypto/secrets"
import { effectiveTenantVkn } from "@/lib/integrations/e-invoice/tenant"

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
export async function POST(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json().catch(() => ({}))
    const { companyId, days, startDate: rawStart, endDate: rawEnd } = body || {}
    if (!companyId) {
      return NextResponse.json({ error: "companyId zorunlu" }, { status: 400 })
    }

    await ensureCompanyAccess(companyId)
    assertEInvoiceRuntimeReady()

    const company = await prisma.company.findUnique({
      where: { id: companyId },
      select: {
        eDonusumApiUsername: true,
        eDonusumApiPassword: true,
        eDonusumApiUrl: true,
        taxNumber: true,
        eDonusumTenantVkn: true,
        parentCompany: { select: { taxNumber: true } },
      },
    })
    if (!company?.eDonusumApiUsername || !company?.eDonusumApiPassword) {
      return NextResponse.json(
        { error: "Önce E-Dönüşüm Ayarları'na API kullanıcı adı/şifresini yazıp kaydedin." },
        { status: 400 },
      )
    }

    let passwordText: string
    try {
      passwordText = decryptSecret(company.eDonusumApiPassword)
    } catch {
      return NextResponse.json(
        { error: "Kayıtlı şifre çözülemedi. Şifreyi tekrar girip kaydedin." },
        { status: 400 },
      )
    }

    const end = rawEnd ? new Date(rawEnd) : new Date()
    const daysNum = Number(days) > 0 ? Number(days) : 30
    const start = rawStart
      ? new Date(rawStart)
      : new Date(end.getTime() - daysNum * 24 * 60 * 60 * 1000)

    const provider = new MysoftEInvoiceProvider({
      username: company.eDonusumApiUsername,
      passwordText,
      baseUrl: company.eDonusumApiUrl || undefined,
      vknTckn: effectiveTenantVkn(company) || undefined,
    })

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
    const errors: Array<{ uuid: string; error: string }> = []

    for (const row of result.data) {
      if (!row.uuid) {
        skipped++
        continue
      }
      try {
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
          status: row.status,
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
      } catch (e: any) {
        errors.push({ uuid: row.uuid, error: e?.message || "upsert error" })
      }
    }

    return NextResponse.json({
      dateRange: { startDate: start.toISOString(), endDate: end.toISOString() },
      fetched: result.data.length,
      inserted,
      updated,
      skipped,
      errors,
    })
  } catch (error: any) {
    const message: string = typeof error?.message === "string" ? error.message : ""
    if (message.toLowerCase().includes("access denied")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 })
    }
    console.error("inbox sync error:", error)
    return NextResponse.json(
      { error: message || "Sync sırasında hata oluştu." },
      { status: 500 },
    )
  }
}
