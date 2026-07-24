/**
 * "NO:1" adres regresyon testi (OFFLINE, stateless).
 *
 * Amaç: giden e-fatura payload'ında invoiceAccount.buildingNumber artık SABİT "1"
 * göndermiyor; carinin serbest adres metni olduğu gibi streetName'e gidiyor.
 *
 * Yöntem: GERÇEK MysoftEInvoiceProvider.sendInvoice'u draftPdfOnly moduyla çalıştırır,
 * ama globalThis.fetch'i taklit ederek (a) token'ı sahteler, (b) taslak POST'unun
 * gövdesindeki asıl payload'ı yakalar. Mysoft'a hiç gidilmez, kayıt bırakmaz.
 *
 * Çalıştırma:  npx tsx scripts/test-invoice-address.mts
 */
import { MysoftEInvoiceProvider } from "../lib/integrations/e-invoice/mysoft-provider"

// Kapı/no dahil, kullanıcının cari kartına yazdığı gibi tek serbest adres metni.
const DISTINCT_ADDR = "MAHMUTBEY MAH. TAŞOCAĞI YOLU CAD. 3/42 BAĞCILAR"

let capturedPayload: any = null
const realFetch = globalThis.fetch

globalThis.fetch = (async (url: any, init: any) => {
  const u = String(url)
  if (u.includes("/oauth/token")) {
    return new Response(
      JSON.stringify({ access_token: "TEST_TOKEN", token_type: "bearer", expires_in: 3600 }),
      { status: 200, headers: { "content-type": "application/json" } },
    )
  }
  if (u.includes("getInvoiceOutboxDraftPdfAsZip")) {
    capturedPayload = JSON.parse(String(init?.body ?? "{}"))
    // Payload'ı yakaladık; provider'ın gerisi (zip→pdf) bizi ilgilendirmiyor.
    return new Response(JSON.stringify({ succeed: false, message: "TEST-CAPTURE" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  }
  throw new Error("Beklenmeyen ağ çağrısı (testte olmamalı): " + u)
}) as any

async function main() {
  const provider = new MysoftEInvoiceProvider({
    username: "test",
    passwordText: "test",
    baseUrl: "https://edocumentapi.mytest.tr",
  })

  await provider.sendInvoice({
    invoiceType: "E_ARCHIVE", // placeholder VKN kontrolüne takılmamak için (e-Arşiv)
    draftPdfOnly: true,
    prefix: "TST", // açık prefix → numaratör/örnek fetch'leri atlanır
    date: new Date(),
    customer: {
      name: "TEST MÜŞTERİ A.Ş.",
      taxNumber: "1234567890",
      taxOffice: "TEST VD",
      address: DISTINCT_ADDR,
      city: "İSTANBUL",
      district: "BAĞCILAR",
    },
    items: [{ description: "Deneme Ürün", quantity: 1, unitPrice: 100, vatRate: 20, productId: "URN-1" }],
  })

  globalThis.fetch = realFetch

  if (!capturedPayload) {
    console.error("✗ HATA: payload yakalanamadı (draftPdfOnly yolu çalışmadı).")
    process.exit(1)
  }

  const acc = capturedPayload.invoiceAccount || {}
  console.log("\nYakalanan invoiceAccount:")
  console.log(JSON.stringify(acc, null, 2))

  const results: Array<{ name: string; ok: boolean; detail?: string }> = []
  const check = (name: string, ok: boolean, detail?: string) => {
    results.push({ name, ok })
    console.log(`  ${ok ? "✓ PASS" : "✗ FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`)
  }

  console.log("\n=== NO:1 ADRES REGRESYON TESTİ ===")
  check(
    "buildingNumber artık gönderilmiyor (sabit '1' yok)",
    acc.buildingNumber === undefined,
    `buildingNumber=${JSON.stringify(acc.buildingNumber)}`,
  )
  check(
    "streetName = carinin serbest adres metni (bozulmadan)",
    acc.streetName === DISTINCT_ADDR,
    `streetName=${JSON.stringify(acc.streetName)}`,
  )
  check(
    "citySubdivision = ilçe (BAĞCILAR)",
    acc.citySubdivision === "BAĞCILAR",
    `citySubdivision=${JSON.stringify(acc.citySubdivision)}`,
  )
  // Karşı-kontrol: tüm payload metninde sabit "buildingNumber":"1" izi kalmamalı.
  const raw = JSON.stringify(capturedPayload)
  check('Payload genelinde `"buildingNumber":"1"` izi yok', !raw.includes('"buildingNumber":"1"'))

  const failed = results.filter((r) => !r.ok).length
  console.log("\n--------------------------------------------------")
  console.log(
    failed === 0
      ? `SONUÇ: ${results.length}/${results.length} test GEÇTİ ✓  — adreste sabit "No:1" kaynağı kaldırıldı.`
      : `SONUÇ: ${results.length - failed}/${results.length} geçti — ${failed} BAŞARISIZ.`,
  )
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error("HATA:", e?.stack || e?.message || e)
  process.exit(1)
})
