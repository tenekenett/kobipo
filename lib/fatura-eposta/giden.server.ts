import { after } from "next/server"
import { prisma } from "@/lib/db/prisma"
import { sendEmail, type EmailAttachment } from "@/lib/email/resend"
import { gidenFaturaEmail } from "@/lib/email/templates"
import {
  resolveCompanyEInvoiceProvider,
  COMPANY_PROVIDER_SELECT,
} from "@/lib/integrations/e-invoice/company-provider"
import {
  ADRES_SEBEP_METNI,
  belgeTuruAdi,
  faturaEpostaAdresi,
  gidenGonderilebilir,
  MAX_DENEME,
  SAHIPLENME_ZAMAN_ASIMI_DK,
} from "./kurallar"
import { hesapKurucusuBul } from "./kurucu.server"

/**
 * GİDEN FATURA E-POSTASI — GİB'e giden e-belge, carinin e-postasına PDF + UBL XML ekli.
 *
 * Üç tetikleyici, tek fonksiyon:
 *   1. Belge GİB'e gittiği an (finalizeGibDraft, createInvoiceFromBody) → `gidenFaturaEpostasiArkaPlanda`
 *   2. Zamanlanmış tarama (`bekleyenGidenEpostalar`) — 1. adımı kaçıran ya da hata alan belge
 *   3. Elle "E-postayla gönder" (MANUAL) — alıcı değiştirilebilir, firma anahtarı sorulmaz
 *
 * OTOMATİK gönderim fatura başına TEKTİR: `invoice_email_logs.autoKey` benzersizdir ve
 * kaydı yazan sahiplenir. Hata kaydı da kayıttır (HATA + deneme sayısı) — tarama onu
 * yeniden dener, deneme hakkı bitince kayıt HATA'da kalır ve faturada görünür.
 */

export type GidenSonuc =
  | { ok: true; status: "GONDERILDI"; recipients: string[]; logId: string }
  | {
      ok: false
      status: "ALICI_YOK" | "KAPALI" | "HATA" | "UYGUN_DEGIL" | "SAHIPLI"
      error: string
      logId?: string
    }

type Tetik = { kind: "AUTO" } | { kind: "MANUAL"; to?: string; actorUserId: string }


function tutarMetni(amount: unknown, currency: string | null | undefined): string {
  const n = Number(amount ?? 0)
  try {
    return new Intl.NumberFormat("tr-TR", { style: "currency", currency: currency || "TRY" }).format(n)
  } catch {
    return `${n.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${currency || "TRY"}`
  }
}

/** `invoices.date` 00:00 UTC'dir; İstanbul'a çevirmek günü kaydırmaz ama UTC ile basmak en güvenlisi. */
function tarihMetni(d: Date): string {
  return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" })
}

/**
 * OTOMATİK gönderim hakkını sahiplenir. Döner: kaydın id'si ve bu kaçıncı deneme,
 * ya da null (başkası sahiplendi / zaten gönderildi / kapandı).
 */
async function otomatikSahiplen(invoiceId: string, companyId: string): Promise<{ id: string; attempts: number } | null> {
  try {
    const row = await prisma.invoiceEmailLog.create({
      data: { companyId, invoiceId, autoKey: invoiceId, kind: "AUTO", status: "GONDERILIYOR", attempts: 1 },
      select: { id: true, attempts: true },
    })
    return row
  } catch (error: any) {
    if (error?.code !== "P2002") throw error
  }
  // Kayıt var: yalnız HATA (hakkı bitmemiş) ya da zaman aşımına uğramış GONDERILIYOR
  // yeniden denenir. Koşullu UPDATE tek cümle — iki tarama aynı satırı alamaz.
  const existing = await prisma.invoiceEmailLog.findUnique({
    where: { autoKey: invoiceId },
    select: { id: true, status: true, attempts: true, updatedAt: true },
  })
  if (!existing) return null
  const stale = new Date(Date.now() - SAHIPLENME_ZAMAN_ASIMI_DK * 60_000)
  const claimed = await prisma.invoiceEmailLog.updateMany({
    where: {
      id: existing.id,
      attempts: { lt: MAX_DENEME },
      OR: [{ status: "HATA" }, { status: "GONDERILIYOR", updatedAt: { lt: stale } }],
    },
    data: { status: "GONDERILIYOR", attempts: { increment: 1 } },
  })
  return claimed.count === 1 ? { id: existing.id, attempts: existing.attempts + 1 } : null
}

async function kapat(
  logId: string,
  data: { status: string; error?: string | null; recipient?: string | null; messageId?: string | null },
) {
  await prisma.invoiceEmailLog.update({
    where: { id: logId },
    data: {
      status: data.status,
      error: data.error ?? null,
      ...(data.recipient !== undefined ? { recipient: data.recipient } : {}),
      ...(data.messageId !== undefined ? { messageId: data.messageId } : {}),
    },
  })
}

