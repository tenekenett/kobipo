// Kobipo satış faturasının GERİ ALINMASI — sipariş iptal/red edildiğinde.
// Plan: docs/faturalandirma/PLAN.md (Faz 5)
//
// Belgenin nerede olduğuna göre üç ayrı yol vardır ve hiçbiri diğerinin yerine geçmez:
//
//   DRAFT      → belge yalnız Kobipo'da; silinir, iz kalmaz.
//   GIB_DRAFT  → Mysoft'ta taslak var, GİB'e GİTMEDİ; taslak geri alınır.
//   SENT       → belge GİB'dedir. e-Arşiv YALNIZ 24 saat içinde iptal edilebilir
//                (mevcut kural: app/api/e-donusum/invoices/[id]/cancel), e-Fatura ise
//                hiç iptal edilemez — iade faturası gerekir.
//
// Son durumda servis kendi başına bir şey UYDURMAZ: siparişe ve SystemLog'a ne
// yapılması gerektiğini yazar ve sistem-admin'e bırakır. Otomatik iade faturası
// kesmek, karşı tarafın defterini de ilgilendiren bir karardır.

import { prisma } from "@/lib/db/prisma"
import {
  COMPANY_PROVIDER_SELECT,
  resolveCompanyEInvoiceProvider,
} from "@/lib/integrations/e-invoice/company-provider"
import { assertEInvoiceRuntimeReady } from "@/lib/integrations/e-invoice/runtime-guard"
import { voidInvoice } from "@/lib/integrations/e-invoice/void-invoice"
import { discardGibDraft } from "@/lib/integrations/e-invoice/send-invoice-helper"
import type { IssueKind } from "@/lib/invoicing/issue-sales-invoice"

/** e-Arşiv iptal penceresi (saat) — mevcut iptal ucuyla AYNI kural. */
export const EARCHIVE_CANCEL_WINDOW_HOURS = 24

/** Belgenin durumuna göre izlenecek yol. Saf karar — yan etkisi yok, testlenebilir. */
export type VoidPlan =
  | { kind: "none" }
  | { kind: "delete-draft" }
  | { kind: "discard-gib-draft" }
  | { kind: "cancel" }
  | { kind: "manual"; why: "e-invoice" | "window-expired" }

/**
 * Bir satış faturasının nasıl geri alınacağına karar verir.
 *
 * Bu kararın yanlış olması pahalı: "iptal edilebilir" sanıp GİB'e gitmiş bir e-Faturayı
 * iptale çalışmak sağlayıcı hatasıyla döner ve sipariş yarım kalır; "iptal edilemez"
 * sanıp elde kalan 24 saatlik pencereyi kaçırmak ise iade faturası zorunluluğu doğurur.
 */
export function planInvoiceVoid(
  invoice: {
    status: string
    invoiceType: string
    /** Belgenin düzenlenme anı (createdAt; yoksa date). */
    issuedAt: Date
  } | null,
  now: Date = new Date(),
): VoidPlan {
  if (!invoice) return { kind: "none" }
  if (invoice.status === "CANCELLED") return { kind: "none" }
  // Yalnız Kobipo'da duran taslak — hiçbir yere gitmedi.
  if (invoice.status === "DRAFT") return { kind: "delete-draft" }
  // Mysoft'ta taslak var ama GİB'e GİTMEDİ.
  if (invoice.status === "GIB_DRAFT") return { kind: "discard-gib-draft" }
  // Buradan sonrası GİB'e gitmiş belge.
  if (invoice.invoiceType !== "E_ARCHIVE") return { kind: "manual", why: "e-invoice" }
  const hours = (now.getTime() - invoice.issuedAt.getTime()) / 3_600_000
  if (hours > EARCHIVE_CANCEL_WINDOW_HOURS) return { kind: "manual", why: "window-expired" }
  return { kind: "cancel" }
}

export type VoidResult =
  | { ok: true; action: "none" | "draft-deleted" | "draft-discarded" | "cancelled" }
  /** Belge iptal edilemedi; `instruction` sistem-admin'in ne yapması gerektiğini söyler. */
  | { ok: false; needsManual: true; instruction: string }
  | { ok: false; needsManual: false; error: string }

async function unlinkOrder(kind: IssueKind, orderId: string, note: string | null) {
  const data = { invoiceId: null, invoicedAt: null, invoiceError: note }
  if (kind === "KONTOR") {
    await prisma.kontorOrder.update({ where: { id: orderId }, data }).catch(() => {})
  } else {
    await prisma.packageOrder.update({ where: { id: orderId }, data }).catch(() => {})
  }
}

async function noteInstruction(kind: IssueKind, orderId: string, instruction: string) {
  const data = { invoiceError: instruction }
  if (kind === "KONTOR") {
    await prisma.kontorOrder.update({ where: { id: orderId }, data }).catch(() => {})
  } else {
    await prisma.packageOrder.update({ where: { id: orderId }, data }).catch(() => {})
  }
}

/**
 * Siparişe bağlı satış faturasını geri alır. Faturası yoksa sessizce başarılı döner —
 * çağıran taraf "bu siparişin faturası var mıydı" diye bilmek zorunda kalmasın.
 */
