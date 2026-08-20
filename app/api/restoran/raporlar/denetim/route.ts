// Denetim raporu — ikram/zayi, iptaller, personel kırılımı ve rezervasyon.
// Kararlar: docs/restoran/DENETIM-VE-TEMIZLIK.md (Faz 4 / İş 9-12).
//
// Bu rapor YENİ VERİ ÜRETMİYOR: hepsi bugüne kadar yazılıp hiç okunmayan
// alanlar. `openedBy`/`closedBy`/`createdBy` dört yerde yazılıyordu ve hiçbir
// sorguda geçmiyordu; ikram/zayi stok hareketi maliyetiyle birlikte yazılıyordu
// ama hiçbir raporda görünmüyordu; `mergedIntoId` yazılıyordu ama birleştirilen
// adisyon hâlâ "iptal" sayılıyordu.
//
// DÖRT AYRI TARİH EKSENİ var ve dördü de bilinçli:
//   • İkram/zayi  → stok hareketinin tarihi (malzemenin fiilen düştüğü an)
//   • VOID kalem  → adisyonun AÇILIŞI (kalem servis sırasında iptal edilir,
//                   adisyon hâlâ açık olabilir; `closedAt` boş olurdu)
//   • İptal/birleştirme → `closedAt` (iptal ANI — sorulan şey budur)
//   • İSKONTO     → `closedAt` (uygulama anı DEĞİL). Açık adisyondaki iskonto
//                   hâlâ değiştirilebilir/kaldırılabilir; tahsil edilmeyen para
//                   ancak hesap kapanınca gerçekleşir. `discountAt` kayıtta
//                   duruyor ama ölçüm ekseni değil.
//
// Ölçüm sınırları (bilinçli):
//   • İkram/zayi maliyeti hareketi YAZAN kullanıcıya atfedilir; adisyonda bu,
//     hesabı KAPATAN kişidir (işareti koyanı ayrıca saklamıyoruz).
//   • Tezgâh (Kahveci Satış) ikramlarının adisyon kaydı yok; tutarları para
//     tarafında sayılır, sebep kırılımında görünmezler. Aynısı tezgâh
//     İSKONTOSU için de geçerli: kaydı hiç tutulmuyor (Invoice'ta sebep alanı
//     yok), bu yüzden buradaki iskonto ölçümü YALNIZ adisyonları kapsar.
//   • İskonto personeli İK kartıdır (`Employee`), aşağıdaki "Personel"
//     tablosunun kullanıcıları (`User`) ile AYNI KÜME DEĞİLDİR — bu yüzden
//     ayrı bir kırılım olarak döner, o tabloya sütun olarak eklenmez.

import { NextResponse } from "next/server"
import { resolveCompanyId } from "@/lib/company/resolve-company"
import { getCurrentUser } from "@/lib/auth/session"
import { prisma } from "@/lib/db/prisma"
import { ensureCompanyAccess } from "@/lib/middleware/company"
import { num, parseRange } from "@/lib/restoran/reports"
import {
  assertRestaurantModule,
  cancelReasonLabel,
  discountReasonLabel,
  isBillableItem,
  reasonLabel,
  ticketDiscountOf,
  ticketTotals,
} from "@/lib/restoran/tickets"
import { accessDeniedResponse, withApiErrors } from "@/lib/api/errors"

export const dynamic = "force-dynamic"

/**
 * İkram/zayi hareketlerinin işareti. `writeCompWasteStock` ikisini AYRI hareket
 * olarak yazıyor (tek açıklamada birleşselerdi tutarları bölünemezdi).
 */
const COMP_MARK = "%- İkram:%"
const WASTE_MARK = "%- Zayi:%"

type CompRow = {
  kind: string
  product_id: string
  name: string
  unit: string | null
  qty: unknown
  cost: unknown
  created_by: string | null
}

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

/** Kalemin KDV dahil satır tutarı — VOID/COMP kalem hesaba girmez, ama "ne kadarlık" sorusu anlamlıdır. */
const lineGross = (i: { quantity: unknown; unitPrice: unknown; vatRate: unknown }) =>
  Number(i.quantity) * Number(i.unitPrice) * (1 + Number(i.vatRate) / 100)

