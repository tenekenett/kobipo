require("dotenv").config()
const { PrismaClient } = require("@prisma/client")

const prisma = new PrismaClient()

/**
 * Gelen e-fatura RED → cari borç düşüşü akışını TEST verisiyle uçtan uca denemek için.
 *
 * Neden script? Canlı `respond` rotası reddi önce Mysoft'a gönderir; uydurma bir ETTN
 * Mysoft'ta olmadığından o çağrı patlar ve yerel iptal mantığı hiç çalışmaz. Bu script
 * Mysoft'u atlar ve rotanın YEREL adımlarının BİREBİR aynısını uygular:
 *   - bağlı alış faturası → status=CANCELLED + integrationStatus="REJECTED:RED"
 *   - gelen fatura → status=RED
 * Böylece borç tedarikçi carisinden otomatik düşer ve UI'da "Reddedildi" rozeti çıkar.
 *
 * Kullanım:
 *   node scripts/test-incoming-reject.js setup   <firma>   # senaryoyu kur (bekleyen + borç)
 *   node scripts/test-incoming-reject.js status  <firma>   # mevcut durumu + borcu yaz
 *   node scripts/test-incoming-reject.js reject  <firma>   # reddi simüle et (borç düşer)
 *   node scripts/test-incoming-reject.js cleanup <firma>   # test verisini sil
 *
 * <firma> = Company id / slug / ad (parçası). Verilmezse firmalar listelenir.
 */

// Test verisini bulmak/temizlemek için sabit işaretçiler:
const TEST = {
  supplierCode: "TEST-RED",
  supplierName: "TEST — Reddedilen Fatura (Tedarikçi)",
  supplierSlug: "test-red-tedarikci",
  invoiceNo: "TEST-RED-ALIS",
  invoiceSlug: "test-red-alis",
  incomingUuid: "11111111-1111-4111-8111-111111111111",
  incomingNo: "TEST-RED-EFT-001",
  net: 1000,
  vat: 200,
  total: 1200,
}

async function resolveCompany(ref) {
  const companies = await prisma.company.findMany({
    select: { id: true, name: true, slug: true, isEDonusumEnabled: true },
    orderBy: { createdAt: "asc" },
  })
  if (!ref) {
    console.log("\nBir firma belirtin (id / slug / ad). Mevcut firmalar:")
    for (const c of companies) {
      console.log(`  - ${c.name}   [slug: ${c.slug}]   [id: ${c.id}]${c.isEDonusumEnabled ? "" : "  (e-Dönüşüm KAPALI)"}`)
    }
    return null
  }
  const r = String(ref).toLowerCase()
  const hit =
    companies.find((c) => c.id.toLowerCase() === r) ||
    companies.find((c) => c.slug.toLowerCase() === r) ||
    companies.find((c) => c.name.toLowerCase().includes(r))
  if (!hit) {
    console.error(`HATA: "${ref}" ile eşleşen firma yok.`)
    console.log("Mevcut firmalar:")
    for (const c of companies) console.log(`  - ${c.name}  [slug: ${c.slug}]  [id: ${c.id}]`)
    return null
  }
  return hit
}

// Tedarikçi carisini rotadaki (cari/suppliers/[id]) formülle BİREBİR hesaplar.
async function computeSupplierBalance(supplierId) {
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } })
  if (!supplier) return null

  const invoices = await prisma.invoice.findMany({
    where: { supplierId, status: { notIn: ["CANCELLED", "CONVERTED"] } },
    include: { payments: { select: { amount: true, transactionId: true } } },
  })
  const transactions = await prisma.transaction.findMany({ where: { supplierId } })

  let balance = 0
  for (const inv of invoices) {
    if (inv.type === "PURCHASE") {
      const paid = inv.payments.reduce((s, p) => s + (p.transactionId ? 0 : Number(p.amount)), 0)
      balance += Number(inv.totalAmount) - paid
    }
  }
  for (const t of transactions) {
    if (t.type === "EXPENSE") balance -= Number(t.amount)
    else if (t.type === "INCOME") balance += Number(t.amount)
  }
  balance +=
    supplier.openingBalanceType === "CREDIT"
      ? Number(supplier.openingBalanceAmount)
      : -Number(supplier.openingBalanceAmount)
  return balance
}

const fmtTL = (v) =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(Number(v) || 0)

