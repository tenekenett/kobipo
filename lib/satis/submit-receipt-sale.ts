"use client"

// Fiş kesme + tahsilat akışının TEK yeri (Kahveci Satış ve Adisyon kapanışı).
//
// Neden ortak: iki ekran da aynı üç adımı yapıyor — fişi oluştur, SUNUCUNUN
// yazdığı toplam üzerinden ödeme parçalarını hesapla, her parçayı tahsilat
// olarak yaz. Kopya olsaydı en tehlikeli ayrıntı ayrışırdı: tutar istemcinin
// yuvarlanmamış toplamından değil, faturanın SUNUCUDA kayıtlı toplamından
// gelmeli — aksi halde kuruş farkı ödemeyi reddettirir.
//
// Fişin kendisini `/api/e-donusum/invoices` kesiyor: stok düşümü, reçete
// genişletme, cari ve muhasebe fişi orada birlikte yürüyor.

import {
  buildPaymentParts,
  round2,
  type PaymentPart,
  type PaymentState,
} from "@/lib/satis/payment"
import type { RefAccount } from "@/lib/swr/use-company-data"
import type { RecipeEffect } from "@/lib/stock/recipe-expand"

export type ReceiptSaleItem = {
  productId?: string | null
  description: string
  unit: string
  quantity: number
  /** KDV HARİÇ birim fiyat — fatura ucu net bekliyor. */
  unitPrice: number
  vatRate: number
  /**
   * Seçeneğin (porsiyon/modifier) reçeteye etkisi. Faturaya YAZILMAZ; fiş ucu
   * yalnız stok düşümünü buna göre yönlendirir — soya sütlü latte satılınca
   * inek sütü düşmesin diye (docs/restoran/SATIS-EKRANI.md K6).
   */
  recipeEffects?: RecipeEffect[]
  /** Porsiyon çarpanı: 1,5 → reçetenin tamamı 1,5 kat düşer ("büyük boy"). */
  recipeFactor?: number
}

export type ReceiptSaleResult =
  | { ok: true; invoice: any; parts: PaymentPart[]; paidSum: number; total: number }
  /** Fiş hiç oluşmadı — hiçbir yan etki yok, kullanıcı tekrar deneyebilir. */
  | { ok: false; stage: "invoice"; error: string }
  /**
   * Fiş OLUŞTU ama tahsilat yazılamadı. Fişi geri almak stoğu da geri alırdı;
   * doğru davranış kullanıcıyı uyarıp ödemeyi Fişler ekranından tamamlatmak.
   */
  | { ok: false; stage: "payment"; error: string; invoice: any }

export async function submitReceiptSale(args: {
  companyId: string
  items: ReceiptSaleItem[]
  payment: PaymentState
  accounts: RefAccount[]
  customerId?: string | null
  warehouseId?: string | null
  notes?: string | null
  /**
   * Fatura altı (genel) iskonto — NET tutar. Adisyon hesabına uygulanan iskonto
   * buradan geçer; fatura ucu matrahtan oransal düşer, KDV de aynı oranda azalır.
   */
  globalDiscountAmount?: number | null
  /** İstemcinin hesapladığı toplam; sunucu toplam döndürmezse yedek olarak kullanılır. */
  fallbackTotal: number
}): Promise<ReceiptSaleResult> {
  const invoiceRes = await fetch("/api/e-donusum/invoices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      companyId: args.companyId,
      type: "SALES",
      invoiceType: "MANUAL",
      isReceipt: true,
      customerId: args.customerId || null,
      warehouseId: args.warehouseId || undefined,
      date: new Date().toISOString(),
      currency: "TRY",
      notes: args.notes?.trim() || undefined,
      globalDiscountAmount:
        args.globalDiscountAmount && args.globalDiscountAmount > 0
          ? args.globalDiscountAmount
          : undefined,
      sendInvoice: false,
      items: args.items.map((l) => ({
        productId: l.productId ?? undefined,
        description: l.description,
        unit: l.unit,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        vatRate: l.vatRate,
        recipeEffects: l.recipeEffects?.length ? l.recipeEffects : undefined,
        recipeFactor: l.recipeFactor && l.recipeFactor !== 1 ? l.recipeFactor : undefined,
      })),
    }),
  })

  const invoice = await invoiceRes.json().catch(() => ({}))
  if (!invoiceRes.ok) {
    return { ok: false, stage: "invoice", error: invoice?.error || "Satış fişi oluşturulamadı" }
  }

  const total =
    invoice?.totalAmount != null ? Number(invoice.totalAmount) : round2(args.fallbackTotal)

  const cashAccountId = args.accounts.find((a) => a.type === "CASH")?.id
  const cardAccountId = args.accounts.find((a) => a.type === "CREDIT_CARD" || a.type === "POS")?.id
  // Banka kanalı önce açıkça BANK'tan seçilir: POS kanalı da "nakit değil" olduğu
  // için ilk sıraya düşüp havale tahsilatını yanlış kanala yazabilirdi.
  const bankAccountId =
    args.accounts.find((a) => a.type === "BANK")?.id ??
    args.accounts.find((a) => a.type !== "CASH")?.id
  const parts = buildPaymentParts(args.payment, { total, cashAccountId, bankAccountId, cardAccountId })

  for (const part of parts) {
    const payRes = await fetch("/api/faturalar/odemeler", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        invoiceId: invoice.id,
        companyId: args.companyId,
        amount: part.amount,
        paymentMethod: part.method,
        accountId: part.accountId,
        // Yemek kartı sağlayıcısı tahsilat notuna yazılır: yöntem "MEAL_CARD"
        // olarak gruplanırken hangi sağlayıcıdan tahsil edildiği kaybolmasın —
        // ekstre mutabakatı sağlayıcı bazında yapılıyor.
        notes: part.provider ? `Yemek kartı: ${part.provider}` : undefined,
        paymentDate: new Date().toISOString(),
      }),
    })
    if (!payRes.ok) {
      const payErr = await payRes.json().catch(() => ({}))
      return {
        ok: false,
        stage: "payment",
        error: payErr?.error || "Ödemeyi Fişler üzerinden tekrar deneyin",
        invoice,
      }
    }
  }

  return {
    ok: true,
    invoice,
    parts,
    paidSum: round2(parts.reduce((s, p) => s + p.amount, 0)),
    total,
  }
}
