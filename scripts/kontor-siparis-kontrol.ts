/**
 * KONTÖR SİPARİŞİ NEDEN YÜKLENMEDİ? — salt okur teşhis.
 *
 *   npx tsx scripts/kontor-siparis-kontrol.ts --vkn=<mükellef vkn> [--gun=30]
 *
 * NE ÖLÇER (hiçbir şey yazmaz, GİB'e belge gitmez, kontör yüklenmez):
 *   1. DB: bu VKN'ye ait firma kayıtları (kopya var mı, kendi Mysoft kimliği var mı).
 *   2. DB: son N günün kontör siparişleri — durum, ödeme (isTest / paidAt / paymentRef),
 *      hedef VKN, yükleme hatası.
 *   3. Mysoft bayi API (GET /api/Tenant/getTenant): Kobipo bayiliği (MYSOFT_PARTNER_*)
 *      altında tanımlı mükellefler. insertDocumentCredit YALNIZ bu listedeki VKN'lere
 *      yükler; listede olmayan mükellef için Mysoft "firması sizin hesabınızda tanımlı
 *      olan firmalar arasında yer almamaktadır" der (2026-09-21, Eren Forklift).
 *
 * ÖN KOŞUL: .env.local canlı DB'ye ve bayi kimliğine sahip olmalı
 * (`vercel env pull .env.local --environment=production`).
 */
import "dotenv/config"
import { config as loadEnv } from "dotenv"
loadEnv({ path: ".env.local", override: true })

const args = process.argv.slice(2)
const VKN = ((args.find((a) => a.startsWith("--vkn=")) || "").split("=")[1] || "").replace(/\D/g, "")
const GUN = Number((args.find((a) => a.startsWith("--gun=")) || "").split("=")[1] || 30)

if (!VKN) {
  console.error("Kullanım: npx tsx scripts/kontor-siparis-kontrol.ts --vkn=<vkn> [--gun=30]")
  process.exit(1)
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString().replace("T", " ").slice(0, 19) + " UTC" : "—")