async function findTestData(companyId) {
  const supplier = await prisma.supplier.findFirst({
    where: { companyId, code: TEST.supplierCode },
  })
  const incoming = await prisma.incomingInvoice.findUnique({
    where: { companyId_uuid: { companyId, uuid: TEST.incomingUuid } },
  })
  const invoice = incoming?.linkedInvoiceId
    ? await prisma.invoice.findUnique({ where: { id: incoming.linkedInvoiceId } })
    : await prisma.invoice.findFirst({ where: { companyId, invoiceNo: TEST.invoiceNo } })
  return { supplier, incoming, invoice }
}

async function cleanup(companyId) {
  const { supplier, incoming, invoice } = await findTestData(companyId)
  if (incoming) await prisma.incomingInvoice.delete({ where: { id: incoming.id } }).catch(() => {})
  if (invoice) await prisma.invoice.delete({ where: { id: invoice.id } }).catch(() => {})
  if (supplier) await prisma.supplier.delete({ where: { id: supplier.id } }).catch(() => {})
  return Boolean(supplier || incoming || invoice)
}

function printLinks(company, supplier, invoice) {
  const c = encodeURIComponent(company.slug)
  console.log("\nUI'da kontrol et (dev sunucusu, ör. http://localhost:3000):")
  console.log(`  • Gelen fatura detay : /alis/gelen-e-faturalar/${TEST.incomingUuid}?company=${c}`)
  console.log(`  • İlişkili alış fat. : /faturalar/${invoice.id}/onizleme?company=${c}`)
  console.log(`  • Tedarikçi cari     : /cari/supplier/${supplier.slug || supplier.id}?company=${c}`)
}

async function setup(company) {
  await cleanup(company.id) // idempotent: önceki test verisini temizle

  const supplier = await prisma.supplier.create({
    data: {
      companyId: company.id,
      code: TEST.supplierCode,
      name: TEST.supplierName,
      slug: TEST.supplierSlug,
      taxNumber: "1111111111",
      openingBalanceAmount: 0,
      openingBalanceType: "DEBIT",
    },
  })

  const invoice = await prisma.invoice.create({
    data: {
      companyId: company.id,
      invoiceNo: TEST.invoiceNo,
      slug: TEST.invoiceSlug,
      type: "PURCHASE",
      invoiceType: "E_INVOICE",
      status: "SENT", // dönüştürmede olduğu gibi onaylı
      supplierId: supplier.id,
      date: new Date(),
      netAmount: TEST.net,
      vatAmount: TEST.vat,
      totalAmount: TEST.total,
      currency: "TRY",
      items: {
        create: [
          {
            description: "TEST kalem — reddedilecek alış",
            unit: "ADET",
            quantity: 1,
            unitPrice: TEST.net,
            vatRate: 20,
            vatAmount: TEST.vat,
            totalAmount: TEST.total,
            order: 0,
          },
        ],
      },
    },
  })

  await prisma.incomingInvoice.create({
    data: {
      companyId: company.id,
      uuid: TEST.incomingUuid,
      invoiceNo: TEST.incomingNo,
      docDate: new Date(),
      senderTaxNumber: supplier.taxNumber,
      senderName: supplier.name,
      profile: "TICARIFATURA", // yanıt (KABUL/RED) bekleyen tek profil
      invoiceType: "SATIS",
      currencyCode: "TRY",
      taxExclusiveAmount: TEST.net,
      taxInclusiveAmount: TEST.total,
      vatAmount: TEST.vat,
      payableAmount: TEST.total,
      status: "BEKLEMEDE", // henüz yanıtlanmadı → Reddet butonu görünür
      isLinkedToPurchase: true, // zaten alışa dönüştürülmüş → borç var
      linkedInvoiceId: invoice.id,
      raw: { test: true, note: "scripts/test-incoming-reject.js ile üretildi" },
    },
  })

  const balance = await computeSupplierBalance(supplier.id)
  console.log("\n✓ TEST senaryosu kuruldu (DURUM: reddedilmeden ÖNCE)")
  console.log("--------------------------------------------------")
  console.log(`Firma            : ${company.name}`)
  console.log(`Tedarikçi        : ${supplier.name}`)
  console.log(`Alış faturası    : ${invoice.invoiceNo}  (status=${invoice.status})`)
  console.log(`Gelen e-fatura   : ${TEST.incomingNo}  (ETTN ${TEST.incomingUuid}, status=BEKLEMEDE)`)
  console.log(`Tedarikçi BORÇ   : ${fmtTL(balance)}   ← reddedince 0'a düşmeli`)
  printLinks(company, supplier, invoice)
  console.log("\nSonra reddi simüle et:  node scripts/test-incoming-reject.js reject " + company.slug)
}

