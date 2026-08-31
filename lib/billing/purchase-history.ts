// Bir HESABIN satın alma geçmişi: "neyi, ne zaman, ne kadara aldı" sorusunun tek cevabı.
//
// Neden tek yerde: bugüne kadar cevap üç ekrana dağılmıştı — paket siparişleri
// /system-admin/abonelikler'de (son 20), kontör siparişleri /system-admin/kontor'da
// (tüm firmalar karışık), abonelik olayları ise yalnız MÜŞTERİ panelinde. Tek bir
// müşterinin ne aldığını görmek için üç ekran gezip elle eşleştirmek gerekiyordu; bir
// fiyat/içerik şikâyeti geldiğinde bakılacak tek bir yer yoktu.
//
// KAPSAM HESAPTIR, FİRMA DEĞİL. Abonelik hesap kökünde durur; kontör ise yüklendiği
// VKN'ye bağlı olduğu için şubeden ya da ek firmadan satın alınmış olabilir. Yalnız
// istenen firmanın id'siyle sorgulamak, o hesabın ödemelerinin bir kısmını gizler —
// eksik gösterilen para, hiç gösterilmeyenden daha tehlikelidir.
//
// PARA TOPLAMLARINA yalnız GERÇEKTEN TAHSİL EDİLMİŞ satırlar girer. `isTest` siparişler
// (PayTR test modunda para çekilmez ama callback başarılı döner) ve başarısız/iptal
// edilmiş siparişler toplam dışında tutulur, listede ise kendi durumlarıyla görünür.

import { prisma } from "@/lib/db/prisma"
import { resolveAccountRootId, getAccountCompanyIds } from "@/lib/billing/entitlements"
import {
  deriveContentLines,
  parsePriceLines,
  priceLinesTotal,
  type ContentLine,
  type OrderLine,
} from "@/lib/billing/order-lines"
import { getSubscriptionEvents, EVENT_LABELS, type SubscriptionEventType } from "@/lib/billing/events"
import { moduleLabel } from "@/lib/modules"

export type PurchaseLine = OrderLine

export type PackagePurchase = {
  id: string
  createdAt: string
  paidAt: string | null
  status: string
  /** Satın alınan içeriğin insan okunur adı: paket adı ya da "Özel seçim". */
  title: string
  billingCycle: string
  /** Açılan modüllerin insan okunur adları. */
  modules: string[]
  branchQuota: number
  companyQuota: number
  /** Tahsil edilen tutar (indirim düşülmüş). */
  amount: number
  /** İndirim öncesi liste tutarı. */
  listAmount: number
  discountCode: string | null
  discountAmount: number
  currency: string
  /**
   * Satın alma anındaki kalem dökümü (`PackageOrder.priceLines`). null = bu sipariş
   * döküm kaydedilmeden önce açılmış. Katalogdan doldurulmaz.
   */
  lines: PurchaseLine[] | null
  /** Siparişin içeriği adetleriyle — fiyatsız. Ne alındığı her siparişte kayıtlı. */
  contentLines: ContentLine[]
  /**
   * Kesilen satış faturasının kalemleri. Paket faturası bugün tek satır kesiliyor
   * ("test — Yıllık abonelik"); birim fiyat o satırın fişteki fiyatıdır, kataloğun değil.
   */
  invoiceLines: {
    description: string
    qty: number
    unitPrice: number
    vatAmount: number
    total: number
    discountAmount: number
  }[]
  /** Kalem toplamı `amount + discountAmount`ı tutmuyorsa dökümde bir sorun var. */
  linesMismatch: boolean
  paymentProvider: string | null
  paymentRef: string | null
  paymentError: string | null
  invoiceNo: string | null
  invoiceError: string | null
  isTest: boolean
  autoRenew: boolean
  createdByName: string | null
}

export type KontorPurchase = {
  id: string
  createdAt: string
  paidAt: string | null
  status: string
  packageName: string
  creditQty: number
  unitPrice: number
  amount: number
  listAmount: number
  discountCode: string | null
  discountAmount: number
  currency: string
  paymentMethod: string
  paymentRef: string | null
  paymentError: string | null
  targetVkn: string
  /** Kontörü hangi firma satın aldı (şube/ek firma olabilir). */
  companyName: string
  invoiceNo: string | null
  invoiceError: string | null
  isTest: boolean
}