export async function voidSalesInvoiceForOrder(params: {
  kind: IssueKind
  orderId: string
  reason: string
  userId?: string | null
}): Promise<VoidResult> {
  const { kind, orderId, reason } = params

  const order =
    kind === "KONTOR"
      ? await prisma.kontorOrder.findUnique({
          where: { id: orderId },
          select: { invoiceId: true },
        })
      : await prisma.packageOrder.findUnique({
          where: { id: orderId },
          select: { invoiceId: true },
        })

  if (!order?.invoiceId) return { ok: true, action: "none" }

  const invoice = await prisma.invoice.findUnique({
    where: { id: order.invoiceId },
    select: {
      id: true,
      companyId: true,
      invoiceNo: true,
      eDocumentNo: true,
      uuid: true,
      status: true,
      invoiceType: true,
      date: true,
      createdAt: true,
    },
  })
  if (!invoice) {
    await unlinkOrder(kind, orderId, null)
    return { ok: true, action: "none" }
  }

  const plan = planInvoiceVoid(
    {
      status: invoice.status,
      invoiceType: invoice.invoiceType,
      issuedAt: invoice.createdAt ?? invoice.date,
    },
    new Date(),
  )
  if (plan.kind === "none") return { ok: true, action: "cancelled" }

  try {
    // Yalnız Kobipo'da duran taslak — silinir, hiçbir yere gitmedi.
    if (plan.kind === "delete-draft") {
      await prisma.invoice.delete({ where: { id: invoice.id } })
      await unlinkOrder(kind, orderId, null)
      return { ok: true, action: "draft-deleted" }
    }

    // Mysoft taslağı — GİB'e gitmedi, geri alınır.
    if (plan.kind === "discard-gib-draft") {
      const discarded = await discardGibDraft(invoice.id)
      if (!discarded.ok) {
        return { ok: false, needsManual: false, error: discarded.error }
      }
      await unlinkOrder(kind, orderId, null)
      return { ok: true, action: "draft-discarded" }
    }

    // Otomatik iptal edilemeyen iki hâl: e-Fatura ve süresi geçmiş e-Arşiv.
    // İkisinde de çözüm İADE FATURASIDIR ve bu, karşı tarafın defterini de
    // ilgilendirdiği için otomatik kesilmez — talimat sistem-admin'e bırakılır.
    if (plan.kind === "manual") {
      const belge = invoice.eDocumentNo || invoice.invoiceNo
      const instruction =
        plan.why === "e-invoice"
          ? `${belge} bir e-FATURA'dır ve iptal edilemez. Alıcıya İADE FATURASI kesilmesi gerekiyor (${reason}).`
          : `${belge} için ${EARCHIVE_CANCEL_WINDOW_HOURS} saatlik e-Arşiv iptal süresi doldu. ` +
            `İADE FATURASI kesilmesi gerekiyor (${reason}).`
      await noteInstruction(kind, orderId, instruction)
      await prisma.systemLog.create({
        data: {
          userId: params.userId ?? null,
          action: "SALES_INVOICE_VOID_MANUAL",
          entity: kind === "KONTOR" ? "KontorOrder" : "PackageOrder",
          details: `Sipariş ${orderId}: ${instruction}`,
          level: "WARNING",
        },
      })
      return { ok: false, needsManual: true, instruction }
    }

    if (!invoice.uuid) {
      return { ok: false, needsManual: false, error: "Faturanın ETTN'si yok; iptal edilemiyor." }
    }

    const company = await prisma.company.findUnique({
      where: { id: invoice.companyId },
      select: COMPANY_PROVIDER_SELECT,
    })
    assertEInvoiceRuntimeReady()
    const resolved = resolveCompanyEInvoiceProvider(company)
    if (!resolved.ok) return { ok: false, needsManual: false, error: resolved.error }

    const result = await resolved.provider.cancelInvoice(invoice.uuid, {
      cancelType: "PORTAL",
      cancelNote: reason,
      cancelDate: new Date().toISOString(),
    })
    if (!result.success) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { integrationStatus: `ERROR:İptal başarısız - ${result.error || "Bilinmeyen"}` },
      })
      return { ok: false, needsManual: false, error: result.error || "İptal başarısız" }
    }

    // Sağlayıcı iptali başarılı → yerel durumu CANCELLED yap. Cari/rapor sorguları
    // CANCELLED faturaları zaten hariç tutuyor, bakiye kendiliğinden düzelir.
    // Sipariş bağı KORUNUR: belge iptal edilmiş olsa da hangi siparişe ait olduğu izdir.
    await prisma.$transaction(async (tx) => {
      await voidInvoice(tx, {
        invoiceId: invoice.id,
        companyId: invoice.companyId,
        invoiceNo: invoice.invoiceNo,
        integrationStatus: "CANCELLED:IPTAL_EDILDI",
        createdBy: params.userId ?? null,
      })
    })

    await prisma.systemLog.create({
      data: {
        userId: params.userId ?? null,
        action: "SALES_INVOICE_VOID",
        entity: kind === "KONTOR" ? "KontorOrder" : "PackageOrder",
        details: `Sipariş ${orderId}: ${invoice.eDocumentNo || invoice.invoiceNo} iptal edildi (${reason})`,
        level: "INFO",
      },
    })

    return { ok: true, action: "cancelled" }
  } catch (e: any) {
    const message = e?.message || "Fatura geri alınırken beklenmeyen hata"
    console.error(`[faturalandirma] ${kind} ${orderId} fatura iptali hatası:`, e)
    return { ok: false, needsManual: false, error: message }
  }
}
