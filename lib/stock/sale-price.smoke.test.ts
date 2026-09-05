/**
 * Ham SQL duman testi — GERÇEK veritabanına bağlanır, bu yüzden VARSAYILAN OLARAK
 * ATLANIR. Çalıştırmak için firma slug'ı verin:
 *
 *   STOK_SMOKE_COMPANY=reypo npx vitest run lib/stock/sale-price.smoke.test.ts
 *
 * NEDEN VAR: bu modül `$queryRaw` üzerine kurulu ve TypeScript ham SQL'in içini
 * GÖRMEZ. Yanlış sütun adı, `avgCostCte` ile çakışan bir takma ad, CTE sırası
 * hatası — hiçbiri derlemede yakalanmaz; ilk ürün kartı açılışında 500 olur.
 * (Aynı gerekçe: lib/asistan/veri/sorgular.smoke.test.ts.)
 *
 * DOĞRULUK ölçmez — veri firmadan firmaya değişir. Sorguların koştuğunu, tipleri
 * çevirebildiğini ve sonuçların KENDİ İÇİNDE tutarlı olduğunu doğrular:
 * ortalamanın satılan en düşük/en yüksek birim fiyat arasında kalması gibi.
 */

import { describe, expect, it, beforeAll } from "vitest"
import { prisma } from "@/lib/db/prisma"
import { resolveAllUnitCosts, resolveLastPurchases } from "./cost"
import {
  effectiveAvgSale,
  resolveAllAvgSalePrices,
  resolveAvgSalePrices,
} from "./sale-price"

// Uzak Supabase havuzuna gidiyor: 5 sn'lik varsayılan vitest sınırı yetmiyor.
const ZAMAN_ASIMI = 30_000

const SLUG = process.env.STOK_SMOKE_COMPANY
const calistir = SLUG ? describe : describe.skip

calistir("satış fiyatı / maliyet ham SQL duman testi", () => {
  let companyId: string
  let productIds: string[] = []

  beforeAll(async () => {
    const firma = await prisma.company.findFirst({
      where: { OR: [{ slug: SLUG }, { id: SLUG }] },
      select: { id: true },
    })
    if (!firma) throw new Error(`Firma bulunamadı: ${SLUG}`)
    companyId = firma.id
    const urunler = await prisma.product.findMany({
      where: { companyId },
      select: { id: true },
      take: 50,
    })
    productIds = urunler.map((u) => u.id)
  }, ZAMAN_ASIMI)

  it("tüm ürünler için satış ortalaması koşuyor", async () => {
    const harita = await resolveAllAvgSalePrices(companyId)
    for (const [, satir] of harita) {
      // Miktar negatife düşmez (iadesi satışından çok olan ürün 0'a kırpılır).
      expect(satir.periodQuantity).toBeGreaterThanOrEqual(0)
      expect(satir.allTimeQuantity).toBeGreaterThanOrEqual(0)
      // Ortalama ile miktar BİRLİKTE var ya da birlikte yok — "0 adetten ortalama"
      // olamaz; olsaydı ekran bölme sonucu NaN'ı fiyat diye basardı.
      if (satir.periodAvg != null) expect(satir.periodQuantity).toBeGreaterThan(0)
      if (satir.allTimeAvg != null) expect(satir.allTimeQuantity).toBeGreaterThan(0)
      if (satir.periodAvg != null) expect(Number.isFinite(satir.periodAvg)).toBe(true)
    }
  }, ZAMAN_ASIMI)

  it("id listesiyle sorulan ortalama, hepsini soran sorguyla AYNI sonucu verir", async () => {
    if (productIds.length === 0) return
    const hepsi = await resolveAllAvgSalePrices(companyId)
    const secilmis = await resolveAvgSalePrices(companyId, productIds)

    for (const id of productIds) {
      const a = hepsi.get(id)
      const b = secilmis.get(id)
      // Sorulan her id haritada DURUR (boş özetle olsa da) — sözleşme bu.
      expect(b).toBeDefined()
      if (!a) {
        // Hepsini soran sorguda yoksa hiç satılmamıştır.
        expect(b!.allTimeAvg).toBeNull()
        continue
      }
      if (a.periodAvg == null) expect(b!.periodAvg).toBeNull()
      else expect(b!.periodAvg).toBeCloseTo(a.periodAvg, 6)
      expect(b!.allTimeQuantity).toBeCloseTo(a.allTimeQuantity, 6)
    }
  }, ZAMAN_ASIMI)

  it("ortalama satış, gerçekleşen birim fiyatların arasında kalıyor", async () => {
    const harita = await resolveAvgSalePrices(companyId, productIds)
    for (const [productId, satir] of harita) {
      const etkin = effectiveAvgSale(satir)
      if (!etkin) continue

      // Aynı ürünün TÜM ZAMAN satır fiyatları — ağırlıklı ortalama bunların en
      // küçüğü ile en büyüğü arasında kalmak ZORUNDA. Kalmıyorsa iskonto/işaret
      // hesabı bozuktur (ör. iade eksi yerine artı sayılmış).
      const satirlar = await prisma.$queryRaw<Array<{ birim: unknown }>>`
        SELECT (ii.quantity * ii."unitPrice" - COALESCE(ii."discountAmount", 0)) / ii.quantity AS birim
        FROM invoice_items ii
        JOIN invoices i ON i.id = ii."invoiceId"
        JOIN products p ON p.id = ii."productId"
        WHERE ii."productId" = ${productId}
          AND i."companyId" = ${companyId}
          AND i.type = 'SALES'
          AND i.status NOT IN ('CANCELLED', 'CONVERTED')
          AND COALESCE(i.currency, 'TRY') = COALESCE(p.currency, 'TRY')
          AND ii.quantity > 0
      `
      if (satirlar.length === 0) continue
      const fiyatlar = satirlar.map((r) => Number(r.birim)).filter((n) => Number.isFinite(n))
      if (fiyatlar.length === 0) continue

      const enAz = Math.min(...fiyatlar)
      const enCok = Math.max(...fiyatlar)
      // Kuruş altı tolerans: ortalama bölme sonucudur.
      expect(etkin.price).toBeGreaterThanOrEqual(enAz - 0.01)
      expect(etkin.price).toBeLessThanOrEqual(enCok + 0.01)
    }
  }, ZAMAN_ASIMI)

  it("son alış hareketi ile ortalama maliyet birlikte tutarlı", async () => {
    const [maliyet, sonAlis] = await Promise.all([
      resolveAllUnitCosts(companyId),
      resolveLastPurchases(companyId, productIds),
    ])
    for (const [productId, alis] of sonAlis) {
      // ₺0 GEÇERLİ bir alış fiyatıdır (bedelsiz/promosyon giriş, ya da kullanıcının
      // fiyatsız kestiği alış faturası) ve canlıda örneği var — sıfırı dışlamak
      // testi veriye değil beklentiye uydurmak olurdu.
      expect(alis.unitPrice).toBeGreaterThanOrEqual(0)
      expect(alis.date instanceof Date).toBe(true)
      // Fiyatı kayıtlı alışı OLAN ürünün maliyeti bilinmiyor olamaz.
      expect(maliyet.get(productId) ?? null).not.toBeNull()
    }
  }, ZAMAN_ASIMI)
})
