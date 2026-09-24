// Adisyonu SUNUCUDA kapatır: kapanış gövdesi → fiş → tahsilatlar → kapanış.
// Plan: docs/okc/ASAMA1-KOBIPO.md A5. Tüketicisi Aşama 2'de ÖKC webhook'udur:
// yazarkasa "ödendi" dediğinde ekran açık olmayabilir (garson masada cihazdan
// öder), fişi sunucu keser.
//
// YENİ BİR SATIŞ YOLU DEĞİLDİR. Ekranın bugün tarayıcıdan sırayla çağırdığı üç
// ucun ÇEKİRDEKLERİNİ aynı sırayla çağırır (lib/restoran/close-ticket.ts,
// lib/invoice/create-invoice.ts, lib/finans/create-invoice-payment.ts); stok,
// reçete, cari, muhasebe ve iskonto tavanı kuralları oradan gelir. Kanal seçimi
// istemciyle ortaktır (lib/satis/payment.ts → defaultPaymentAccounts).
//
// Yarıda kalma: adımlar tek işlem (transaction) DEĞİL — çekirdekler kendi
// işlemlerini yürütüyor. Fiş kesilip sonrası düşerse fiş adisyonun damgasıyla
// "sahipsiz" kalır; bir SONRAKİ çağrı onu bulur ve YENİDEN KULLANIR (ikinci fiş
// kesilmez, stok iki kez düşmez). Sahipsiz fişte kısmi tahsilat varsa bu fonksiyon
// tahmin yürütmez, durumu adıyla döndürür — sessiz geçilmez.

import { prisma } from "@/lib/db/prisma"
import type { WriteActor } from "@/lib/api/write-actor"
import { closeTicket, prepareTicketClose } from "@/lib/restoran/close-ticket"
import { createInvoiceFromBody } from "@/lib/invoice/create-invoice"
import { createInvoicePayment } from "@/lib/finans/create-invoice-payment"
import { accountForMethod, defaultPaymentAccounts } from "@/lib/satis/payment"

export type ServerPaymentPart = {
  /** CASH | CREDIT_CARD | MEAL_CARD | BANK_TRANSFER … (InvoicePayment.paymentMethod) */
  method: string
  amount: number
  /** Verilmezse yönteme göre varsayılan kanal (ekranla aynı kural). */
  accountId?: string | null
  notes?: string | null
  reference?: string | null
  paidAt?: Date
}

export type CloseWithReceiptResult =
  | {
      ok: true
      ticket: any
      invoiceId: string | null
      invoiceNo: string | null
      total: number
      paid: number
      /** Önceki yarım denemenin fişi kullanıldı (yeni fiş kesilmedi). */
      reusedInvoice: boolean
    }
  | {
      ok: false
      stage: "prepare" | "invoice" | "payment" | "close"
      status: number
      error: string
      /** Fiş kesildiyse id'si — sonraki deneme onu sahipsiz fiş olarak bulur. */
      invoiceId?: string
    }

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

async function json(res: Response): Promise<any> {
  return res.json().catch(() => ({}))
}

