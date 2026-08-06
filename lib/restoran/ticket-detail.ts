// Kapanmış adisyonun DENETİM görünümü — "bu hesapta ne oldu" sorusunun cevabı.
// Kararlar: docs/restoran/ADISYON-DETAY.md K2
//
// Neden `serializeTicket`'in içinde değil: liste ucu (/api/restoran/adisyonlar,
// limit=200) aynı serializer'ı kullanıyor. Ödeme satırlarını ve kullanıcı
// adlarını oraya koymak 200 kayıtlık listeyi şişirir ve her liste isteğine ek
// sorgu getirirdi. Bu yüzden ek alanlar YALNIZCA `?detail=1` ile istendiğinde
// hesaplanır; param'sız çağrı (canlı POS ekranı her kalem eklemede yeniden
// çekiyor) bugünkü maliyetinde kalır.

import { prisma } from "@/lib/db/prisma"
import { Prisma } from "@prisma/client"
import { ticketDiscountOf, ticketTotals } from "./ticket-constants"

/** Ödeme yöntemi etiketleri. `lib/satis/payment.ts` yalnız POS'un dört yöntemini
 *  tanıyor; fatura tarafında CHECK/OTHER de yazılabiliyor (cari ekranından
 *  girilen tahsilat) — bu yüzden burada kendi tam listesi var. */
const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Nakit",
  CREDIT_CARD: "Kredi Kartı",
  MEAL_CARD: "Yemek Kartı",
  BANK_TRANSFER: "Havale / EFT",
  CHECK: "Çek",
  OTHER: "Diğer",
}

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

export type StaffRef = { id: string; name: string } | null

/**
 * Adisyon detayının EK alanları. `serializeTicket` çıktısının üstüne konur.
 */
export type TicketDetailExtras = {
  /** Oturma süresi (dk) — açıkken null; ekranda `openedAt → closedAt` yazar. */
  durationMin: number | null
  staff: {
    openedBy: StaffRef
    closedBy: StaffRef
    billRequestedBy: StaffRef
    discountBy: StaffRef
  }
  /** Kalem id → ekleyen kullanıcının adı. Kalem listesi serializeTicket'ten gelir. */
  itemCreators: Record<string, string>
  /** Kalem id → İKRAMI VEREN personelin adı (yalnız ikram kalemlerinde dolu). */
  itemCompEmployees: Record<string, string>
  invoice: {
    id: string
    slug: string
    invoiceNo: string
    status: string
    netAmount: number
    vatAmount: number
    totalAmount: number
    globalDiscountAmount: number
    paidTotal: number
    /** Tahsil edilmemiş kalan — kapanışta parça yazılamamışsa burada görünür. */
    remaining: number
    paymentStatus: "PAID" | "PARTIAL" | "OPEN"
    payments: Array<{
      id: string
      amount: number
      method: string
      methodLabel: string
      paymentDate: string
      accountName: string | null
      /** Yemek kartı sağlayıcısı buraya yazılıyor (bkz. lib/satis/payment.ts). */
      notes: string | null
    }>
  } | null
  merge: {
    /** Bu adisyon NEREYE birleştirildi. */
    into: { id: string; code: string } | null
    /** Bu adisyona hangi adisyonlar birleştirildi. */
    from: Array<{ id: string; code: string; total: number }>
  }
  reservation: { id: string; guestName: string; reservedAt: string } | null
}

/** Kullanıcı adlarını TEK sorguda çözer — denetim raporundaki desenin aynısı
 *  (app/api/restoran/raporlar/denetim/route.ts). */
async function resolveUsers(ids: Array<string | null | undefined>) {
  const unique = [...new Set(ids.filter((v): v is string => !!v))]
  if (unique.length === 0) return new Map<string, string>()
  const users = await prisma.user.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true, email: true },
  })
  return new Map(users.map((u) => [u.id, u.name || u.email || u.id]))
}

/** Adisyonun detay için gereken ham alanları — `ticketInclude`'a EK olarak. */
const detailSelect = Prisma.validator<Prisma.RestaurantTicketSelect>()({
  id: true,
  openedBy: true,
  closedBy: true,
  billRequestedBy: true,
  discountBy: true,
  openedAt: true,
  closedAt: true,
  invoiceId: true,
  mergedInto: { select: { id: true, code: true } },
  mergedFrom: {
    select: {
      id: true,
      code: true,
      discountType: true,
      discountValue: true,
      items: { select: { quantity: true, unitPrice: true, vatRate: true, status: true } },
    },
    orderBy: { closedAt: "asc" },
  },
  reservation: { select: { id: true, guestName: true, reservedAt: true } },
  // İkram personeli İK kartından okunur (User değil): "kim ikram etti" sorusunun
  // cevabı oturumu açan kişi değil, o an masaya bakan garsondur — `createdBy`
  // oturum izi olarak ayrı durur (SATIS-EKRANI.md K3.1/K3.2).
  items: {
    select: {
      id: true,
      createdBy: true,
      compEmployee: { select: { firstName: true, lastName: true } },
    },
  },
})