export type PurchaseEvent = {
  id: string
  type: string
  label: string
  summary: string
  actor: string
  createdAt: string
}

export type AccountPurchaseHistory = {
  rootCompanyId: string
  rootCompanyName: string
  /** Sorulan firma hesabın kökü mü? Değilse geçmiş kökün geçmişidir. */
  isAccountRoot: boolean
  packageOrders: PackagePurchase[]
  kontorOrders: KontorPurchase[]
  events: PurchaseEvent[]
  totals: {
    /** Tahsil edilmiş paket/abonelik ödemeleri. */
    packagePaid: number
    /** Tahsil edilmiş kontör ödemeleri. */
    kontorPaid: number
    /** Hesabın bugüne kadar ödediği toplam. */
    grandTotal: number
    /** Toplam dışında bırakılan test siparişlerinin tutarı (varsa uyarı basılır). */
    testExcluded: number
    /** Kullanılan toplam indirim. */
    discountTotal: number
    paidOrderCount: number
    failedOrderCount: number
  }
}

const num = (v: unknown): number => Number(v ?? 0)
const iso = (d: Date | null | undefined): string | null => d?.toISOString() ?? null
const round2 = (n: number): number => Number(n.toFixed(2))

/** Paket siparişi parayı gerçekten getirdi mi? */
function isPackagePaid(o: { status: string; isTest: boolean }): boolean {
  return o.status === "ACTIVE" && !o.isTest
}

/**
 * Kontör siparişi parayı gerçekten getirdi mi?
 *
 * `paidAt` üzerinden bakılır, duruma göre değil: havale akışında para onaylandığında
 * damgalanır, yükleme (LOADED) ise sonraki adımdır — Mysoft yüklemesi takılan bir
 * sipariş tahsil edilmiş olmasına rağmen toplamdan düşerdi.
 */
function isKontorPaid(o: { paidAt: Date | null; status: string; isTest: boolean }): boolean {
  return o.paidAt != null && !o.isTest && o.status !== "REJECTED" && o.status !== "FAILED"
}

/**
 * Hesabın tüm satın alma geçmişini okur. `companyId` hesabın herhangi bir üyesi
 * olabilir (şube ya da ek firma); geçmiş daima hesap kökü üzerinden toplanır.
 */
