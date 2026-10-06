import { prisma } from "@/lib/db/prisma"
import { sendEmail } from "@/lib/email/resend"
import { gelenFaturaEmail } from "@/lib/email/templates"
import { withCompanyHref } from "@/lib/company/href"
import { appBaseUrl } from "@/lib/utils/base-url"
import {
  resolveCompanyEInvoiceProvider,
  COMPANY_PROVIDER_SELECT,
} from "@/lib/integrations/e-invoice/company-provider"
import { syncIncomingInvoices } from "@/lib/integrations/e-invoice/inbox-sync"
import {
  gelenBildirimKarari,
  gelenBildirimSiniri,
  gelisZamani,
  GELEN_TAZELIK_SAAT,
  OTOMATIK_EPOSTA_BASLANGIC,
  profilAdi,
  SAHIPLENME_ZAMAN_ASIMI_DK,
} from "./kurallar"
import { hesapKurucusuBul } from "./kurucu.server"

/**
 * GELEN E-FATURA BİLDİRİMİ — gelen her e-fatura, hesabı açan kişinin giriş e-postasına
 * AYRI bir mail (PDF ekli).
 *
 * Gelen kutusu kendiliğinden dolmaz: kayıtlar ancak Mysoft'tan çekilince oluşur. Bu yüzden
 * zamanlanmış iş önce kutuları tarar (`gelenKutulariniTara`), sonra bildirilmemiş
 * satırları gönderir (`bekleyenGelenBildirimler`). Kullanıcının elle senkronu da satır
 * açar; o satırlar da bir sonraki koşumda bildirilir (bildirimin tek ölçüsü "satır
 * bildirildi mi"dir, satırı kimin açtığı değil).
 *
 * TEKİLLEŞTİRME HESAP × ETTN: şube ana firmanın Mysoft hesabını paylaşır, aynı fatura
 * hem ana firmada hem şubede satır olur (2026-10-06 ölçümü: 483 fatura, 1.238 satır).
 * Alıcı da tek (hesap kurucusu) olduğu için bir hesapta bir ETTN bir kez bildirilir;
 * diğer satırlar KOPYA olarak kapanır.
 */

const SISTEM_AKTOR = "system:fatura-eposta"

function tutarMetni(amount: unknown, currency: string | null | undefined): string | null {
  if (amount == null) return null
  const n = Number(amount)
  if (!Number.isFinite(n)) return null
  try {
    return new Intl.NumberFormat("tr-TR", { style: "currency", currency: currency || "TRY" }).format(n)
  } catch {
    return `${n.toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${currency || "TRY"}`
  }
}

function tarihMetni(d: Date | null): string | null {
  if (!d) return null
  return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Istanbul" })
}

/** Bildirim açık, e-Dönüşüm açık, firma aktif ve arşivde değil. */
const BILDIRIMLI_FIRMA = {
  isEDonusumEnabled: true,
  isActive: true,
  archivedAt: null,
  incomingEmailNotify: true,
} as const

/**
 * Kutuları tarar: hesap × Mysoft mükellefi başına TEK çekim (şubeler aynı kutuyu paylaşır;
 * her birini ayrı çekmek Mysoft'a aynı isteği üç kez atmaktır). Pencere tazelik süresi
 * kadardır — daha eskisi bildirilmeyeceği için çekmenin anlamı yok.
 */