/**
 * Detay ek alanlarını üretir. Adisyonun kendisi çağıran tarafta zaten çekilmiş
 * olsa da burada AYRI sorgu atılır: `ticketInclude` bu alanların çoğunu
 * taşımıyor ve onu genişletmek liste ucunu da etkilerdi.
 */
export async function buildTicketDetail(
  ticketId: string,
  companyId: string,
): Promise<TicketDetailExtras | null> {
  const row = await prisma.restaurantTicket.findFirst({
    where: { id: ticketId, companyId },
    select: detailSelect,
  })
  if (!row) return null

  const [names, invoice] = await Promise.all([
    resolveUsers([
      row.openedBy,
      row.closedBy,
      row.billRequestedBy,
      row.discountBy,
      ...row.items.map((i) => i.createdBy),
    ]),
    row.invoiceId
      ? prisma.invoice.findUnique({
          where: { id: row.invoiceId },
          select: {
            id: true,
            slug: true,
            invoiceNo: true,
            status: true,
            netAmount: true,
            vatAmount: true,
            totalAmount: true,
            globalDiscountAmount: true,
            payments: {
              select: {
                id: true,
                amount: true,
                paymentMethod: true,
                paymentDate: true,
                notes: true,
                account: { select: { name: true } },
              },
              orderBy: { paymentDate: "asc" },
            },
          },
        })
      : null,
  ])

  const ref = (id: string | null): StaffRef =>
    id ? { id, name: names.get(id) ?? id } : null

  const itemCreators: Record<string, string> = {}
  const itemCompEmployees: Record<string, string> = {}
  for (const item of row.items) {
    if (item.createdBy) itemCreators[item.id] = names.get(item.createdBy) ?? item.createdBy
    if (item.compEmployee) {
      const ad = `${item.compEmployee.firstName ?? ""} ${item.compEmployee.lastName ?? ""}`.trim()
      if (ad) itemCompEmployees[item.id] = ad
    }
  }

  return {
    durationMin:
      row.closedAt && row.openedAt
        ? Math.max(0, Math.round((row.closedAt.getTime() - row.openedAt.getTime()) / 60000))
        : null,
    staff: {
      openedBy: ref(row.openedBy),
      closedBy: ref(row.closedBy),
      billRequestedBy: ref(row.billRequestedBy),
      discountBy: ref(row.discountBy),
    },
    itemCreators,
    itemCompEmployees,
    invoice: invoice
      ? (() => {
          // TAHSİLAT TOPLAMI DECIMAL İLE. `Number` ile toplamak kuruş kaymasına
          // yol açar ve hesabı tam kapatan bir tahsilat "eksik" görünür —
          // faturalar/odemeler ucunda 2026-08-06'da düzeltilen hatanın aynısı.
          const paid = invoice.payments.reduce(
            (sum, p) => sum.plus(p.amount),
            new Prisma.Decimal(0),
          )
          const remaining = new Prisma.Decimal(invoice.totalAmount).minus(paid)
          return {
            id: invoice.id,
            slug: invoice.slug,
            invoiceNo: invoice.invoiceNo,
            status: invoice.status,
            netAmount: Number(invoice.netAmount),
            vatAmount: Number(invoice.vatAmount),
            totalAmount: Number(invoice.totalAmount),
            globalDiscountAmount: Number(invoice.globalDiscountAmount ?? 0),
            paidTotal: round2(paid.toNumber()),
            remaining: round2(remaining.toNumber()),
            paymentStatus: remaining.lessThanOrEqualTo(0)
              ? ("PAID" as const)
              : paid.greaterThan(0)
                ? ("PARTIAL" as const)
                : ("OPEN" as const),
            payments: invoice.payments.map((p) => ({
              id: p.id,
              amount: Number(p.amount),
              method: p.paymentMethod,
              methodLabel: PAYMENT_METHOD_LABELS[p.paymentMethod] ?? p.paymentMethod,
              paymentDate: p.paymentDate.toISOString(),
              accountName: p.account?.name ?? null,
              notes: p.notes,
            })),
          }
        })()
      : null,
    merge: {
      into: row.mergedInto ? { id: row.mergedInto.id, code: row.mergedInto.code } : null,
      from: row.mergedFrom.map((m) => ({
        id: m.id,
        code: m.code,
        total: ticketTotals(m.items, ticketDiscountOf(m)).total,
      })),
    },
    reservation: row.reservation
      ? {
          id: row.reservation.id,
          guestName: row.reservation.guestName,
          reservedAt: row.reservation.reservedAt.toISOString(),
        }
      : null,
  }
}