export async function getAccountPurchaseHistory(
  companyId: string,
): Promise<AccountPurchaseHistory> {
  const rootCompanyId = await resolveAccountRootId(companyId)
  const memberIds = await getAccountCompanyIds(rootCompanyId)

  const [root, packageRows, kontorRows, eventRows] = await Promise.all([
    prisma.company.findUnique({ where: { id: rootCompanyId }, select: { name: true } }),
    prisma.packageOrder.findMany({
      // Paket/abonelik siparişi daima KÖKE yazılır ([[app/api/billing/orders/route.ts]]).
      where: { companyId: rootCompanyId },
      orderBy: { createdAt: "desc" },
      // `createdById` bir ilişki DEĞİL (sipariş, kullanıcı silinse de durmalı);
      // siparişi açanın adı aşağıda ayrı sorguyla çözülüyor.
      include: {
        invoice: {
          select: {
            invoiceNo: true,
            items: {
              orderBy: { order: "asc" },
              select: {
                description: true,
                quantity: true,
                unitPrice: true,
                vatAmount: true,
                totalAmount: true,
                discountAmount: true,
              },
            },
          },
        },
      },
    }),
    prisma.kontorOrder.findMany({
      // Kontör yüklendiği VKN'ye bağlıdır: şube ya da ek firma adına alınmış olabilir.
      where: { companyId: { in: memberIds } },
      orderBy: { createdAt: "desc" },
      include: {
        invoice: { select: { invoiceNo: true } },
        company: { select: { name: true, branchName: true } },
      },
    }),
    getSubscriptionEvents(rootCompanyId, 100),
  ])

  const creatorIds = Array.from(
    new Set(packageRows.map((o) => o.createdById).filter((v): v is string => Boolean(v))),
  )
  const creators = creatorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: creatorIds } },
        select: { id: true, name: true, email: true },
      })
    : []
  const creatorById = new Map(creators.map((u) => [u.id, u.name || u.email]))

  const packageOrders: PackagePurchase[] = packageRows.map((o) => {
    const amount = num(o.amount)
    const discountAmount = num(o.discountAmount)
    const listAmount = round2(amount + discountAmount)
    const lines = parsePriceLines(o.priceLines)
    return {
      id: o.id,
      createdAt: o.createdAt.toISOString(),
      paidAt: iso(o.paidAt),
      status: o.status,
      title: o.planName || "Özel seçim",
      billingCycle: o.billingCycle,
      modules: o.resolvedModules.map(moduleLabel),
      branchQuota: o.branchQuota,
      companyQuota: o.companyQuota,
      amount,
      listAmount,
      discountCode: o.discountCode,
      discountAmount,
      currency: o.currency,
      lines,
      contentLines: deriveContentLines(o),
      invoiceLines: (o.invoice?.items ?? []).map((item) => ({
        description: item.description,
        qty: num(item.quantity),
        unitPrice: num(item.unitPrice),
        vatAmount: num(item.vatAmount),
        total: num(item.totalAmount),
        discountAmount: num(item.discountAmount),
      })),
      linesMismatch: lines != null && priceLinesTotal(lines) !== listAmount,
      paymentProvider: o.paymentProvider,
      paymentRef: o.paymentRef,
      paymentError: o.paymentError,
      invoiceNo: o.invoice?.invoiceNo ?? null,
      invoiceError: o.invoiceError,
      isTest: o.isTest,
      autoRenew: o.autoRenew,
      createdByName: o.createdById ? creatorById.get(o.createdById) ?? null : null,
    }
  })

  const kontorOrders: KontorPurchase[] = kontorRows.map((o) => {
    const amount = num(o.totalPrice)
    const discountAmount = num(o.discountAmount)
    return {
      id: o.id,
      createdAt: o.createdAt.toISOString(),
      paidAt: iso(o.paidAt),
      status: o.status,
      packageName: o.packageName,
      creditQty: o.creditQty,
      unitPrice: num(o.unitPrice),
      amount,
      listAmount: round2(amount + discountAmount),
      discountCode: o.discountCode,
      discountAmount,
      currency: o.currency,
      paymentMethod: o.paymentMethod,
      paymentRef: o.paymentRef,
      paymentError: o.paymentError,
      targetVkn: o.targetVkn,
      companyName: o.company.branchName
        ? `${o.company.name} · ${o.company.branchName}`
        : o.company.name,
      invoiceNo: o.invoice?.invoiceNo ?? null,
      invoiceError: o.invoiceError,
      isTest: o.isTest,
    }
  })

  const packagePaid = round2(
    packageRows.filter(isPackagePaid).reduce((sum, o) => sum + num(o.amount), 0),
  )
  const kontorPaid = round2(
    kontorRows.filter(isKontorPaid).reduce((sum, o) => sum + num(o.totalPrice), 0),
  )
  const testExcluded = round2(
    packageRows.filter((o) => o.isTest && o.status === "ACTIVE").reduce((s, o) => s + num(o.amount), 0) +
      kontorRows.filter((o) => o.isTest && o.paidAt != null).reduce((s, o) => s + num(o.totalPrice), 0),
  )
  const discountTotal = round2(
    packageRows.filter(isPackagePaid).reduce((s, o) => s + num(o.discountAmount), 0) +
      kontorRows.filter(isKontorPaid).reduce((s, o) => s + num(o.discountAmount), 0),
  )

  return {
    rootCompanyId,
    rootCompanyName: root?.name ?? "Bilinmeyen firma",
    isAccountRoot: rootCompanyId === companyId,
    packageOrders,
    kontorOrders,
    events: eventRows.map((e) => ({
      id: e.id,
      type: e.type,
      label: EVENT_LABELS[e.type as SubscriptionEventType] ?? e.type,
      summary: e.summary,
      actor: e.actor,
      createdAt: e.createdAt.toISOString(),
    })),
    totals: {
      packagePaid,
      kontorPaid,
      grandTotal: round2(packagePaid + kontorPaid),
      testExcluded,
      discountTotal,
      paidOrderCount:
        packageRows.filter(isPackagePaid).length + kontorRows.filter(isKontorPaid).length,
      failedOrderCount:
        packageRows.filter((o) => o.status === "FAILED").length +
        kontorRows.filter((o) => o.status === "FAILED" || o.status === "REJECTED").length,
    },
  }
}