async function reject(company) {
  const { supplier, incoming, invoice } = await findTestData(company.id)
  if (!incoming) {
    console.error("HATA: Test gelen faturası yok. Önce 'setup' çalıştırın.")
    return
  }
  if ((incoming.status || "").toUpperCase() === "RED") {
    console.log("Bu test faturası zaten reddedilmiş. Mevcut durum:")
    return status(company)
  }

  const before = supplier ? await computeSupplierBalance(supplier.id) : null

  // === respond/route.ts reject akışının YEREL kısmının birebir aynısı ===
  // (Stok geri alma burada no-op: test faturasında stok hareketi oluşturmadık.)
  await prisma.$transaction(async (tx) => {
    if (incoming.isLinkedToPurchase && incoming.linkedInvoiceId) {
      const linked = await tx.invoice.findUnique({
        where: { id: incoming.linkedInvoiceId },
        select: { id: true, status: true },
      })
      if (linked && linked.status !== "CANCELLED") {
        await tx.invoice.update({
          where: { id: linked.id },
          data: { status: "CANCELLED", integrationStatus: "REJECTED:RED" },
        })
      }
    }
    await tx.incomingInvoice.update({
      where: { companyId_uuid: { companyId: company.id, uuid: TEST.incomingUuid } },
      data: { status: "RED" },
    })
  })

  const after = supplier ? await computeSupplierBalance(supplier.id) : null
  console.log("\n✓ RED simüle edildi (DURUM: reddedildikten SONRA)")
  console.log("--------------------------------------------------")
  console.log(`Alış faturası    : ${invoice?.invoiceNo}  →  status=CANCELLED, integrationStatus=REJECTED:RED`)
  console.log(`Gelen e-fatura   : ${TEST.incomingNo}  →  status=RED`)
  console.log(`Tedarikçi BORÇ   : ${fmtTL(before)}  →  ${fmtTL(after)}`)
  if (Number(after) === 0) console.log("→ ✓ Borç doğru şekilde cariden DÜŞTÜ.")
  else console.log("→ ⚠ Borç beklenmedik: incele.")
  if (supplier && invoice) printLinks(company, supplier, invoice)
  console.log("\nTemizlemek için:  node scripts/test-incoming-reject.js cleanup " + company.slug)
}

async function status(company) {
  const { supplier, incoming, invoice } = await findTestData(company.id)
  if (!supplier && !incoming && !invoice) {
    console.log("Test verisi yok. 'setup' ile oluşturun.")
    return
  }
  const balance = supplier ? await computeSupplierBalance(supplier.id) : null
  console.log("\nMevcut TEST durumu")
  console.log("--------------------------------------------------")
  console.log(`Tedarikçi        : ${supplier?.name || "-"}`)
  console.log(`Alış faturası    : ${invoice?.invoiceNo || "-"}  (status=${invoice?.status || "-"}, integ=${invoice?.integrationStatus || "-"})`)
  console.log(`Gelen e-fatura   : ${incoming?.invoiceNo || "-"}  (status=${incoming?.status || "-"}, bağlı=${incoming?.isLinkedToPurchase})`)
  console.log(`Tedarikçi BORÇ   : ${fmtTL(balance)}`)
  if (supplier && invoice) printLinks(company, supplier, invoice)
}

// ============================================================================
// verify: uçtan uca otomatik doğrulama (PASS/FAIL). Sadece eski red sonucunu
// değil, son eklenen iki düzeltmeyi de test eder:
//   (1) inbox/sync yereldeki RED/KABUL yanıtını GERİ EZMEZ.
//   (2) reddedilen gelen fatura (status ezilse bile) alışa DÖNÜŞTÜRÜLEMEZ.
// Test verisini kurar, doğrular ve sonunda temizler. Kod yollarındaki KARAR
// ifadeleri (effectiveStatus / conversion guard) route'lardan birebir kopyadır.
// ============================================================================