export async function gelenKutulariniTara(opts: { deadline: number }) {
  const firmalar = await prisma.company.findMany({
    where: BILDIRIMLI_FIRMA,
    select: { id: true, name: true, parentCompanyId: true, accountRootId: true, ...COMPANY_PROVIDER_SELECT },
    orderBy: { createdAt: "asc" },
  })

  const gruplar = new Map<string, { companyId: string; name: string; isBranch: boolean; provider: any }>()
  const ozet = { firma: firmalar.length, kutu: 0, yeni: 0, hata: [] as string[], uyari: [] as string[], kalan: 0 }

  for (const f of firmalar) {
    const resolved = resolveCompanyEInvoiceProvider(f)
    // Kimliği eksik firma gönderim de yapamaz; kullanıcı bunu E-Dönüşüm ayarlarında görür.
    if (!resolved.ok) continue
    const key = `${f.accountRootId ?? f.id}:${resolved.mode}:${resolved.tenantVkn}`
    const mevcut = gruplar.get(key)
    // Kutunun sahibi ana firmadır: grupta varsa şube yerine o çekilir.
    if (!mevcut || (mevcut.isBranch && !f.parentCompanyId)) {
      gruplar.set(key, { companyId: f.id, name: f.name, isBranch: Boolean(f.parentCompanyId), provider: resolved.provider })
    }
  }

  const end = new Date()
  const start = new Date(end.getTime() - GELEN_TAZELIK_SAAT * 3_600_000)
  for (const g of gruplar.values()) {
    if (Date.now() > opts.deadline) {
      ozet.kalan++
      continue
    }
    ozet.kutu++
    try {
      const r = await syncIncomingInvoices({
        companyId: g.companyId,
        provider: g.provider,
        start,
        end,
        actorId: SISTEM_AKTOR,
      })
      if (!r.ok) {
        ozet.hata.push(`${g.name}: ${r.error}`)
        continue
      }
      ozet.yeni += r.inserted
      for (const w of r.warnings) ozet.uyari.push(`${g.name}: ${w}`)
      for (const e of r.errors) ozet.hata.push(`${g.name} ${e.uuid}: ${e.error}`)
    } catch (error: any) {
      ozet.hata.push(`${g.name}: ${error?.message || "senkron hatası"}`)
    }
  }
  if (ozet.hata.length) console.error("[fatura-eposta] gelen kutusu taraması hataları:", ozet.hata)
  return ozet
}

/** Bildirim bekleyen satırlar (hiç denenmemiş, hata almış, ya da sahiplenip bırakılmış). */
function bekleyenWhere(stale: Date) {
  return {
    OR: [{ notifiedAt: null }, { notifyResult: "GONDERILIYOR", notifiedAt: { lt: stale } }],
  }
}

async function kapat(ids: string[], notifyResult: string, notifyError: string | null = null) {
  if (ids.length === 0) return
  await prisma.incomingInvoice.updateMany({
    where: { id: { in: ids } },
    data: { notifiedAt: new Date(), notifyResult, notifyError },
  })
}

/**
 * Tazeliği geçmiş, hiç denenmemiş satırlar kuyruğa girmeden TOPLU kapanır (ESKI).
 * Tek tek işlenselerdi yeni bağlanan firmanın ilk senkronu ya da elle "son 1 yıl"
 * senkronu yüzlerce satırla kuyruğun önünü tıkardı (sıra createdAt'e göre, koşum başı
 * `limit` grup); arkadaki GERÇEKTEN yeni fatura sırası gelene kadar tazeliği aşar ve
 * hiç bildirilmeden ESKI kapanırdı. Ölçü `gelisZamani` ile aynı: sentDate ?? docDate ??
 * createdAt; sınır `gelenBildirimSiniri` (tazelik ya da OTOMATIK_EPOSTA_BASLANGIC).
 * Denenmiş satır (notifyAttempts > 0) burada kapanmaz: kuyrukta HATA_SON olur.
 */
async function eskileriKapat(simdi: Date): Promise<number> {
  const sinir = gelenBildirimSiniri(simdi, OTOMATIK_EPOSTA_BASLANGIC)
  const r = await prisma.incomingInvoice.updateMany({
    where: {
      notifiedAt: null,
      notifyAttempts: 0,
      OR: [
        { sentDate: { lt: sinir } },
        { sentDate: null, docDate: { lt: sinir } },
        { sentDate: null, docDate: null, createdAt: { lt: sinir } },
      ],
    },
    data: { notifiedAt: simdi, notifyResult: "ESKI" },
  })
  return r.count
}

/** Gönderimler arasında en az 600 ms (Resend varsayılan sınırı saniyede 2 istek). */
let sonGonderim = 0
async function hizSinirli<T>(fn: () => Promise<T>): Promise<T> {
  const bekle = Math.max(0, sonGonderim + 600 - Date.now())
  sonGonderim = Date.now() + bekle
  if (bekle > 0) await new Promise((r) => setTimeout(r, bekle))
  return fn()
}

