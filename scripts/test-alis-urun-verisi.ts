/**
 * ALIŞ RAPORU "ALINAN ÜRÜNLER" — DENEME VERİSİ (ekle / sil).
 *
 *   npx tsx scripts/test-alis-urun-verisi.ts --durum   # ne var, salt okur
 *   npx tsx scripts/test-alis-urun-verisi.ts --ekle    # Reypo Medya'ya deneme alışları
 *   npx tsx scripts/test-alis-urun-verisi.ts --sil     # hepsini geri al
 *
 * Amaç: alış raporunun ürün tablosunu (kaydırma, sütun hizası, fiyat okları)
 * gerçek ekranda bol satırla görmek. Kullanıcı kararı (2026-10-01): veri Reypo
 * Medya Ajansı'na, %20 KDV'li ve birkaç TEST tedarikçisiyle eklenir.
 *
 * İZOLASYON:
 *  - Tedarikçiler "TEST — … (SİLİNECEK)" adıyla AYRI açılır; gerçek carilere dokunulmaz.
 *  - Kalemler serbest metindir (ürün kartı açılmaz) ve alışta "stok girişi
 *    yapılmasın" işaretlidir — stok değişmez.
 *  - Fatura numarası "TST-" ile başlar, notunda MARKER durur. Silme yalnız iki
 *    işareti birden taşıyan faturaya dokunur.
 *  - Mysoft/GİB'e hiçbir şey gitmez: alış faturası MANUAL'dir, `sendInvoice` yok.
 *
 * YAN ETKİLER (silinene kadar): Reypo'nun Eylül KDV raporunda indirilecek KDV,
 * pano ve cari listesi (TEST tedarikçilerine borç). Fatura çekirdeği otomatik
 * muhasebe kaydı ve aylık fatura sayacı da yazar; `--sil` ikisini de geri alır
 * (uygulamadaki fatura silmesiyle aynı adımlar — app/api/e-donusum/invoices/[id]
 * DELETE). Muhasebe fiş numaralarında, uygulamadan silmede olduğu gibi boşluk kalır.
 */
import "dotenv/config"
import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local", override: true })

import { prisma } from "@/lib/db/prisma"
import { trustedSystemActor } from "@/lib/api/write-actor"
import { createInvoiceFromBody } from "@/lib/invoice/create-invoice"
import { revertInvoiceStock } from "@/lib/stock/warehouse"

const COMPANY_ID = "cmojuwru30002my8i42blsjch" // Reypo Medya Ajansı (merkez)
const MARKER = "KOBIPO-TEST-ALIS-URUN"
const NOTE = `${MARKER} — deneme verisi; scripts/test-alis-urun-verisi.ts --sil ile silinir.`
const SUPPLIER_PREFIX = "TEST — "
const SUPPLIER_SUFFIX = " (SİLİNECEK)"
const ACTOR = "system:test-alis-urun"

type Line = { d: string; u: string; q: number; p: number }
type Doc = { no: string; date: string; supplier: string; lines: Line[]; returnKind?: "PURCHASE" }

const SUPPLIERS = [
  "Ege Kırtasiye Toptan",
  "Anadolu Ambalaj San.",
  "Marmara Temizlik Ürünleri",
  "Başkent Bilişim Donanım",
  "Lezzet Gıda Toptan",
]