// inbox/sync/route.ts ile BİREBİR aynı ifade.
function computeEffectiveStatus(localStatus, incomingStatus) {
  const localStatusUpper = (localStatus || "").toUpperCase()
  const incomingStatusUpper = (incomingStatus || "").toUpperCase()
  const localIsTerminal = localStatusUpper === "KABUL" || localStatusUpper === "RED"
  const incomingIsTerminal = incomingStatusUpper === "KABUL" || incomingStatusUpper === "RED"
  return localIsTerminal && !incomingIsTerminal ? localStatus : incomingStatus
}

// invoices/route.ts (dönüştürme koruması) ile BİREBİR aynı mantık.
async function isConversionBlocked(companyId, uuid) {
  const incoming = await prisma.incomingInvoice.findUnique({
    where: { companyId_uuid: { companyId, uuid } },
    select: { status: true, linkedInvoiceId: true },
  })
  let alreadyRejected = (incoming?.status || "").toUpperCase() === "RED"
  if (!alreadyRejected && incoming?.linkedInvoiceId) {
    const linked = await prisma.invoice.findUnique({
      where: { id: incoming.linkedInvoiceId },
      select: { status: true, integrationStatus: true },
    })
    if (
      linked?.status === "CANCELLED" &&
      (linked.integrationStatus || "").toUpperCase().includes("REJECTED")
    ) {
      alreadyRejected = true
    }
  }
  return alreadyRejected
}

