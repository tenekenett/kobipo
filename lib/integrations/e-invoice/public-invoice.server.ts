import { prisma } from "@/lib/db/prisma"
import { resolvePublicInvoice, type PublicInvoiceData } from "./public-invoice"

/**
 * Kamu faturası — gönderim anında okuma (kural `public-invoice.ts`te).
 *
 * İki gönderim yolu (send-invoice-helper: taslak/önizleme/kesinleştirme ve
 * create-invoice: oluştururken gönder) AYNI fonksiyonu çağırır; biri atlanırsa kamu
 * faturası o yoldan yine IBAN'sız gider.
 *
 * "Kamu mu?" = GİB kaydı (`gibUserType = 2`) YA DA kartın bayrağı. GİB kamu derse
 * bayrak kalıcı olarak basılır (ekranda rozet; sonraki GİB sorgusu düşse bile belge
 * IBAN'lı gider). GİB "özel" derse elle açılmış bayrak SİLİNMEZ — kullanıcının kararı.
 * GİB sorgusu yapılamazsa yalnız bayrağa bakılır ve sebep loglanır; Mysoft yine
 * reddederse hata eki (`publicInvoiceErrorHint`) ne yapılacağını söyler.
 */

type GibCheck = { success?: boolean; data?: { isPublicInstitution?: boolean } | null } | null | undefined

export type PublicReceiver = {
  id: string
  taxNumber: string | null
  /** Yalnız müşteri kartında var; tedarikçi (alış iadesi) alıcısında undefined. */
  isPublicInstitution?: boolean
  publicPaymentAccountId?: string | null
  publicPayeeVkn?: string | null
  publicPayeeName?: string | null
  publicPayeeCity?: string | null
  publicPayeeDistrict?: string | null
}

export async function resolvePublicInvoiceForSend(args: {
  provider: unknown
  /** Faturayı kesen firma — IBAN'ı belgeye girecek hesaplar onundur. */
  companyId: string
  invoiceType: "E_INVOICE" | "E_ARCHIVE" | string
  receiver: PublicReceiver | null | undefined
  /** Alıcı müşteri kartı mı (bayrak yalnız orada basılır). */
  receiverIsCustomer: boolean
  /** Aynı istekte yapılmış GİB sorgusu varsa ikinci kez sorulmaz. */
  gibCheck?: GibCheck
}): Promise<{ ok: true; data: PublicInvoiceData | null } | { ok: false; error: string }> {
  // e-Arşiv'de kamu senaryosu yok; kamu kurumu e-Fatura mükellefidir.
  if (args.invoiceType !== "E_INVOICE" || !args.receiver) return { ok: true, data: null }
  const receiver = args.receiver

  let gibSaysPublic = false
  const vkn = String(receiver.taxNumber || "").replace(/\D/g, "")
  if (/^\d{10,11}$/.test(vkn)) {
    let gib = args.gibCheck
    if (gib === undefined && typeof (args.provider as any)?.getGibAccount === "function") {
      try {
        gib = await (args.provider as any).getGibAccount(vkn)
      } catch (e: any) {
        console.warn(`[kamu-faturasi] GİB sorgusu başarısız (VKN ${vkn}): ${e?.message}`)
        gib = null
      }
    }
    if (gib?.success) {
      gibSaysPublic = Boolean(gib.data?.isPublicInstitution)
    } else if (gib !== undefined) {
      console.warn(`[kamu-faturasi] GİB kaydı okunamadı (VKN ${vkn}); yalnız kartın kamu bayrağına bakılıyor.`)
    }
  }

  if (gibSaysPublic && args.receiverIsCustomer && !receiver.isPublicInstitution) {
    try {
      await prisma.customer.update({ where: { id: receiver.id }, data: { isPublicInstitution: true } })
    } catch (e: any) {
      // Bayrak yalnız rozet ve yedek içindir; bu gönderim GİB cevabıyla zaten kamu.
      console.warn(`[kamu-faturasi] Müşteri ${receiver.id} kamu olarak işaretlenemedi: ${e?.message}`)
    }
  }

  const isPublic = gibSaysPublic || Boolean(receiver.isPublicInstitution)
  if (!isPublic) return { ok: true, data: null }

  const accounts = await prisma.financialAccount.findMany({
    where: { companyId: args.companyId },
    select: { id: true, name: true, type: true, iban: true, currency: true, isActive: true },
    orderBy: { name: "asc" },
  })

  return resolvePublicInvoice({
    isPublic,
    selectedAccountId: receiver.publicPaymentAccountId ?? null,
    accounts,
    payee: args.receiverIsCustomer
      ? {
          vkn: receiver.publicPayeeVkn,
          name: receiver.publicPayeeName,
          city: receiver.publicPayeeCity,
          district: receiver.publicPayeeDistrict,
        }
      : null,
  })
}
