import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db/prisma"
import type { MysoftEInvoiceProvider } from "./mysoft-provider"
import { voidInvoice } from "./void-invoice"
import { extractSentDate } from "./incoming-sent-date"

/**
 * Mysoft gelen kutusunu firmanın `incoming_invoices` tablosuna yazar (upsert).
 *
 * İki çağıran: kullanıcının "Senkronize" düğmesi (POST /api/e-donusum/inbox/sync) ve
 * fatura e-postası taraması (lib/fatura-eposta/gelen.server.ts — oturumsuz). Mantık bu
 * yüzden uçta değil burada; yetki ve sağlayıcı çözümü çağıranın işidir.
 *
 * Davranış:
 *  - (companyId, uuid) unique → mevcut kayıtlar update edilir, yeniler insert edilir
 *  - Status/tutar gibi alanlar Mysoft'ta değiştiyse yansır; rawJson hep güncellenir
 *  - isLinkedToPurchase + linkedInvoiceId ve bildirim kolonları Kobipo iç akışıdır —
 *    sync sırasında DOKUNULMAZ (yeni satırda bildirim kolonları boş doğar = "bildirilecek")
 *  - Aralık 90 günü aşarsa provider onu 90 günlük pencerelere bölüp sırayla çeker
 *    (Mysoft dönem uçları daha uzun aralığı reddediyor). Bir pencere alınamazsa
 *    `warnings` dizisinde döner — liste EKSİK demektir, sessizce geçilmez.
 *  - Mysoft'un dönem filtresi GÖNDERİM tarihine göre çalışır: kısa pencere (son birkaç
 *    gün) yeni gelen her faturayı, belge tarihi eski olsa bile yakalar.
 */
export type InboxSyncResult =
  | {
      ok: true
      fetched: number
      warnings: string[]
      inserted: number
      updated: number
      skipped: number
      voidedLinked: number
      errors: Array<{ uuid: string; error: string }>
    }
  | { ok: false; error: string }

export async function syncIncomingInvoices(params: {
  companyId: string
  provider: Pick<MysoftEInvoiceProvider, "listIncomingInvoices">
  start: Date
  end: Date
  /** Bağlı alış faturası RED ile geçersizleşirse kayıtlara yazılacak yapan. */
  actorId: string
}): Promise<InboxSyncResult> {
  const { companyId, provider, start, end, actorId } = params

  const result = await provider.listIncomingInvoices({ startDate: start, endDate: end })
  if (!result.success) return { ok: false, error: result.error }

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
      const incomingIsTerminal = incomingStatusUpper === "KABUL" || incomingStatusUpper === "RED"
      const effectiveStatus = localIsTerminal && !incomingIsTerminal ? existing!.status : row.status

      const data: Prisma.IncomingInvoiceUpsertArgs["create"] = {
        companyId,
        uuid: row.uuid,
        invoiceNo: row.invoiceNo,
        docDate: row.date ? new Date(row.date) : null,
        // Gönderilme tarihi ham JSON'da; kolona yazılır ki tarih aralığı bu
        // eksende de SORGULANABİLSİN (yalnız ekranda gösterilebilir değil).
        sentDate: extractSentDate(row.raw),
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
      const saved = await prisma.incomingInvoice.upsert({
        where: { companyId_uuid: { companyId, uuid: row.uuid } },
        create: data,
        update: updateData,
      })
      // Insert mi update mi? createdAt = updatedAt ise insert, değilse update.
      if (saved.createdAt.getTime() === saved.updatedAt.getTime()) {
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
      if ((saved.status || "").toUpperCase() === "RED" && saved.linkedInvoiceId) {
        const linked = await prisma.invoice.findUnique({
          where: { id: saved.linkedInvoiceId },
          select: { id: true, status: true, invoiceNo: true },
        })
        if (linked && linked.status !== "CANCELLED") {
          await prisma.$transaction(async (tx) => {
            await voidInvoice(tx, {
              invoiceId: linked.id,
              companyId,
              invoiceNo: linked.invoiceNo,
              integrationStatus: "REJECTED:RED",
              createdBy: actorId,
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

  return {
    ok: true,
    fetched: result.data.length,
    warnings: result.warnings ?? [],
    inserted,
    updated,
    skipped,
    voidedLinked,
    errors,
  }
}
