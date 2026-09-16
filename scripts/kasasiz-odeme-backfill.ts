/**
 * KASASIZ geçmiş fatura ödemelerini varsayılan Kasa'ya işler.
 *
 *   npx tsx scripts/kasasiz-odeme-backfill.ts                          → RAPOR (yazmaz)
 *   npx tsx scripts/kasasiz-odeme-backfill.ts --uygula                 → yazar
 *   npx tsx scripts/kasasiz-odeme-backfill.ts --uygula --atla=<ödemeId>[,<ödemeId>…]
 *   npx tsx scripts/kasasiz-odeme-backfill.ts --firma=<companyId>      → tek firma
 *
 * Neden gerekli: hesap seçilmeden girilen fatura ödemesi yalnız `InvoicePayment`
 * yazıyordu (`Transaction.accountId` zorunlu). Fatura "ödendi", cari borç düştü,
 * ama para hiçbir kasada yoktu — kasa bakiyesi, Finans > Hareketler, pano geliri
 * ve nakit projeksiyonu görmüyordu. Yazma yolu düzeltildi (hesapsız ödeme
 * varsayılan Kasa'ya gider, bkz. lib/finans/varsayilan-kasa.ts); bu betik ondan
 * ÖNCEKİ kayıtları tamamlar. Devir: docs/finans/KASASIZ-ODEME.md.
 *
 * `backfill-payment-transactions.mjs` ile FARKI — karıştırılmasın:
 *  - O betik `accountId` DOLU ödemeleri işler ve bakiyeye DOKUNMAZ: para ödeme
 *    anında o hesaba işlenmişti, yalnız hareket kaydı eksikti.
 *  - Bu betik `accountId` BOŞ ödemeleri işler: hiçbir hesaba dokunulmamıştı, yani
 *    hareketle birlikte Kasa BAKİYESİ DE güncellenir. Bakiyeyi atlamak, hareket
 *    listesi ile bakiye kartını ayrıştırırdı.
 *
 * GÜVENLİK:
 *  - Seçim: `transactionId` VE `accountId` boş; iptal/dönüştürülmüş faturanın
 *    ödemesi atlanır (onların etkisi zaten geri alınmış sayılıyor).
 *  - Hesap, uygulamanın kullandığı fonksiyondan gelir (`ensureDefaultCashAccount`):
 *    en eski aktif CASH hesabı, yoksa "Kasa" açılır. BANK'a düşülmez.
 *  - Yön uçla aynı kural: satış ve ALIŞ İADESİ tahsilattır (INCOME, bakiye +),
 *    alış ve satış iadesi ödemedir (EXPENSE, bakiye −).
 *  - Her ödeme tek veritabanı işleminde yazılır (hareket + bakiye + ödeme bağı).
 *  - Tekrar çalıştırılabilir: işlenen ödeme `transactionId` kazandığı için bir
 *    daha seçilmez.
 *  - Tarih ÖDEMENİN tarihidir: nakit akışı grafiği bugüne yığılmamalı.
 */
import { prisma } from "@/lib/db/prisma"
import { ensureDefaultCashAccount, DEFAULT_CASH_ACCOUNT } from "@/lib/finans/varsayilan-kasa"
import { isPurchaseReturn } from "@/lib/cari/invoice-direction"

const args = process.argv.slice(2)
const APPLY = args.includes("--uygula")
const argValue = (name: string) => (args.find((a) => a.startsWith(`--${name}=`)) || "").split("=")[1] || ""
const onlyCompany = argValue("firma") || null
const skipIds = new Set(argValue("atla").split(",").map((s) => s.trim()).filter(Boolean))

