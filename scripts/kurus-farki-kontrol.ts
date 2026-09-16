/**
 * KURUŞ FARKI — Kobipo'nun kaydettiği dip toplam, GİB'e giden belgeyle aynı mı?
 *
 *   npx tsx scripts/kurus-farki-kontrol.ts                 → OFFLINE: payload ↔ computeInvoiceTotals
 *   npx tsx scripts/kurus-farki-kontrol.ts --canli --test  → Mysoft TEST ortamında taslak UBL ölçümü
 *   npx tsx scripts/kurus-farki-kontrol.ts --canli --firma=<id>
 *
 * NEDEN
 * Kobipo toplamı satırların yuvarlanmamış toplamından kuruyordu; Mysoft'a giden
 * belge her satırı kuruşa yuvarlıyor. Reypo'da ölçüldü: Kobipo 31.906,38 ↔ belge
 * 31.906,39 (2026-09-16). Kural tek yere toplandı: lib/invoice/document-totals.ts.
 * Bu betik o birliği ÖLÇER — "aynı fonksiyon" demek yetmez, belgeye bakılır.
 *
 *  1) OFFLINE — ağ/veritabanı yok. Gerçek provider sahte `fetch` ile çalıştırılır,
 *     Mysoft'a gidecek `invoiceCalculation` ve satır tutarları
 *     `computeInvoiceTotals`ın kaydedeceği başlıkla karşılaştırılır.
 *  2) CANLI — "Fatura Önizleme - XML" ucundan dönen UBL'deki LegalMonetaryTotal /
 *     TaxTotal değerleri Kobipo başlığıyla karşılaştırılır. Önizlemedir: GİB'e belge
 *     GİTMEZ, Mysoft'ta kayıt bırakmaz.
 *
 * CANLI --firma ÖN KOŞULU: firmanın Mysoft şifresi canlının anahtarıyla şifreli —
 * `npm run vercel:env:pull` ile .env.local indirilmiş olmalı. --test için env'deki
 * MYSOFT_USERNAME / MYSOFT_PASSWORD yeter.
 */
import "dotenv/config"
import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local", override: true })

import { MysoftEInvoiceProvider } from "@/lib/integrations/e-invoice/mysoft-provider"
import { computeInvoiceTotals, computeDocumentTotals } from "@/lib/invoice/document-totals"

const args = process.argv.slice(2)
const CANLI = args.includes("--canli")
const TEST_ORTAMI = args.includes("--test")
const FIRMA = (args.find((a) => a.startsWith("--firma=")) || "").split("=")[1] || ""

/**
 * Reypo örneği (docs/finans/KURUS-FARKI.md): belgede ödenecek 31.906,39.
 * `discountAmount` KAYITLI tutardır (uçlar kuruşa yuvarlayıp yazar; sağlayıcı da
 * bu kolonu gönderir) — %3'lük satırın iskontosu 583,333331 × 0,03 → 17,50.
 */
const KALEMLER = [
  { description: "Kalem 1", quantity: 1, unitPrice: 12345.67, vatRate: 20, discountAmount: 1000, productId: "T-1" },
  { description: "Kalem 2", quantity: 3, unitPrice: 4999.99, vatRate: 20, discountAmount: 1250.5, productId: "T-2" },
  { description: "Kalem 3", quantity: 7, unitPrice: 83.333333, vatRate: 10, discountAmount: 17.5, discountRate: 3, productId: "T-3" },
  { description: "Kalem 4", quantity: 2, unitPrice: 1499.5, vatRate: 1, discountAmount: 99.99, productId: "T-4" },
  { description: "Kalem 5", quantity: 1, unitPrice: 500, vatRate: 20, productId: "T-5" },
]
const AYARLAR = { globalDiscountAmount: 2000, globalChargeAmount: 0, payableRoundingAmount: 0 }

/** Kobipo'nun KAYDETTİĞİ başlık (fatura POST/PUT, editör, teklif aynı fonksiyon). */
const kobipo = computeInvoiceTotals(KALEMLER, AYARLAR)

let gecen = 0
let kalan = 0
const kontrol = (ad: string, ok: boolean, detay?: string) => {
  ok ? gecen++ : kalan++
  console.log(`  ${ok ? "✓ PASS" : "✗ FAIL"}  ${ad}${detay ? `  — ${detay}` : ""}`)
}
const esit = (a: unknown, b: number) => Math.abs(Number(a) - b) < 0.001
const para = (n: unknown) => Number(n).toFixed(2)

function faturaVerisi(extra: Record<string, unknown> = {}) {
  return {
    invoiceType: "E_ARCHIVE",
    prefix: "TST", // açık prefix → numaratör/örnek payload fetch'leri atlanır
    date: new Date(),
    invoiceNo: "KURUS-TEST",
    customer: {
      name: "SON KULLANICI",
      taxNumber: "11111111111",
      city: "İSTANBUL",
      district: "KADIKÖY",
      address: "TEST ADRES",
    },
    items: KALEMLER,
    ...AYARLAR,
    ...extra,
  }
}