export async function closeTicketWithReceipt(args: {
  companyId: string
  ticketId: string
  actor: WriteActor
  payments: ServerPaymentPart[]
  warehouseId?: string | null
}): Promise<CloseWithReceiptResult> {
  const { companyId, ticketId, actor } = args

  // 1) Kapanış gövdesi (iskonto tavanı, ikram/zayi ayrımı, sahipsiz fiş araması burada).
  const prepRes = await prepareTicketClose(companyId, ticketId, actor.authorize)
  const prep = await json(prepRes)
  if (!prepRes.ok) {
    return { ok: false, stage: "prepare", status: prepRes.status, error: prep?.error || "Kapanış hazırlanamadı" }
  }

  // 2) Fiş — hesabın tamamı ikram/zayi ise fişsiz kapanış (payload null).
  let invoiceId: string | null = null
  let invoiceNo: string | null = null
  let total = 0
  let alreadyPaid = 0
  let reusedInvoice = false

  if (prep.invoicePayload) {
    if (prep.existingInvoice) {
      invoiceId = prep.existingInvoice.id
      invoiceNo = prep.existingInvoice.invoiceNo
      total = Number(prep.existingInvoice.total)
      reusedInvoice = true
      const paid = await prisma.invoicePayment.aggregate({
        where: { invoiceId: invoiceId!, companyId },
        _sum: { amount: true },
      })
      alreadyPaid = round2(Number(paid._sum.amount ?? 0))
    } else {
      const invRes = await createInvoiceFromBody(async () => ({ ...prep.invoicePayload }), actor)
      const invoice = await json(invRes)
      if (!invRes.ok) {
        return { ok: false, stage: "invoice", status: invRes.status, error: invoice?.error || "Fiş kesilemedi" }
      }
      invoiceId = invoice.id
      invoiceNo = invoice.invoiceNo ?? null
      total = Number(invoice.totalAmount)
    }
  }

  // 3) Tahsilat — tutar FİŞİN SUNUCUDA kayıtlı toplamına karşı ölçülür.
  const requested = round2(args.payments.reduce((s, p) => s + p.amount, 0))
  if (invoiceId) {
    if (requested > round2(total - alreadyPaid) + 0.01) {
      return {
        ok: false,
        stage: "payment",
        status: 409,
        error: `Tahsilat (${requested.toFixed(2)} ₺) fiş tutarını (${(total - alreadyPaid).toFixed(2)} ₺) aşıyor`,
        invoiceId,
      }
    }
    if (reusedInvoice && alreadyPaid > 0) {
      return {
        ok: false,
        stage: "payment",
        status: 409,
        error: `Önceki denemeden kalan ${invoiceNo ?? "fiş"} fişinde ${alreadyPaid.toFixed(2)} ₺ tahsilat var; elle kontrol edilmeli`,
        invoiceId,
      }
    }

    const accounts = await prisma.financialAccount.findMany({
      where: { companyId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, type: true },
    })
    const defaults = defaultPaymentAccounts(accounts)

    for (const part of args.payments) {
      if (!(part.amount > 0)) continue
      const payRes = await createInvoicePayment(
        async () => ({
          invoiceId,
          companyId,
          amount: round2(part.amount),
          paymentMethod: part.method,
          accountId: part.accountId ?? accountForMethod(part.method, defaults),
          reference: part.reference ?? undefined,
          notes: part.notes ?? undefined,
          paymentDate: (part.paidAt ?? new Date()).toISOString(),
        }),
        actor,
      )
      if (!payRes.ok) {
        const err = await json(payRes)
        return {
          ok: false,
          stage: "payment",
          status: payRes.status,
          error: err?.error || "Tahsilat yazılamadı",
          invoiceId: invoiceId ?? undefined,
        }
      }
    }
  } else if (requested > 0) {
    return { ok: false, stage: "payment", status: 400, error: "Fişsiz kapanışa tahsilat yazılamaz" }
  }

  // 4) Kapanış — fiş tutarı = hesap tutarı kapısı, ikram/zayi stoğu, masa damgası burada.
  const closeRes = await closeTicket(
    async () => ({ companyId, invoiceId: invoiceId ?? undefined, warehouseId: args.warehouseId ?? undefined }),
    ticketId,
    actor,
  )
  const closed = await json(closeRes)
  if (!closeRes.ok) {
    return {
      ok: false,
      stage: "close",
      status: closeRes.status,
      error: closed?.error || "Adisyon kapatılamadı",
      invoiceId: invoiceId ?? undefined,
    }
  }

  return {
    ok: true,
    ticket: closed,
    invoiceId,
    invoiceNo,
    total,
    paid: round2(alreadyPaid + requested),
    reusedInvoice,
  }
}
