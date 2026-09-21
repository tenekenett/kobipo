/**
 * KONTÖR SİPARİŞİ REDDET — sistem-admin "Reddet" düğmesinin komut satırı karşılığı.
 *
 *   npx tsx scripts/kontor-siparis-reddet.ts --id=<sipariş> [--id=<sipariş> …]           → yalnız GÖSTERİR
 *   npx tsx scripts/kontor-siparis-reddet.ts --id=<sipariş> [--id=<sipariş> …] --onayla  → REJECTED yazar
 *
 * Koruma: LOADED sipariş reddedilmez (kontör zaten yüklü); faturası kesilmiş sipariş de
 * buradan reddedilmez (belge geri alınmalı → panelden "Reddet", voidSalesInvoiceForOrder
 * oradan çalışır). Para İADE ETMEZ: ödenmiş kart siparişinde iade PayTR panelinden yapılır.
 *
 * NEDEN VAR (2026-09-21): Eren Forklift bayi altında olmadığı için FAILED'a düşen
 * siparişler ([[lib/kontor/dealer-eligibility.ts]]); 0 TL'lik %100 indirimli üç sipariş
 * yanlışlıkla onaylanırsa 3.000 kontör bedelsiz giderdi.
 */
import "dotenv/config"
import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local", override: true })

const args = process.argv.slice(2)
const IDS = args.filter((a) => a.startsWith("--id=")).map((a) => a.slice(5).trim()).filter(Boolean)
const ONAYLA = args.includes("--onayla")
const NOT = (args.find((a) => a.startsWith("--not=")) || "").slice(6) || "Komut satırından reddedildi (kontor-siparis-reddet.ts)"

if (IDS.length === 0) {
  console.error("Kullanım: npx tsx scripts/kontor-siparis-reddet.ts --id=<sipariş> [--id=…] [--onayla] [--not=…]")
  process.exit(1)
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString().replace("T", " ").slice(0, 19) + " UTC" : "—")

async function main() {
  const { prisma } = await import("@/lib/db/prisma")
  const orders = await prisma.kontorOrder.findMany({
    where: { id: { in: IDS } },
    include: { company: { select: { name: true } } },
  })
  const eksik = IDS.filter((id) => !orders.some((o) => o.id === id))
  if (eksik.length) console.log("Bulunamayan sipariş:", eksik.join(", "))

  const hedef: typeof orders = []
  for (const o of orders) {
    const satir =
      `${o.id}  [${o.status}]  ${o.creditQty} kontör  ${o.totalPrice} ${o.currency}  ${o.paymentMethod}` +
      `${o.paymentProvider ? "/" + o.paymentProvider : ""}${o.isTest ? " (TEST)" : " (GERÇEK)"}\n` +
      `     firma=${o.company.name}  hedefVKN=${o.targetVkn}  ödeme=${iso(o.paidAt)}  fatura=${o.invoiceId ?? "—"}`
    if (o.status === "LOADED") { console.log("ATLANDI (kontör yüklü, reddedilemez):\n  " + satir); continue }
    if (o.status === "REJECTED") { console.log("ATLANDI (zaten reddedilmiş):\n  " + satir); continue }
    if (o.invoiceId) { console.log("ATLANDI (faturası kesilmiş — panelden reddedin, belge geri alınsın):\n  " + satir); continue }
    console.log((ONAYLA ? "REDDEDİLECEK" : "REDDEDİLİR (--onayla ile)") + ":\n  " + satir)
    if (Number(o.totalPrice) > 0 && o.paidAt) {
      console.log("     ⚠ ödenmiş sipariş: bu komut PARA İADE ETMEZ, iade PayTR panelinden.")
    }
    hedef.push(o)
  }

  if (!ONAYLA || hedef.length === 0) {
    console.log(ONAYLA ? "\nYazılacak sipariş yok." : "\nKuru çalışma — yazmak için --onayla ekleyin.")
    await prisma.$disconnect()
    return
  }

  const now = new Date()
  for (const o of hedef) {
    await prisma.$transaction([
      prisma.kontorOrder.update({
        where: { id: o.id, status: o.status },
        data: { status: "REJECTED", confirmedAt: now, loadError: o.loadError ? `${o.loadError} | ${NOT}` : NOT },
      }),
      prisma.systemLog.create({
        data: {
          userId: null,
          action: "KONTOR_REJECT",
          entity: "KontorOrder",
          details: `Sipariş ${o.id}: ${o.creditQty} kontör, ${o.totalPrice} ${o.currency}, VKN ${o.targetVkn} → REJECTED (${o.status} idi). ${NOT}`,
          level: "INFO",
        },
      }),
    ])
    console.log(`✓ ${o.id} → REJECTED`)
  }
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error("HATA:", e?.message || e)
  process.exit(1)
})