/* ------------------------------------------------------------------ OFFLINE */

async function offline() {
  console.log("\n=== OFFLINE: Mysoft payload'ı ↔ Kobipo başlığı (ağ/veritabanı yok) ===\n")

  const gercekFetch = globalThis.fetch
  globalThis.fetch = (async (url: any) => {
    const u = String(url)
    if (u.includes("/oauth/token")) {
      return new Response(
        JSON.stringify({ access_token: "TEST_TOKEN", token_type: "bearer", expires_in: 3600 }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }
    if (u.includes("getInvoiceOutboxDraftXMLAsZip")) {
      // Sahte ret: provider `payload`ı sonuçla birlikte döndürür — ölçülen o.
      return new Response(JSON.stringify({ succeed: false, message: "TEST-CAPTURE" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    throw new Error("Beklenmeyen ağ çağrısı (testte olmamalı): " + u)
  }) as any

  const provider = new MysoftEInvoiceProvider({
    username: "test",
    passwordText: "test",
    baseUrl: "https://edocumentapi.mytest.tr",
  })
  const r: any = await provider.sendInvoice(faturaVerisi({ draftXmlOnly: true }))
  globalThis.fetch = gercekFetch

  const payload = r?.payload
  if (!payload) {
    console.error("✗ HATA: payload yakalanamadı (draftXmlOnly yolu çalışmadı): " + r?.error)
    process.exit(1)
  }
  const calc = payload.invoiceCalculation
  console.log("Kobipo başlığı :", { net: kobipo.net, vat: kobipo.vat, total: kobipo.total })
  console.log("Mysoft'a giden :", calc, "\n")

  kontrol("isManuelCalculation açık (dip toplamlar bizden gidiyor)", payload.isManuelCalculation === true)
  kontrol("ödenecek = Kobipo totalAmount", esit(calc?.payableAmount, kobipo.total), `${para(calc?.payableAmount)} ↔ ${para(kobipo.total)}`)
  kontrol("vergiler hariç = Kobipo netAmount", esit(calc?.taxExclusiveAmount, kobipo.net), `${para(calc?.taxExclusiveAmount)} ↔ ${para(kobipo.net)}`)
  kontrol(
    "vergiler dahil − vergiler hariç = Kobipo vatAmount",
    esit(calc?.taxInclusiveAmount - calc?.taxExclusiveAmount, kobipo.vat),
    `${para(calc?.taxInclusiveAmount - calc?.taxExclusiveAmount)} ↔ ${para(kobipo.vat)}`,
  )
  kontrol("Reypo örneği: ödenecek 31.906,39", esit(calc?.payableAmount, 31906.39), para(calc?.payableAmount))

  // Satır tutarları da aynı fonksiyondan: Σ satır KDV = başlık KDV.
  const doc = computeDocumentTotals(KALEMLER, AYARLAR, { skipNonPositiveLines: true, withholdingNeedsCode: true })
  // KDV satır seviyesinde `tax` dizisine değil doğrudan `amtVatTra`ya yazılır (provider notu).
  const lines: any[] = payload.invoiceDetail ?? []
  const satirKdv = lines.reduce((s: number, l: any) => s + Number(l.amtVatTra ?? 0), 0)
  const satirMatrah = lines.reduce((s: number, l: any) => s + Number(l.taxableAmtTra ?? 0), 0)
  kontrol("Σ satır KDV (amtVatTra) = Kobipo vatAmount", esit(satirKdv, kobipo.vat), `${para(satirKdv)} ↔ ${para(kobipo.vat)}`)
  kontrol("Σ satır matrah (taxableAmtTra) = Kobipo vatBase", esit(satirMatrah, kobipo.vatBase), `${para(satirMatrah)} ↔ ${para(kobipo.vatBase)}`)
  kontrol(
    "satır sayısı belgeyle aynı (sıfır tutarlı kalem yok)",
    lines.length === doc.lines.length,
    `${lines.length} ↔ ${doc.lines.length}`,
  )
}

/* -------------------------------------------------------------------- CANLI */

async function olcumHedefi(): Promise<{ provider: any; baslik: string; prefix?: string; tenantVkn?: string }> {
  if (TEST_ORTAMI) {
    const username = process.env.MYSOFT_USERNAME?.trim()
    const password = process.env.MYSOFT_PASSWORD?.trim()
    const baseUrl = process.env.MYSOFT_API_URL?.trim()
    if (!username || !password) {
      console.error("MYSOFT_USERNAME / MYSOFT_PASSWORD yok — test ortamı ölçümü yapılamaz.")
      process.exit(1)
    }
    return {
      provider: new MysoftEInvoiceProvider({ username, passwordText: password, baseUrl }),
      baslik: `TEST ORTAMI (${baseUrl})`,
    }
  }

  const { prisma } = await import("@/lib/db/prisma")
  const { COMPANY_PROVIDER_SELECT, resolveCompanyEInvoiceProvider } = await import(
    "@/lib/integrations/e-invoice/company-provider"
  )
  if (!FIRMA) {
    console.error("--firma=<companyId> (ya da --test) gerekli.")
    process.exit(1)
  }
  const company = await prisma.company.findUnique({
    where: { id: FIRMA },
    select: { ...COMPANY_PROVIDER_SELECT, name: true, eArchivePrefix: true },
  })
  if (!company) {
    console.error("Firma bulunamadı: " + FIRMA)
    process.exit(1)
  }
  const resolved = resolveCompanyEInvoiceProvider(company as any)
  if (!resolved.ok) {
    console.error("Sağlayıcı kurulamadı: " + resolved.error)
    process.exit(1)
  }
  await prisma.$disconnect()
  return {
    provider: resolved.provider,
    baslik: `${company.name} [${resolved.mode}]`,
    prefix: company.eArchivePrefix || undefined,
    tenantVkn: resolved.tenantVkn || undefined,
  }
}

const ubl = (xml: string, blok: string, alan: string) => {
  const b = new RegExp(`<cac:${blok}>([\\s\\S]*?)</cac:${blok}>`).exec(xml)?.[1] ?? ""
  const v = new RegExp(`<cbc:${alan}[^>]*>([^<]+)</cbc:${alan}>`).exec(b)?.[1]
  return v == null ? NaN : Number(v)
}

async function canli() {
  const { provider, baslik, prefix, tenantVkn } = await olcumHedefi()
  console.log(`\n=== CANLI ÖLÇÜM: ${baslik} ===\n`)
  console.log("Kobipo başlığı:", { net: kobipo.net, vat: kobipo.vat, total: kobipo.total }, "\n")

  const r: any = await provider.sendInvoice(
    faturaVerisi({ draftXmlOnly: true, prefix, tenantIdentifierNumber: tenantVkn }),
  )
  if (!r?.success) {
    console.error("Taslak XML alınamadı: " + r?.error)
    process.exit(1)
  }
  const xml = String(r.xml)

  // Belgenin resmî dip toplamları (UBL-TR LegalMonetaryTotal) ve toplam KDV.
  const payable = ubl(xml, "LegalMonetaryTotal", "PayableAmount")
  const taxExcl = ubl(xml, "LegalMonetaryTotal", "TaxExclusiveAmount")
  const taxIncl = ubl(xml, "LegalMonetaryTotal", "TaxInclusiveAmount")
  const lineExt = ubl(xml, "LegalMonetaryTotal", "LineExtensionAmount")
  const allowance = ubl(xml, "LegalMonetaryTotal", "AllowanceTotalAmount")
  // Belge seviyesindeki TaxTotal, ilk cac:TaxTotal bloğudur (satırlarınki InvoiceLine içinde).
  const taxTotal = ubl(xml, "TaxTotal", "TaxAmount")

  console.log("Belge (UBL):", { lineExt, allowance, taxExcl, taxTotal, taxIncl, payable }, "\n")

  kontrol("belge PayableAmount = Kobipo totalAmount", esit(payable, kobipo.total), `${para(payable)} ↔ ${para(kobipo.total)}`)
  kontrol("belge TaxExclusiveAmount = Kobipo netAmount", esit(taxExcl, kobipo.net), `${para(taxExcl)} ↔ ${para(kobipo.net)}`)
  kontrol("belge TaxTotal = Kobipo vatAmount", esit(taxTotal, kobipo.vat), `${para(taxTotal)} ↔ ${para(kobipo.vat)}`)
  kontrol("belge TaxInclusiveAmount = matrah + KDV", esit(taxIncl, kobipo.net + kobipo.vat), para(taxIncl))
  kontrol("belge LineExtensionAmount = Kobipo brüt", esit(lineExt, kobipo.gross), `${para(lineExt)} ↔ ${para(kobipo.gross)}`)
  kontrol(
    "belge AllowanceTotalAmount = satır + genel iskonto",
    esit(allowance, kobipo.lineDiscount + kobipo.globalDiscount),
    `${para(allowance)} ↔ ${para(kobipo.lineDiscount + kobipo.globalDiscount)}`,
  )
  kontrol("Reypo örneği: belgede ödenecek 31.906,39", esit(payable, 31906.39), para(payable))

  const lmt = /<cac:LegalMonetaryTotal>[\s\S]*?<\/cac:LegalMonetaryTotal>/.exec(xml)?.[0]
  if (lmt) {
    console.log("--- belgeye yazılan LegalMonetaryTotal ---")
    console.log(lmt.replace(/></g, ">\n<"))
  }
}

async function main() {
  if (CANLI) await canli()
  else await offline()

  console.log("\n--------------------------------------------------")
  console.log(
    kalan === 0
      ? `SONUÇ: ${gecen}/${gecen} kontrol GEÇTİ ✓`
      : `SONUÇ: ${gecen}/${gecen + kalan} geçti — ${kalan} BAŞARISIZ.`,
  )
  process.exit(kalan === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error("HATA:", e?.stack || e?.message || e)
  process.exit(1)
})
