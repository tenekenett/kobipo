/**
 * BAKİYE KAPAMA / İSKONTO RAPORU — kasaya girmeden kapatılan cari tutarlar.
 *
 * Kayıt `InvoicePayment.paymentMethod = WRITE_OFF` (lib/cari/bakiye-kapama.ts).
 * Para hareketi olmadığı için nakit akışına ve kasa raporlarına girmez; cari
 * bakiyeden düştüğü için de "ödeme" gibi okunmamalı. Bu rapor onları AYRI
 * toplar: müşteride alacaktan vazgeçilen (verilen iskonto), tedarikçide
 * borçtan düşülen (alınan iskonto).
 *
 * Ekran ve dışa aktarım aynı fonksiyonu çağırır; ikisi ayrı hesaplasaydı
 * "ekranda 12 kayıt, Excel'de 14" doğardı.
 */

import { prisma } from "@/lib/db/prisma"
import { BAKIYE_KAPAMA_METHOD } from "@/lib/cari/bakiye-kapama"
import { payableSign, receivableSign } from "@/lib/cari/invoice-direction"
import { periodWhere, resolvePeriodBounds } from "./date-range"

export type BakiyeKapamaSide = "customer" | "supplier"

export type BakiyeKapamaRow = {
  id: string
  date: string
  amount: number
  /** customer = alacaktan vazgeçildi (verilen iskonto), supplier = borçtan düşüldü (alınan). */
  side: BakiyeKapamaSide
  cariId: string | null
  /** Kartın yolu (/cari/<kind>/<id>) — taraf değil, kaydın hangi kartta durduğu. */
  cariKind: "customers" | "suppliers" | null
  cariName: string
  invoiceId: string
  invoiceNo: string
  notes: string | null
  reference: string | null
}

export type BakiyeKapamaResult = {
  period: { startDate: string; endDate: string }
  rows: BakiyeKapamaRow[]
  totals: {
    /** Müşterilere verilen iskonto / silinen alacak. */
    customer: number
    /** Tedarikçilerden alınan iskonto / silinen borç. */
    supplier: number
    count: number
  }
}

/**
 * Kaydın tarafı FATURANIN yönünden okunur, kartın türünden değil: müşteri
 * kartına işlenmiş bir alış faturasının (mahsup) kapaması bizim borcumuzu
 * düşürür — yani "alınan iskonto"dur, kart müşteri olsa da.
 */
function sideOf(inv: { type: string; returnKind: string | null }): BakiyeKapamaSide {
  // Satış ailesi alacak, alış ailesi borç; iade ailesinin tersine yazılır ama
  // kapama her zaman açık kalan tarafı düşürür — işaretin kendisi yeter.
  if (receivableSign(inv) !== 0) return "customer"
  if (payableSign(inv) !== 0) return "supplier"
  return "customer"
}

export async function computeBakiyeKapama(args: {
  companyId: string
  startDate?: string | null
  endDate?: string | null
}): Promise<BakiyeKapamaResult> {
  const bounds = resolvePeriodBounds(args.startDate, args.endDate)

  const payments = await prisma.invoicePayment.findMany({
    where: {
      companyId: args.companyId,
      paymentMethod: BAKIYE_KAPAMA_METHOD,
      paymentDate: periodWhere(bounds),
      // İptal/dönüştürülmüş belgenin kapaması bakiyeye de girmiyor (cari
      // sorguları o faturayı dışlıyor); raporda da sayılmaz.
      invoice: { status: { notIn: ["CANCELLED", "CONVERTED"] } },
    },
    select: {
      id: true,
      amount: true,
      paymentDate: true,
      notes: true,
      reference: true,
      invoice: {
        select: {
          id: true,
          invoiceNo: true,
          eDocumentNo: true,
          type: true,
          returnKind: true,
          customerId: true,
          supplierId: true,
          customer: { select: { name: true } },
          supplier: { select: { name: true } },
        },
      },
    },
    orderBy: { paymentDate: "desc" },
  })

  const rows: BakiyeKapamaRow[] = payments.map((p) => {
    const inv = p.invoice
    const side = sideOf(inv)
    const cariName = inv.customer?.name ?? inv.supplier?.name ?? "—"
    return {
      id: p.id,
      date: p.paymentDate.toISOString(),
      amount: Number(p.amount),
      side,
      cariId: inv.customerId ?? inv.supplierId ?? null,
      cariKind: inv.customerId ? "customers" : inv.supplierId ? "suppliers" : null,
      cariName,
      invoiceId: inv.id,
      invoiceNo: inv.eDocumentNo || inv.invoiceNo,
      notes: p.notes,
      reference: p.reference,
    }
  })

  const totals = rows.reduce(
    (acc, row) => {
      acc[row.side] += row.amount
      acc.count += 1
      return acc
    },
    { customer: 0, supplier: 0, count: 0 },
  )

  return {
    // Bitiş EKRANDA kapsayıcı gösterilir (nakit akışıyla aynı gerekçe).
    period: {
      startDate: bounds.start.toISOString(),
      endDate: new Date(bounds.endExclusive.getTime() - 1).toISOString(),
    },
    rows,
    totals,
  }
}