// Aynı ürün farklı fiyatla birden çok kez alınır: ortalama ≠ son fiyat (▲/▼ okları).
const DOCS: Doc[] = [
  { no: "TST-ALIS-001", date: "2026-09-03", supplier: "Ege Kırtasiye Toptan", lines: [
    { d: "A4 Fotokopi Kağıdı 80 gr", u: "KOLİ", q: 20, p: 610 },
    { d: "Tükenmez Kalem Mavi", u: "ADET", q: 200, p: 6.5 },
    { d: "Zımba Teli No:10", u: "KUTU", q: 50, p: 14 },
    { d: "Klasör Geniş", u: "ADET", q: 40, p: 38 },
  ] },
  { no: "TST-ALIS-002", date: "2026-09-04", supplier: "Anadolu Ambalaj San.", lines: [
    { d: "Koli 40x30x30", u: "ADET", q: 500, p: 11.8 },
    { d: "Streç Film 50 cm", u: "RULO", q: 30, p: 285 },
    { d: "Koli Bandı Şeffaf", u: "RULO", q: 120, p: 24.5 },
  ] },
  { no: "TST-ALIS-003", date: "2026-09-06", supplier: "Marmara Temizlik Ürünleri", lines: [
    { d: "Yüzey Temizleyici 5 L", u: "ADET", q: 24, p: 165 },
    { d: "Çöp Poşeti Jumbo", u: "PAKET", q: 60, p: 42 },
    { d: "Kağıt Havlu 12'li", u: "KOLİ", q: 15, p: 389 },
    { d: "Sıvı Sabun 5 L", u: "ADET", q: 18, p: 129 },
  ] },
  { no: "TST-ALIS-004", date: "2026-09-08", supplier: "Başkent Bilişim Donanım", lines: [
    { d: "Kablosuz Mouse", u: "ADET", q: 12, p: 449 },
    { d: "USB-C Şarj Kablosu 1 m", u: "ADET", q: 25, p: 119 },
    { d: "27\" IPS Monitör", u: "ADET", q: 3, p: 6890 },
  ] },
  { no: "TST-ALIS-005", date: "2026-09-10", supplier: "Lezzet Gıda Toptan", lines: [
    { d: "Kahve Çekirdeği Espresso", u: "KG", q: 12, p: 840 },
    { d: "Şeker Küp 1 kg", u: "PAKET", q: 30, p: 64 },
    { d: "Su 0,5 L (24'lü)", u: "KOLİ", q: 40, p: 96 },
    { d: "Siyah Çay 1 kg", u: "KG", q: 10, p: 310 },
  ] },
  { no: "TST-ALIS-006", date: "2026-09-12", supplier: "Ege Kırtasiye Toptan", lines: [
    { d: "A4 Fotokopi Kağıdı 80 gr", u: "KOLİ", q: 25, p: 645 },
    { d: "Post-it 76x76", u: "PAKET", q: 60, p: 27 },
    { d: "Toner HP 85A Muadil", u: "ADET", q: 6, p: 780 },
  ] },
  { no: "TST-ALIS-007", date: "2026-09-14", supplier: "Anadolu Ambalaj San.", lines: [
    { d: "Koli 40x30x30", u: "ADET", q: 400, p: 12.9 },
    { d: "Balonlu Naylon 100 cm", u: "METRE", q: 300, p: 9.75 },
    { d: "Karton Bardak 7 oz", u: "KOLİ", q: 8, p: 720 },
  ] },
  { no: "TST-ALIS-008", date: "2026-09-16", supplier: "Başkent Bilişim Donanım", lines: [
    { d: "SSD 1 TB NVMe", u: "ADET", q: 5, p: 2350 },
    { d: "Ethernet Kablosu Cat6", u: "METRE", q: 150, p: 14.2 },
    { d: "Kablosuz Mouse", u: "ADET", q: 8, p: 419 },
  ] },
  { no: "TST-ALIS-009", date: "2026-09-18", supplier: "Marmara Temizlik Ürünleri", lines: [
    { d: "Mikrofiber Bez", u: "ADET", q: 100, p: 18 },
    { d: "Çamaşır Suyu 4 L", u: "ADET", q: 30, p: 74 },
    { d: "Yüzey Temizleyici 5 L", u: "ADET", q: 20, p: 182 },
  ] },
  { no: "TST-ALIS-010", date: "2026-09-20", supplier: "Lezzet Gıda Toptan", lines: [
    { d: "Kahve Çekirdeği Espresso", u: "KG", q: 15, p: 795 },
    { d: "Süt 1 L (12'li)", u: "KOLİ", q: 20, p: 342 },
  ] },
  { no: "TST-ALIS-011", date: "2026-09-23", supplier: "Ege Kırtasiye Toptan", lines: [
    { d: "Tükenmez Kalem Mavi", u: "ADET", q: 150, p: 7.2 },
    { d: "Klasör Geniş", u: "ADET", q: 30, p: 41.5 },
    { d: "Dosya Gömlek Telli", u: "PAKET", q: 40, p: 55 },
  ] },
  { no: "TST-ALIS-012", date: "2026-09-25", supplier: "Anadolu Ambalaj San.", lines: [
    { d: "Streç Film 50 cm", u: "RULO", q: 20, p: 268 },
    { d: "Koli Bandı Şeffaf", u: "RULO", q: 80, p: 26 },
  ] },
  { no: "TST-ALIS-013", date: "2026-09-27", supplier: "Başkent Bilişim Donanım", lines: [
    { d: "USB-C Şarj Kablosu 1 m", u: "ADET", q: 20, p: 109 },
    { d: "Klavye Türkçe Q", u: "ADET", q: 10, p: 389 },
  ] },
  { no: "TST-ALIS-014", date: "2026-09-29", supplier: "Lezzet Gıda Toptan", lines: [
    { d: "Siyah Çay 1 kg", u: "KG", q: 8, p: 335 },
    { d: "Şeker Küp 1 kg", u: "PAKET", q: 20, p: 61 },
    { d: "Kağıt Peçete", u: "KOLİ", q: 12, p: 210 },
  ] },
  // Alış İADESİ: miktar ve tutar listeden düşer, "son alış fiyatı" iadeden okunmaz.
  { no: "TST-IAD-001", date: "2026-09-24", supplier: "Ege Kırtasiye Toptan", returnKind: "PURCHASE", lines: [
    { d: "Klasör Geniş", u: "ADET", q: 5, p: 38 },
  ] },
]

const supplierName = (base: string) => `${SUPPLIER_PREFIX}${base}${SUPPLIER_SUFFIX}`