export async function bekleyenGelenBildirimler(opts: { deadline: number; limit?: number }) {
  const limit = opts.limit ?? 40
  const stale = new Date(Date.now() - SAHIPLENME_ZAMAN_ASIMI_DK * 60_000)
  const eskiKapanan = await eskileriKapat(new Date())

  const satirlar = await prisma.incomingInvoice.findMany({
    where: bekleyenWhere(stale),
    select: {
      id: true,
      uuid: true,
      companyId: true,
      invoiceNo: true,
      docDate: true,
      sentDate: true,
      createdAt: true,
      senderName: true,
      senderTaxNumber: true,
      profile: true,
      payableAmount: true,
      currencyCode: true,
      notifyAttempts: true,
      company: {
        select: {
          id: true,
          name: true,
          slug: true,
          parentCompanyId: true,
          accountRootId: true,
          isActive: true,
          archivedAt: true,
          incomingEmailNotify: true,
          ...COMPANY_PROVIDER_SELECT, // isEDonusumEnabled bunun içinde
        },
      },
    },
    orderBy: { createdAt: "asc" },
    take: limit * 3,
  })

  // Hesap × ETTN grupları
  const gruplar = new Map<string, typeof satirlar>()
  for (const s of satirlar) {
    const key = `${s.company.accountRootId ?? s.company.id}:${s.uuid}`
    const g = gruplar.get(key)
    if (g) g.push(s)
    else gruplar.set(key, [s])
  }

  const ozet = { aday: gruplar.size, gonderildi: 0, kopya: 0, eski: eskiKapanan, kapali: 0, aliciYok: 0, hata: 0, kalan: 0 }
  const baseUrl = appBaseUrl()

  const isle = async (grup: typeof satirlar) => {
    // Kutunun sahibi ana firma: şubenin satırı varsa da bildirim ana firma satırından gider.
    const birincil = grup.find((s) => !s.company.parentCompanyId) ?? grup[0]
    const digerleri = grup.filter((s) => s.id !== birincil.id).map((s) => s.id)
    const rootId = birincil.company.accountRootId ?? birincil.company.id

    let sahiplenildi = false
    try {
      // Aynı hesapta bu ETTN başka bir satırda zaten işlendi mi? (gönderildi, şu an
      // gönderiliyor, özellik açılmadan önce vardı, kapalı/alıcısız/eski diye kapandı).
      // HATA ve bırakılmış sahiplenme "işlendi" sayılmaz.
      const hesapFirmalari = await prisma.company.findMany({
        where: { OR: [{ id: rootId }, { accountRootId: rootId }] },
        select: { id: true },
      })
      const onceki = await prisma.incomingInvoice.findFirst({
        where: {
          uuid: birincil.uuid,
          companyId: { in: hesapFirmalari.map((c) => c.id) },
          id: { notIn: grup.map((s) => s.id) },
          AND: [
            { notifiedAt: { not: null } },
            { notifyResult: { not: "HATA" } },
            { NOT: { notifyResult: "GONDERILIYOR", notifiedAt: { lt: stale } } },
          ],
        },
        select: { id: true },
      })
      if (onceki) {
        await kapat(grup.map((s) => s.id), "KOPYA")
        ozet.kopya++
        return
      }

      // Sahiplen (koşullu tek cümle: iki koşum aynı satırı alamaz)
      const claimed = await prisma.incomingInvoice.updateMany({
        where: { id: birincil.id, ...bekleyenWhere(stale) },
        data: { notifiedAt: new Date(), notifyResult: "GONDERILIYOR", notifyAttempts: { increment: 1 } },
      })
      if (claimed.count !== 1) return
      sahiplenildi = true
      await kapat(digerleri, "KOPYA")
      if (digerleri.length) ozet.kopya++

      const c = birincil.company
      if (!c.isEDonusumEnabled || !c.isActive || c.archivedAt || !c.incomingEmailNotify) {
        await kapat([birincil.id], "KAPALI")
        ozet.kapali++
        return
      }

      const karar = gelenBildirimKarari({
        gelis: gelisZamani(birincil),
        simdi: new Date(),
        deneme: birincil.notifyAttempts,
        baslangic: OTOMATIK_EPOSTA_BASLANGIC,
      })
      if (karar === "ESKI") {
        await kapat([birincil.id], "ESKI")
        ozet.eski++
        return
      }
      if (karar === "HATA_SON") {
        await prisma.incomingInvoice.update({
          where: { id: birincil.id },
          data: { notifyResult: "HATA" }, // notifiedAt dolu kalır: deneme hakkı bitti, kayıt kapandı
        })
        ozet.hata++
        return
      }

      const { kurucu } = await hesapKurucusuBul(c.id)
      if (!kurucu?.email) {
        await kapat([birincil.id], "ALICI_YOK", "Hesapta kurucu yönetici (giriş e-postası) bulunamadı.")
        console.warn(`[fatura-eposta] gelen ${birincil.uuid}: hesapta kurucu yok (firma ${c.id})`)
        ozet.aliciYok++
        return
      }

      // PDF ek bilgidir: alınamazsa bildirim yine gider ve bunu söyler.
      let pdf: Buffer | null = null
      const resolved = resolveCompanyEInvoiceProvider(c)
      if (resolved.ok) {
        const r = await resolved.provider.getIncomingInvoicePdf(birincil.uuid).catch(() => null)
        if (r?.success) pdf = r.pdfBuffer
      }

      const senderName = birincil.senderName?.trim() || birincil.senderTaxNumber || "Bilinmeyen gönderici"
      const { subject, html } = gelenFaturaEmail({
        companyName: c.name,
        senderName,
        senderTaxNumber: birincil.senderTaxNumber,
        invoiceNo: birincil.invoiceNo,
        dateLabel: tarihMetni(birincil.docDate),
        amountLabel: tutarMetni(birincil.payableAmount, birincil.currencyCode),
        profileLabel: profilAdi(birincil.profile),
        isCommercial: (birincil.profile || "").toUpperCase() === "TICARIFATURA",
        hasPdf: Boolean(pdf),
        viewUrl: `${baseUrl}${withCompanyHref("/alis/gelen-e-faturalar", c.slug || c.id)}`,
      })
      const alici = kurucu.email
      const sent = await hizSinirli(() => sendEmail({
        to: alici,
        subject,
        html,
        ...(pdf
          ? {
              attachments: [
                {
                  filename: `${(birincil.invoiceNo || birincil.uuid).replace(/[^\w.-]+/g, "_")}.pdf`,
                  content: pdf,
                  contentType: "application/pdf",
                },
              ],
            }
          : {}),
      }))
      if (!sent.ok) {
        const error = sent.skipped ? "E-posta servisi yapılandırılmamış (RESEND_API_KEY yok)." : sent.error || "E-posta gönderilemedi."
        // notifiedAt boşaltılır → bir sonraki koşum yeniden dener (deneme sayısı arttı).
        await prisma.incomingInvoice.update({
          where: { id: birincil.id },
          data: { notifiedAt: null, notifyResult: "HATA", notifyError: error },
        })
        console.error(`[fatura-eposta] gelen ${birincil.uuid} gönderilemedi:`, error)
        ozet.hata++
        return
      }
      await kapat([birincil.id], "GONDERILDI", pdf ? null : "PDF alınamadı; bildirim eksiz gitti.")
      ozet.gonderildi++
    } catch (error: any) {
      const message = error?.message || "bildirim hatası"
      console.error(`[fatura-eposta] gelen ${birincil.uuid}:`, message)
      // Yalnız SAHİPLENDİĞİMİZ satır geri bırakılır; başkasının sahiplenmesi ezilmesin.
      if (sahiplenildi) {
        await prisma.incomingInvoice
          .update({ where: { id: birincil.id }, data: { notifiedAt: null, notifyResult: "HATA", notifyError: message } })
          .catch((e) => console.error(`[fatura-eposta] gelen ${birincil.uuid} geri bırakılamadı:`, e))
      }
      ozet.hata++
    }
  }

  // Fatura başına Mysoft'tan PDF çekmek ~6–7 sn sürüyor (2026-10-06 ölçümü): sırayla
  // koşum başına ancak 4–5 bildirim çıkar. Üçer üçer işlenir; sahiplenme satır başına
  // olduğu için paralel işlemek aynı faturayı iki kez göndermez. Gönderimin kendisi
  // `hizSinirli` ile aralıklanır (Resend saniyede 2 istek).
  const kuyruk = [...gruplar.values()].slice(0, limit)
  ozet.kalan += gruplar.size - kuyruk.length
  const ESZAMANLI = 3
  for (let i = 0; i < kuyruk.length; i += ESZAMANLI) {
    if (Date.now() > opts.deadline) {
      ozet.kalan += kuyruk.length - i
      break
    }
    await Promise.all(kuyruk.slice(i, i + ESZAMANLI).map(isle))
  }
  return ozet
}