export async function gidenFaturaEpostasi(invoiceId: string, tetik: Tetik): Promise<GidenSonuc> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      companyId: true,
      type: true,
      invoiceType: true,
      status: true,
      uuid: true,
      isReceipt: true,
      invoiceNo: true,
      eDocumentNo: true,
      date: true,
      totalAmount: true,
      currency: true,
      customer: { select: { name: true, email: true } },
      supplier: { select: { name: true, email: true } },
      company: {
        select: {
          ...COMPANY_PROVIDER_SELECT,
          name: true,
          email: true,
          invoiceEmailAuto: true,
          parentCompany: { select: { ...COMPANY_PROVIDER_SELECT.parentCompany.select, email: true } },
        },
      },
    },
  })
  if (!invoice) return { ok: false, status: "UYGUN_DEGIL", error: "Fatura bulunamadı." }

  const uygun = gidenGonderilebilir(invoice)
  if (!uygun.ok) return { ok: false, status: "UYGUN_DEGIL", error: uygun.sebep }

  // Sahiplenme / kayıt
  let logId: string
  if (tetik.kind === "AUTO") {
    const claim = await otomatikSahiplen(invoice.id, invoice.companyId)
    if (!claim) return { ok: false, status: "SAHIPLI", error: "Bu fatura için otomatik e-posta zaten işlendi." }
    logId = claim.id
    if (!invoice.company.invoiceEmailAuto) {
      const error = "Firmada otomatik fatura e-postası kapalı."
      await kapat(logId, { status: "KAPALI", error })
      return { ok: false, status: "KAPALI", error, logId }
    }
  } else {
    const row = await prisma.invoiceEmailLog.create({
      data: {
        companyId: invoice.companyId,
        invoiceId: invoice.id,
        kind: "MANUAL",
        status: "GONDERILIYOR",
        attempts: 1,
        createdBy: tetik.actorUserId,
      },
      select: { id: true },
    })
    logId = row.id
  }

  try {
    // Alıcı: elle verilen adres > belgenin carisi (iade belgesinde tedarikçi).
    const cari = invoice.customer ?? invoice.supplier
    const hamAdres = tetik.kind === "MANUAL" && tetik.to?.trim() ? tetik.to : cari?.email
    const adres = faturaEpostaAdresi(hamAdres)
    if (!adres.ok) {
      const error =
        tetik.kind === "MANUAL" && tetik.to?.trim() ? "Girilen e-posta adresi geçerli değil." : ADRES_SEBEP_METNI[adres.sebep]
      await kapat(logId, { status: "ALICI_YOK", error, recipient: hamAdres?.trim() || null })
      return { ok: false, status: "ALICI_YOK", error, logId }
    }

    const resolved = resolveCompanyEInvoiceProvider(invoice.company)
    if (!resolved.ok) throw new Error(resolved.error)
    const provider = resolved.provider

    const pdf = await provider.getInvoicePdf(invoice.uuid!)
    if (!pdf.success) throw new Error(`Resmî PDF alınamadı: ${pdf.error}`)

    const docNo = (invoice.eDocumentNo || invoice.invoiceNo || "").trim()
    // Ek adı belge numarasıdır (Mysoft zip'teki ad ETTN; müşteri için anlamsız).
    const dosyaAdi = (docNo || invoice.uuid!).replace(/[^\w.-]+/g, "_")
    const pdfName = `${dosyaAdi}.pdf`
    const attachments: EmailAttachment[] = [{ filename: pdfName, content: pdf.pdfBuffer, contentType: "application/pdf" }]

    // XML ek bilgidir: alınamazsa mail PDF'le gider, not kayda düşer.
    let not: string | null = null
    const xml = await provider.getOutgoingInvoiceUblXml(invoice.uuid!)
    if (xml.success) {
      attachments.push({
        filename: `${dosyaAdi}.xml`,
        content: Buffer.from(xml.xml, "utf8"),
        contentType: "application/xml",
      })
    } else {
      not = `XML eklenemedi: ${xml.error}`
    }

    const firmaEposta = (invoice.company.email || invoice.company.parentCompany?.email || "").trim()
    const replyTo = firmaEposta || (await hesapKurucusuBul(invoice.companyId)).kurucu?.email || undefined
    const label = belgeTuruAdi(invoice.invoiceType, invoice.type)
    const { subject, html } = gidenFaturaEmail({
      companyName: invoice.company.name,
      customerName: cari?.name ?? null,
      documentLabel: label,
      documentNo: docNo,
      dateLabel: tarihMetni(invoice.date),
      amountLabel: tutarMetni(invoice.totalAmount, invoice.currency),
      ettn: invoice.uuid!,
      isEInvoice: invoice.invoiceType === "E_INVOICE",
      canReply: Boolean(replyTo),
    })

    const sent = await sendEmail({
      to: adres.adresler,
      subject,
      html,
      fromName: invoice.company.name,
      ...(replyTo ? { replyTo } : {}),
      attachments,
    })
    if (!sent.ok) {
      throw new Error(sent.skipped ? "E-posta servisi yapılandırılmamış (RESEND_API_KEY yok)." : sent.error || "E-posta gönderilemedi.")
    }

    await kapat(logId, {
      status: "GONDERILDI",
      error: not,
      recipient: adres.adresler.join(", "),
      messageId: sent.id ?? null,
    })
    return { ok: true, status: "GONDERILDI", recipients: adres.adresler, logId }
  } catch (error: any) {
    const message = error?.message || "E-posta gönderilemedi."
    console.error(`[fatura-eposta] giden ${invoiceId} (${tetik.kind}):`, message)
    await kapat(logId, { status: "HATA", error: message }).catch((e) =>
      console.error(`[fatura-eposta] kayıt kapatılamadı ${logId}:`, e),
    )
    return { ok: false, status: "HATA", error: message, logId }
  }
}