async function findTestInvoices() {
  return prisma.invoice.findMany({
    where: { companyId: COMPANY_ID, invoiceNo: { startsWith: "TST-" }, notes: { contains: MARKER } },
    select: { id: true, invoiceNo: true, createdAt: true },
  })
}

async function findTestSuppliers() {
  return prisma.supplier.findMany({
    where: { companyId: COMPANY_ID, name: { startsWith: SUPPLIER_PREFIX, endsWith: SUPPLIER_SUFFIX } },
    select: { id: true, name: true },
  })
}

async function durum() {
  const [invoices, suppliers] = await Promise.all([findTestInvoices(), findTestSuppliers()])
  console.log(`TEST faturası: ${invoices.length}, TEST tedarikçisi: ${suppliers.length}`)
  for (const s of suppliers) console.log("  ", s.name)
}

async function ekle() {
  const company = await prisma.company.findUnique({ where: { id: COMPANY_ID }, select: { name: true } })
  if (!company) throw new Error("Reypo Medya Ajansı bulunamadı")
  const existing = await findTestInvoices()
  if (existing.length > 0) {
    throw new Error(`Zaten ${existing.length} TEST faturası var — önce --sil çalıştırın.`)
  }

  const supplierIds = new Map<string, string>()
  for (const base of SUPPLIERS) {
    const found = await prisma.supplier.findFirst({
      where: { companyId: COMPANY_ID, name: supplierName(base) },
      select: { id: true },
    })
    const row =
      found ??
      (await prisma.supplier.create({ data: { companyId: COMPANY_ID, name: supplierName(base) }, select: { id: true } }))
    supplierIds.set(base, row.id)
  }

  const actor = trustedSystemActor(ACTOR)
  let created = 0
  for (const doc of DOCS) {
    const body = {
      companyId: COMPANY_ID,
      invoiceNo: doc.no,
      type: doc.returnKind ? "RETURN" : "PURCHASE",
      returnKind: doc.returnKind,
      invoiceType: "MANUAL",
      supplierId: supplierIds.get(doc.supplier),
      date: doc.date,
      currency: "TRY",
      notes: NOTE,
      skipStock: true,
      items: doc.lines.map((l) => ({ description: l.d, unit: l.u, quantity: l.q, unitPrice: l.p, vatRate: 20 })),
    }
    const res = await createInvoiceFromBody(async () => body, actor)
    const json = await res.json().catch(() => ({}))
    if (res.status >= 300) {
      console.error(`✗ ${doc.no}: ${res.status} ${JSON.stringify(json)}`)
      throw new Error("Fatura açılamadı — yarım kalanı temizlemek için --sil çalıştırın.")
    }
    created++
    console.log(`✓ ${doc.no} ${doc.date} ${doc.supplier} — ${doc.lines.length} kalem`)
  }
  console.log(`\n${created} belge, ${SUPPLIERS.length} TEST tedarikçisi eklendi (${company.name}).`)
}

async function sil() {
  const invoices = await findTestInvoices()
  const months = new Map<string, number>()
  for (const inv of invoices) {
    await prisma.$transaction(
      async (tx) => {
        // Uygulamadaki fatura silmesiyle AYNI adımlar (bkz. başlık).
        await revertInvoiceStock(tx, {
          companyId: COMPANY_ID,
          invoiceId: inv.id,
          invoiceNo: inv.invoiceNo,
          createdBy: ACTOR,
        })
        await tx.invoice.delete({ where: { id: inv.id } })
      },
      { timeout: 20000 },
    )
    // Aylık fatura sayacı açılış AYININ satırına yazıldı (lib/middleware/usage.ts).
    const key = `${inv.createdAt.getFullYear()}-${inv.createdAt.getMonth()}`
    months.set(key, (months.get(key) ?? 0) + 1)
    console.log(`✓ silindi ${inv.invoiceNo}`)
  }

  for (const [key, count] of months) {
    const [year, month] = key.split("-").map(Number)
    const periodStart = new Date(year, month, 1)
    const row = await prisma.usageLimit.findFirst({
      where: { companyId: COMPANY_ID, key: "invoices_monthly", periodStart },
      select: { id: true, currentValue: true },
    })
    if (row) {
      await prisma.usageLimit.update({
        where: { id: row.id },
        data: { currentValue: Math.max(0, row.currentValue - count) },
      })
      console.log(`✓ aylık fatura sayacı ${count} geri alındı (${year}-${String(month + 1).padStart(2, "0")})`)
    }
  }

  const suppliers = await findTestSuppliers()
  for (const s of suppliers) {
    await prisma.supplier.delete({ where: { id: s.id } })
    console.log(`✓ silindi ${s.name}`)
  }
  console.log(`\n${invoices.length} belge ve ${suppliers.length} TEST tedarikçisi silindi.`)
}

async function main() {
  const mode = process.argv.slice(2).find((a) => ["--ekle", "--sil", "--durum"].includes(a))
  if (mode === "--ekle") await ekle()
  else if (mode === "--sil") await sil()
  else await durum()
  await prisma.$disconnect()
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error)
  await prisma.$disconnect()
  process.exit(1)
})