async function verify(company) {
  const results = []
  const check = (name, ok, detail) => {
    results.push({ name, ok })
    console.log(`  ${ok ? "✓ PASS" : "✗ FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`)
  }

  console.log(`\n=== GELEN E-FATURA REDDETME — OTOMATİK DOĞRULAMA (${company.name}) ===\n`)

  // 1) Temiz kurulum: borç oluşmuş bekleyen fatura
  await cleanup(company.id)
  const supplier = await prisma.supplier.create({
    data: {
      companyId: company.id, code: TEST.supplierCode, name: TEST.supplierName,
      slug: `${TEST.supplierSlug}-${Date.now()}`, taxNumber: "1111111111",
      openingBalanceAmount: 0, openingBalanceType: "DEBIT",
    },
  })
  const invoice = await prisma.invoice.create({
    data: {
      companyId: company.id, invoiceNo: TEST.invoiceNo, slug: `${TEST.invoiceSlug}-${Date.now()}`,
      type: "PURCHASE", invoiceType: "E_INVOICE", status: "SENT", supplierId: supplier.id,
      date: new Date(), netAmount: TEST.net, vatAmount: TEST.vat, totalAmount: TEST.total, currency: "TRY",
    },
  })
  await prisma.incomingInvoice.create({
    data: {
      companyId: company.id, uuid: TEST.incomingUuid, invoiceNo: TEST.incomingNo, docDate: new Date(),
      senderTaxNumber: supplier.taxNumber, senderName: supplier.name, profile: "TICARIFATURA",
      invoiceType: "SATIS", currencyCode: "TRY", taxExclusiveAmount: TEST.net, taxInclusiveAmount: TEST.total,
      vatAmount: TEST.vat, payableAmount: TEST.total, status: "BEKLEMEDE",
      isLinkedToPurchase: true, linkedInvoiceId: invoice.id, raw: { test: true },
    },
  })

  console.log("[1] Kurulum: bekleyen gelen fatura + bağlı alış faturası (borç var)")
  const balanceBefore = await computeSupplierBalance(supplier.id)
  check("Reddetmeden önce tedarikçi borcu = 1200 TL", Number(balanceBefore) === TEST.total, fmtTL(balanceBefore))

  // 2) Reddet (respond route yerel etkisi = voidInvoice etkisi)
  console.log("\n[2] Reddet: bağlı fatura CANCELLED + gelen fatura RED")
  await prisma.$transaction(async (tx) => {
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: "CANCELLED", integrationStatus: "REJECTED:RED" },
    })
    await tx.incomingInvoice.update({
      where: { companyId_uuid: { companyId: company.id, uuid: TEST.incomingUuid } },
      data: { status: "RED" },
    })
  })
  const balanceAfter = await computeSupplierBalance(supplier.id)
  check("Reddettikten sonra tedarikçi borcu = 0 TL (borç düştü)", Number(balanceAfter) === 0, fmtTL(balanceAfter))
  const inv2 = await prisma.invoice.findUnique({ where: { id: invoice.id } })
  check("Bağlı alış faturası CANCELLED + REJECTED", inv2.status === "CANCELLED" && (inv2.integrationStatus || "").includes("REJECTED"), `${inv2.status} / ${inv2.integrationStatus}`)

  // 3) DÜZELTME (a): sync yereldeki RED'i geri ezmez
  console.log("\n[3] Senkron koruması: Mysoft 'YANIT_BEKLENIYOR' dönse bile yerel RED korunur")
  const existing = await prisma.incomingInvoice.findUnique({
    where: { companyId_uuid: { companyId: company.id, uuid: TEST.incomingUuid } },
    select: { status: true },
  })
  const effective = computeEffectiveStatus(existing.status, "YANIT_BEKLENIYOR")
  await prisma.incomingInvoice.update({
    where: { companyId_uuid: { companyId: company.id, uuid: TEST.incomingUuid } },
    data: { status: effective },
  })
  const afterSync = await prisma.incomingInvoice.findUnique({
    where: { companyId_uuid: { companyId: company.id, uuid: TEST.incomingUuid } },
    select: { status: true },
  })
  check("Senkron sonrası gelen fatura hâlâ RED (geri ezilmedi)", afterSync.status === "RED", afterSync.status)
  const balanceAfterSync = await computeSupplierBalance(supplier.id)
  check("Senkron sonrası borç hâlâ 0 TL", Number(balanceAfterSync) === 0, fmtTL(balanceAfterSync))
  // Karşı kontrol: koruma olmasaydı non-terminal değer yazılırdı.
  check("Karşı kontrol: koruma mantığı non-terminal değeri elerdi", computeEffectiveStatus("RED", "YANIT_BEKLENIYOR") === "RED" && computeEffectiveStatus("BEKLEMEDE", "KABUL") === "KABUL")

  // 4) DÜZELTME (b): reddedilen fatura dönüştürülemez (iki yol)
  console.log("\n[4] Dönüştürme engeli: reddedilen fatura tekrar alışa dönüştürülemez")
  const blockedByStatus = await isConversionBlocked(company.id, TEST.incomingUuid)
  check("status=RED iken dönüştürme engellenir", blockedByStatus === true)
  // Yarış durumu: status yanlışlıkla BEKLEMEDE'ye dönmüş; bağlı fatura CANCELLED+REJECTED
  await prisma.incomingInvoice.update({
    where: { companyId_uuid: { companyId: company.id, uuid: TEST.incomingUuid } },
    data: { status: "BEKLEMEDE" },
  })
  const blockedByLinked = await isConversionBlocked(company.id, TEST.incomingUuid)
  check("status ezilse bile (bağlı fatura CANCELLED+REJECTED) dönüştürme engellenir", blockedByLinked === true)

  // 5) Temizlik
  console.log("\n[5] Temizlik")
  const removed = await cleanup(company.id)
  check("Test verisi silindi", removed === true)

  const passed = results.filter((r) => r.ok).length
  const failed = results.length - passed
  console.log("\n--------------------------------------------------")
  console.log(`SONUÇ: ${passed}/${results.length} test geçti${failed ? `  (${failed} BAŞARISIZ)` : "  — HEPSİ GEÇTİ ✓"}`)
  if (failed) process.exitCode = 1
}

async function main() {
  const [, , cmdArg, companyRef] = process.argv
  const cmd = (cmdArg || "").toLowerCase()
  if (!["setup", "reject", "status", "cleanup", "verify"].includes(cmd)) {
    console.log("Kullanım: node scripts/test-incoming-reject.js <setup|status|reject|cleanup|verify> <firma>")
    const company = await resolveCompany(companyRef)
    void company
    return
  }
  const company = await resolveCompany(companyRef)
  if (!company) return

  if (cmd === "setup") return setup(company)
  if (cmd === "reject") return reject(company)
  if (cmd === "status") return status(company)
  if (cmd === "verify") return verify(company)
  if (cmd === "cleanup") {
    const removed = await cleanup(company.id)
    console.log(removed ? "✓ Test verisi silindi." : "Silinecek test verisi yoktu.")
    return
  }
}

main()
  .catch((e) => {
    console.error("HATA:", e?.message || e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