/**
 * Belge GİB'e gittikten SONRA, yanıtı bekletmeden otomatik maili dener. Mysoft'tan
 * PDF/XML çekmek ve göndermek birkaç saniye sürer; kullanıcı faturasını beklemesin.
 *
 * `after` istek kapsamı dışında (betik, test) fırlatır → o zaman doğrudan çalışır.
 * Fırlatmaz: buradaki her hata kayda yazılır, zamanlanmış tarama yeniden dener.
 */
export function gidenFaturaEpostasiArkaPlanda(invoiceId: string): void {
  const run = async () => {
    try {
      await gidenFaturaEpostasi(invoiceId, { kind: "AUTO" })
    } catch (error) {
      console.error(`[fatura-eposta] otomatik giden ${invoiceId} çöktü:`, error)
    }
  }
  try {
    after(run)
  } catch {
    void run()
  }
}

/**
 * Zamanlanmış tarama: otomatik maili hiç denenmemiş (1. tetik kaçmış) ya da hata almış
 * giden belgeler. `BASLANGIC` kaydı olan eski belgeler kapsam dışıdır (migrasyon
 * 20261006000002) — tarama geçmişe mail atmaz.
 */
export async function bekleyenGidenEpostalar(opts: { deadline: number; limit?: number }) {
  const limit = opts.limit ?? 25
  const now = Date.now()
  const stale = new Date(now - SAHIPLENME_ZAMAN_ASIMI_DK * 60_000)

  const [hicDenenmemis, yenidenDenenecek] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        status: "SENT",
        invoiceType: { in: ["E_INVOICE", "E_ARCHIVE"] },
        type: { not: "PURCHASE" },
        isReceipt: false,
        uuid: { not: null },
        // Taramanın penceresi: son 7 günde dokunulmuş belge. BASLANGIC kaydı zaten
        // eskileri dışarıda tutar; pencere yalnız sorguyu dar tutar.
        updatedAt: { gt: new Date(now - 7 * 24 * 3_600_000) },
        emailLogs: { none: { kind: "AUTO" } },
      },
      select: { id: true },
      orderBy: { updatedAt: "asc" },
      take: limit,
    }),
    prisma.invoiceEmailLog.findMany({
      where: {
        kind: "AUTO",
        attempts: { lt: MAX_DENEME },
        OR: [{ status: "HATA" }, { status: "GONDERILIYOR", updatedAt: { lt: stale } }],
      },
      select: { invoiceId: true },
      orderBy: { updatedAt: "asc" },
      take: limit,
    }),
  ])

  const ids = [...new Set([...hicDenenmemis.map((r) => r.id), ...yenidenDenenecek.map((r) => r.invoiceId)])]
  const ozet = { aday: ids.length, gonderildi: 0, aliciYok: 0, kapali: 0, hata: 0, kalan: 0 }
  for (const id of ids) {
    if (Date.now() > opts.deadline) {
      ozet.kalan++
      continue
    }
    const r = await gidenFaturaEpostasi(id, { kind: "AUTO" })
    if (r.ok) ozet.gonderildi++
    else if (r.status === "ALICI_YOK") ozet.aliciYok++
    else if (r.status === "KAPALI") ozet.kapali++
    else if (r.status === "HATA") ozet.hata++
  }
  return ozet
}

/** Faturanın e-posta geçmişi (önizleme ekranı). */
export async function faturaEpostaGecmisi(invoiceId: string) {
  return prisma.invoiceEmailLog.findMany({
    where: { invoiceId, status: { not: "BASLANGIC" } },
    select: {
      id: true,
      kind: true,
      status: true,
      recipient: true,
      error: true,
      attempts: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 20,
  })
}