export const GET = withApiErrors(async function GET(request: Request) {
  try {
    const user = await getCurrentUser()
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const companyId = await resolveCompanyId(searchParams.get("companyId"))
    if (!companyId) return NextResponse.json({ error: "companyId is required" }, { status: 400 })
    assertRestaurantModule(await ensureCompanyAccess(companyId))

    const { start, end } = parseRange(searchParams)

    const [compRows, itemRows, ticketRows, openedRows, discountRows, reservationRows] = await Promise.all([
      // İkram/zayi PARA tarafı: maliyet satış anında donduruldu (AVCO).
      //
      // Geri alınmış belgeler dışarıda: fiş iptali `revertStockByReference` ile
      // aynı referansa ters hareket yazıyor ve o hareketin açıklaması "Fatura
      // iptali" — ikram hareketinin kendisi duruyor ama artık geçersiz. Belge
      // SİLİNMİŞ olabileceği için faturaya join etmek yetmez (bkz. AVCO'daki
      // aynı tuzak, SADELESTIRME.md İş 11).
      prisma.$queryRaw<CompRow[]>`
        SELECT CASE WHEN m.description LIKE ${COMP_MARK} THEN 'COMP' ELSE 'WASTE' END AS kind,
               m."productId"                                       AS product_id,
               p.name                                              AS name,
               p.unit                                              AS unit,
               SUM(ABS(m.quantity))                                AS qty,
               SUM(ABS(m.quantity) * COALESCE(m."unitPrice", 0))   AS cost,
               MIN(m."createdBy")                                  AS created_by
        FROM stock_movements m
        JOIN products p ON p.id = m."productId"
        WHERE m."companyId" = ${companyId}
          AND m.type = 'ADJUSTMENT'
          AND (m.description LIKE ${COMP_MARK} OR m.description LIKE ${WASTE_MARK})
          AND m."createdAt" >= ${start}
          AND m."createdAt" <= ${end}
          AND NOT EXISTS (
            SELECT 1 FROM stock_movements r
            WHERE r."companyId" = m."companyId"
              AND r.reference = m.reference
              AND r.description LIKE '%Fatura iptali%'
          )
        GROUP BY 1, 2, p.name, p.unit
        ORDER BY cost DESC
      `,
      // ADET/SEBEP tarafı: adisyon kalemleri. Kalem servis sırasında işaretlenir,
      // adisyon hâlâ açık olabilir → eksen AÇILIŞ tarihi.
      prisma.restaurantTicketItem.findMany({
        where: {
          status: { in: ["COMP", "WASTE", "VOID"] },
          ticket: { companyId, openedAt: { gte: start, lte: end } },
        },
        select: {
          quantity: true,
          unitPrice: true,
          vatRate: true,
          status: true,
          reasonCode: true,
          description: true,
          createdBy: true,
          ticket: { select: { code: true, closedBy: true } },
        },
      }),
      // İptal ve birleştirme: eksen iptal ANI (`closedAt`).
      prisma.restaurantTicket.findMany({
        where: { companyId, status: "CANCELLED", closedAt: { gte: start, lte: end } },
        select: {
          id: true,
          code: true,
          closedAt: true,
          closedBy: true,
          mergedIntoId: true,
          cancelReasonCode: true,
          cancelReason: true,
          discountType: true,
          discountValue: true,
          table: { select: { name: true } },
          items: { select: { quantity: true, unitPrice: true, vatRate: true, status: true } },
        },
        orderBy: { closedAt: "desc" },
      }),
      // Personel: açılan ve kapanan adisyonlar. Kapananın cirosu FATURADAN gelir
      // (kesin tutarı — iskonto ve yuvarlama dahil — fatura ucu hesaplıyor).
      prisma.restaurantTicket.findMany({
        where: {
          companyId,
          OR: [
            { openedAt: { gte: start, lte: end } },
            { closedAt: { gte: start, lte: end }, status: "CLOSED" },
          ],
        },
        select: {
          openedAt: true,
          openedBy: true,
          closedAt: true,
          closedBy: true,
          status: true,
          invoice: { select: { totalAmount: true, status: true } },
        },
      }),
      // İskonto: yalnız KAPANMIŞ adisyonlar. Açık hesaptaki iskonto henüz
      // gerçekleşmedi (kaldırılabilir), iptal edilen adisyonda ise tahsil
      // edilmeyen bir para yok — ikisi de "verilen indirim" sayılmamalı.
      prisma.restaurantTicket.findMany({
        where: {
          companyId,
          status: "CLOSED",
          closedAt: { gte: start, lte: end },
          discountType: { not: null },
        },
        select: {
          id: true,
          code: true,
          closedAt: true,
          discountType: true,
          discountValue: true,
          discountReasonCode: true,
          discountReason: true,
          discountEmployeeId: true,
          discountEmployee: { select: { firstName: true, lastName: true, position: true } },
          table: { select: { name: true } },
          items: { select: { quantity: true, unitPrice: true, vatRate: true, status: true } },
        },
        orderBy: { closedAt: "desc" },
      }),
      prisma.restaurantReservation.groupBy({
        by: ["status"],
        where: { companyId, reservedAt: { gte: start, lte: end } },
        _count: { _all: true },
      }),
    ])

    // ---- İkram / zayi ------------------------------------------------------

    const products = compRows.map((r) => ({
      kind: r.kind === "COMP" ? ("COMP" as const) : ("WASTE" as const),
      productId: r.product_id,
      name: r.name,
      unit: r.unit ?? "",
      quantity: num(r.qty),
      cost: round2(num(r.cost)),
    }))
    const compCost = round2(
      products.filter((p) => p.kind === "COMP").reduce((s, p) => s + p.cost, 0),
    )
    const wasteCost = round2(
      products.filter((p) => p.kind === "WASTE").reduce((s, p) => s + p.cost, 0),
    )

    // ---- Sebep kırılımı (adet) --------------------------------------------

    type ReasonBucket = { status: string; code: string | null; label: string; count: number; quantity: number; value: number }
    const reasonMap = new Map<string, ReasonBucket>()
    for (const item of itemRows) {
      const status = item.status ?? "NORMAL"
      const key = `${status}:${item.reasonCode ?? ""}`
      const bucket =
        reasonMap.get(key) ??
        {
          status,
          code: item.reasonCode,
          label: reasonLabel(status, item.reasonCode) ?? "Belirtilmemiş",
          count: 0,
          quantity: 0,
          value: 0,
        }
      bucket.count += 1
      bucket.quantity += Number(item.quantity)
      bucket.value += lineGross(item)
      reasonMap.set(key, bucket)
    }
    const reasons = [...reasonMap.values()]
      .map((b) => ({ ...b, value: round2(b.value) }))
      .sort((a, b) => b.count - a.count)

    const voidValue = round2(
      itemRows.filter((i) => i.status === "VOID").reduce((s, i) => s + lineGross(i), 0),
    )

    // ---- İptal / birleştirme ----------------------------------------------
    //
    // Birleştirilen adisyon da `CANCELLED` görünür ama İPTAL DEĞİLDİR: cirosu
    // kaybolmadı, hedef adisyona geçti. İkisini aynı sayaçta toplamak iptal
    // oranını olduğundan yüksek gösteriyordu.

    const asCancel = (t: (typeof ticketRows)[number]) => ({
      id: t.id,
      code: t.code,
      closedAt: t.closedAt?.toISOString() ?? null,
      closedBy: t.closedBy,
      tableName: t.table?.name ?? null,
      reasonCode: t.cancelReasonCode,
      reasonLabel: cancelReasonLabel(t.cancelReasonCode),
      reason: t.cancelReason,
      itemCount: t.items.filter((i) => isBillableItem(i.status)).length,
      value: ticketTotals(t.items, ticketDiscountOf(t)).total,
    })

    const cancelled = ticketRows.filter((t) => !t.mergedIntoId).map(asCancel)
    const merged = ticketRows.filter((t) => t.mergedIntoId).map(asCancel)
    const cancelledValue = round2(cancelled.reduce((s, c) => s + c.value, 0))

    const cancelReasonMap = new Map<string, { code: string | null; label: string; count: number; value: number }>()
    for (const c of cancelled) {
      const key = c.reasonCode ?? ""
      const bucket =
        cancelReasonMap.get(key) ??
        { code: c.reasonCode, label: c.reasonLabel ?? "Belirtilmemiş", count: 0, value: 0 }
      bucket.count += 1
      bucket.value += c.value
      cancelReasonMap.set(key, bucket)
    }
    const cancelReasons = [...cancelReasonMap.values()]
      .map((b) => ({ ...b, value: round2(b.value) }))
      .sort((a, b) => b.count - a.count)

    // ---- İskonto -----------------------------------------------------------
    //
    // Tutar KDV DAHİL brüt iskontodur: işletmenin sorduğu "bugün ne kadar
    // indirim verdik" sorusunun cevabı hesabın altındaki rakamdır, matrah
    // karşılığı değil (faturaya giden net tutar `netDiscount` ayrı hesaplanır).

    const discounts = discountRows.map((t) => ({
      id: t.id,
      code: t.code,
      closedAt: t.closedAt?.toISOString() ?? null,
      tableName: t.table?.name ?? null,
      type: t.discountType,
      // Yüzde iskontoda oran da lazım: "%10" ile "150 ₺" aynı sütunda okunmuyor.
      rate: t.discountType === "PERCENT" ? Number(t.discountValue ?? 0) : null,
      reasonCode: t.discountReasonCode,
      reasonLabel: discountReasonLabel(t.discountReasonCode),
      reason: t.discountReason,
      employeeId: t.discountEmployeeId,
      employeeName: t.discountEmployee
        ? `${t.discountEmployee.firstName} ${t.discountEmployee.lastName}`.trim()
        : null,
      value: ticketTotals(t.items, ticketDiscountOf(t)).discount,
    }))
    const discountTotal = round2(discounts.reduce((s, d) => s + d.value, 0))

    const discountReasonMap = new Map<
      string,
      { code: string | null; label: string; count: number; value: number }
    >()
    for (const d of discounts) {
      const key = d.reasonCode ?? ""
      const bucket =
        discountReasonMap.get(key) ??
        { code: d.reasonCode, label: d.reasonLabel ?? "Belirtilmemiş", count: 0, value: 0 }
      bucket.count += 1
      bucket.value += d.value
      discountReasonMap.set(key, bucket)
    }
    const discountReasons = [...discountReasonMap.values()]
      .map((b) => ({ ...b, value: round2(b.value) }))
      .sort((a, b) => b.value - a.value)

    // Personel kırılımı — İK kartı bazında. Aşağıdaki `staff` tablosundan AYRI:
    // orası login kullanıcısı, burası iskontonun altına imzasını atan personel.
    // Geçmiş kayıtlarda (alan eklenmeden önce) personel boştur; "Belirtilmemiş"
    // satırı bilinçli olarak GİZLENMEZ — ölçülemeyen indirim de bir bulgudur.
    const discountStaffMap = new Map<
      string,
      { employeeId: string | null; name: string; position: string | null; count: number; value: number }
    >()
    for (const row of discountRows) {
      const key = row.discountEmployeeId ?? ""
      const bucket =
        discountStaffMap.get(key) ??
        {
          employeeId: row.discountEmployeeId,
          name: row.discountEmployee
            ? `${row.discountEmployee.firstName} ${row.discountEmployee.lastName}`.trim()
            : "Belirtilmemiş",
          position: row.discountEmployee?.position ?? null,
          count: 0,
          value: 0,
        }
      bucket.count += 1
      bucket.value += ticketTotals(row.items, ticketDiscountOf(row)).discount
      discountStaffMap.set(key, bucket)
    }
    const discountStaff = [...discountStaffMap.values()]
      .map((b) => ({ ...b, value: round2(b.value) }))
      .sort((a, b) => b.value - a.value)

    // ---- Personel ----------------------------------------------------------

    type Staff = {
      userId: string
      name: string
      opened: number
      closed: number
      revenue: number
      cancelled: number
      compWasteCost: number
      voidItems: number
    }
    const staffMap = new Map<string, Staff>()
    const staffOf = (id: string | null | undefined): Staff | null => {
      if (!id) return null
      const existing = staffMap.get(id)
      if (existing) return existing
      const fresh: Staff = {
        userId: id,
        name: id,
        opened: 0,
        closed: 0,
        revenue: 0,
        cancelled: 0,
        compWasteCost: 0,
        voidItems: 0,
      }
      staffMap.set(id, fresh)
      return fresh
    }

    const inRange = (d: Date | null) => !!d && d >= start && d <= end
    for (const t of openedRows) {
      if (inRange(t.openedAt)) {
        const opener = staffOf(t.openedBy)
        if (opener) opener.opened += 1
      }
      if (t.status === "CLOSED" && inRange(t.closedAt)) {
        const s = staffOf(t.closedBy)
        if (s) {
          s.closed += 1
          // İptal edilmiş fiş ciroya girmez (reportScope ile aynı kural).
          if (t.invoice && t.invoice.status !== "CANCELLED") {
            s.revenue += Number(t.invoice.totalAmount)
          }
        }
      }
    }
    for (const t of ticketRows) {
      if (t.mergedIntoId) continue
      const canceller = staffOf(t.closedBy)
      if (canceller) canceller.cancelled += 1
    }
    for (const item of itemRows) {
      if (item.status === "VOID") {
        // Kalemi KİM iptal etti ayrıca saklanmıyor; ekleyen kullanıcıya yazılır.
        const s = staffOf(item.createdBy ?? item.ticket?.closedBy)
        if (s) s.voidItems += 1
      }
    }
    for (const r of compRows) {
      const s = staffOf(r.created_by)
      if (s) s.compWasteCost += num(r.cost)
    }

    const staffIds = [...staffMap.keys()]
    if (staffIds.length > 0) {
      const users = await prisma.user.findMany({
        where: { id: { in: staffIds } },
        select: { id: true, name: true, email: true },
      })
      for (const u of users) {
        const s = staffMap.get(u.id)
        if (s) s.name = u.name || u.email || u.id
      }
    }
    const staff = [...staffMap.values()]
      .map((s) => ({
        ...s,
        revenue: round2(s.revenue),
        compWasteCost: round2(s.compWasteCost),
        avgTicket: s.closed > 0 ? round2(s.revenue / s.closed) : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)

    // ---- Rezervasyon -------------------------------------------------------

    const reservationCounts = Object.fromEntries(
      reservationRows.map((r) => [r.status, r._count._all]),
    ) as Record<string, number>
    const reservationTotal = Object.values(reservationCounts).reduce((a, b) => a + b, 0)
    const noShow = reservationCounts.NOSHOW ?? 0
    const seated = reservationCounts.SEATED ?? 0

    return NextResponse.json({
      range: { start: start.toISOString(), end: end.toISOString() },
      summary: {
        compCost,
        wasteCost,
        voidCount: itemRows.filter((i) => i.status === "VOID").length,
        voidValue,
        cancelledCount: cancelled.length,
        cancelledValue,
        mergedCount: merged.length,
        discountCount: discounts.length,
        discountTotal,
        reservationTotal,
        seated,
        noShow,
        // Gelmeme oranı yalnız SONUÇLANMIŞ rezervasyonlar üzerinden: bekleyenler
        // henüz ne oturdu ne gelmedi, paydaya girerlerse oran yapay düşer.
        noShowRate: seated + noShow > 0 ? (noShow / (seated + noShow)) * 100 : null,
      },
      products,
      reasons,
      cancelReasons,
      cancelled,
      merged,
      discounts,
      discountReasons,
      discountStaff,
      staff,
      reservations: reservationCounts,
    })
  } catch (error: any) {
    if (String(error?.message).includes("Access denied")) {
      return accessDeniedResponse(error)
    }
    console.error("[Restoran] Denetim raporu hatası:", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