async function main() {
  const { prisma } = await import("@/lib/db/prisma")

  // 1) Firma kayıtları
  const companies = await prisma.company.findMany({
    where: { OR: [{ taxNumber: VKN }, { eDonusumTenantVkn: VKN }] },
    select: {
      id: true, name: true, slug: true, taxNumber: true, eDonusumTenantVkn: true,
      isEDonusumEnabled: true, eDonusumApiUsername: true, eDonusumApiUrl: true,
      eDonusumOnboardingStatus: true, parentCompanyId: true, accountRootId: true, createdAt: true,
      _count: { select: { users: true, invoices: true } },
    },
    orderBy: { createdAt: "asc" },
  })
  console.log(`\n== VKN ${VKN} — firma kayıtları (${companies.length}) ==`)
  for (const c of companies) {
    console.log(
      `  ${c.id}  ${c.name}\n` +
      `     slug=${c.slug ?? "—"}  üye=${c._count.users}  fatura=${c._count.invoices}  açılış=${iso(c.createdAt)}\n` +
      `     eDönüşüm=${c.isEDonusumEnabled}  kendi Mysoft kimliği=${c.eDonusumApiUsername ? c.eDonusumApiUsername + " @ " + (c.eDonusumApiUrl || "varsayılan") : "YOK"}  onboarding=${c.eDonusumOnboardingStatus ?? "—"}  tenantVkn=${c.eDonusumTenantVkn ?? "—"}\n` +
      `     parent=${c.parentCompanyId ?? "—"}  accountRoot=${c.accountRootId ?? "—"}`,
    )
  }

  // 2) Siparişler
  const since = new Date(Date.now() - GUN * 86400_000)
  const orders = await prisma.kontorOrder.findMany({
    where: { OR: [{ targetVkn: VKN }, { companyId: { in: companies.map((c) => c.id) } }], createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    include: { company: { select: { name: true } } },
  })
  console.log(`\n== Son ${GUN} gün kontör siparişleri (${orders.length}) ==`)
  for (const o of orders) {
    console.log(
      `  ${o.id}  [${o.status}]  ${o.creditQty} kontör  ${o.totalPrice} ${o.currency}  ${o.paymentMethod}${o.paymentProvider ? "/" + o.paymentProvider : ""}${o.isTest ? "  (TEST)" : "  (GERÇEK)"}\n` +
      `     firma=${o.companyId} (${o.company.name})  hedefVKN=${o.targetVkn}  tarife=${o.mysoftTariffCode}\n` +
      `     açılış=${iso(o.createdAt)}  ödeme=${iso(o.paidAt)}  ref=${o.paymentRef ?? "—"}  onay=${iso(o.confirmedAt)}\n` +
      `     mysoftCreditId=${o.mysoftCreditId ?? "—"}  fatura=${o.invoiceId ?? "—"}\n` +
      (o.paymentError ? `     ödeme hatası: ${o.paymentError}\n` : "") +
      (o.loadError ? `     yükleme hatası: ${o.loadError}\n` : ""),
    )
  }

  // 2b) Tüm zamanlar: hangi VKN'lere gerçekten yüklendi? ("Şimdiye kadar neden sorun
  //     çıkmadı" sorusunun cevabı — yalnız bayi altındaki VKN'ler görünmeli.)
  const loaded = await prisma.kontorOrder.groupBy({
    by: ["targetVkn"],
    where: { status: "LOADED" },
    _count: { _all: true },
    _sum: { creditQty: true },
    _max: { confirmedAt: true },
  })
  console.log(`
== Tüm zamanlar LOADED siparişler (VKN bazında, ${loaded.length} VKN) ==`)
  for (const l of loaded) {
    console.log(`  ${l.targetVkn === VKN ? "▶" : " "} ${l.targetVkn}  ${l._count._all} sipariş  ${l._sum.creditQty ?? 0} kontör  son=${iso(l._max.confirmedAt)}`)
  }
  if (loaded.length === 0) console.log("  (hiç yükleme yok)")

  // 3) Bayi altındaki mükellefler
  const { createPartnerProvider, getPartnerCredentials } = await import("@/lib/integrations/e-invoice/partner")
  const creds = getPartnerCredentials()
  const provider = createPartnerProvider()
  if (!provider || !creds) {
    console.log("\n== Bayi kimliği yok (MYSOFT_PARTNER_*) — Mysoft listesi atlandı ==")
  } else {
    console.log(`\n== Mysoft bayi (${creds.username} @ ${creds.baseUrl}) altındaki mükellefler ==`)
    const res = await provider.listTenants()
    if (!res.success) {
      console.log("  HATA:", res.error)
    } else {
      const list = res.data ?? []
      for (const t of list) {
        const isim = t.tenantName || t.shortName
        const bu = String(t.vknTckn).trim() === VKN
        console.log(`  ${bu ? "▶" : " "} ${t.vknTckn}  ${isim}${t.isPassive ? "  (pasif)" : ""}`)
      }
      const varMi = list.some((t) => String(t.vknTckn).trim() === VKN && !t.isPassive)
      console.log(
        varMi
          ? `\n  SONUÇ: ${VKN} bayi altında TANIMLI → insertDocumentCredit çalışmalı; hata başka yerde.`
          : `\n  SONUÇ: ${VKN} bayi altında TANIMLI DEĞİL → insertDocumentCredit bu VKN'ye yükleyemez.\n` +
            `  Mükellef Mysoft'ta Kobipo (REYPO) bayiliğine bağlanmadan kontör API'den yüklenemez.`,
      )
    }

    // 4) Sipariş ucundaki KAPI aynen: POST /api/kontor/orders bu fonksiyonla açar/kapatır.
    const { checkKontorEligibility } = await import("@/lib/kontor/dealer-eligibility")
    const kapi = await checkKontorEligibility(VKN)
    console.log(`
== Sipariş kapısı (checkKontorEligibility) ==`)
    console.log(
      kapi.ok
        ? `  AÇIK → sipariş açılır (mükellef: ${kapi.tenantName ?? "?"})`
        : `  KAPALI [${kapi.code} → HTTP ${kapi.status}]
  mesaj: ${kapi.message}`,
    )
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error("HATA:", e?.message || e)
  process.exit(1)
})