const money = (v: unknown) =>
  Number(v ?? 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const day = (d: Date) => d.toISOString().slice(0, 10)

async function main() {
  const payments = await prisma.invoicePayment.findMany({
    where: {
      transactionId: null,
      accountId: null,
      ...(onlyCompany ? { companyId: onlyCompany } : {}),
      invoice: { status: { notIn: ["CANCELLED", "CONVERTED"] } },
    },
    select: {
      id: true,
      companyId: true,
      amount: true,
      paymentDate: true,
      paymentMethod: true,
      reference: true,
      createdBy: true,
      invoice: {
        select: {
          invoiceNo: true,
          type: true,
          returnKind: true,
          currency: true,
          customerId: true,
          supplierId: true,
          customer: { select: { name: true } },
          supplier: { select: { name: true } },
        },
      },
      company: { select: { name: true } },
    },
    orderBy: [{ companyId: "asc" }, { paymentDate: "asc" }],
  })

  const skippedUnknown = [...skipIds].filter((id) => !payments.some((p) => p.id === id))
  if (skippedUnknown.length > 0) {
    // Yanlış yazılmış id sessizce yutulursa "atladım" sanılan kayıt işlenirdi.
    console.error(`--atla içindeki bu id'ler seçimde yok: ${skippedUnknown.join(", ")}`)
    process.exitCode = 1
    return
  }

  console.log(`\n${APPLY ? "YAZILIYOR" : "RAPOR (yazılmıyor)"} — ${payments.length} kasasız ödeme\n`)
  if (payments.length === 0) {
    console.log("  · İşlenecek kayıt yok.\n")
    return
  }

  // Firma başına hedef hesap. Raporda AÇILMAZ, yalnız hangisinin kullanılacağı söylenir.
  const targets = new Map<string, { id: string | null; name: string; created: boolean }>()
  for (const companyId of new Set(payments.map((p) => p.companyId))) {
    const existing = await prisma.financialAccount.findFirst({
      where: { companyId, isActive: true, type: DEFAULT_CASH_ACCOUNT.type },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    })
    targets.set(companyId, existing ? { ...existing, created: false } : { id: null, name: DEFAULT_CASH_ACCOUNT.name, created: true })
  }

  let lastCompany = ""
  let net = 0
  for (const p of payments) {
    if (p.companyId !== lastCompany) {
      const t = targets.get(p.companyId)!
      console.log(`  ${p.company.name}  (${p.companyId})`)
      console.log(`    → hesap: «${t.name}»${t.created ? " — YOK, açılacak" : ` (${t.id})`}`)
      lastCompany = p.companyId
    }
    const incoming = p.invoice.type === "SALES" || isPurchaseReturn(p.invoice)
    const party = p.invoice.customer?.name || p.invoice.supplier?.name || "-"
    const skip = skipIds.has(p.id)
    if (!skip) net += incoming ? Number(p.amount) : -Number(p.amount)
    console.log(
      `    ${skip ? "ATLA " : ""}${day(p.paymentDate)}  ${p.invoice.invoiceNo}  ${incoming ? "+" : "−"}${money(p.amount)} ${p.invoice.currency || "TRY"}` +
        `  ${p.paymentMethod}  ${party}  [${p.id}]`,
    )
  }
  const todo = payments.filter((p) => !skipIds.has(p.id))
  console.log(`\n  İşlenecek: ${todo.length} · kasalara net etki ${net >= 0 ? "+" : "−"}${money(Math.abs(net))}`)

  if (!APPLY) {
    console.log("\nKuru çalışma — hiçbir şey yazılmadı.")
    console.log("Uygulamak için: npx tsx scripts/kasasiz-odeme-backfill.ts --uygula [--atla=<ödemeId>]\n")
    return
  }

  let written = 0
  for (const p of todo) {
    const account = await ensureDefaultCashAccount(prisma, p.companyId)
    const incoming = p.invoice.type === "SALES" || isPurchaseReturn(p.invoice)
    await prisma.$transaction(async (db) => {
      // Aynı ödeme bu arada başka bir yoldan bağlandıysa (ikinci çalıştırma,
      // ekrandan düzeltme) dokunma: bakiye ikinci kez değişirdi.
      const fresh = await db.invoicePayment.findUnique({
        where: { id: p.id },
        select: { transactionId: true, accountId: true },
      })
      if (!fresh || fresh.transactionId || fresh.accountId) return

      const trx = await db.transaction.create({
        data: {
          companyId: p.companyId,
          accountId: account.id,
          type: incoming ? "INCOME" : "EXPENSE",
          amount: p.amount,
          currency: p.invoice.currency || "TRY",
          description: `${incoming ? "Tahsilat" : "Ödeme"} — ${p.invoice.invoiceNo}`,
          date: p.paymentDate,
          customerId: p.invoice.customerId,
          supplierId: p.invoice.supplierId,
          reference: p.reference,
          createdBy: p.createdBy,
        },
      })
      await db.financialAccount.update({
        where: { id: account.id },
        data: { balance: incoming ? { increment: p.amount } : { decrement: p.amount } },
      })
      await db.invoicePayment.update({
        where: { id: p.id },
        data: { accountId: account.id, transactionId: trx.id },
      })
      written += 1
    })
    if (account.created) console.log(`  · ${p.company.name}: «${account.name}» hesabı açıldı`)
  }

  console.log(`\n${written} ödeme Kasa'ya işlendi (hareket + bakiye).\n`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
