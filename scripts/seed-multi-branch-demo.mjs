// Çok firmalı / çok şubeli demo hesabı kurar — şube bağlamı (context) testleri için.
//
// Kurulan yapı (sahibi: OWNER_EMAIL, hepsinde ADMIN):
//   Kobipo Demo Merkez            (ana firma)
//     ├── Kobipo Demo Kadıköy Şubesi
//     └── Kobipo Demo İzmir Şubesi
//   Kobipo Demo İkinci A.Ş.       (ikinci ana firma — firmalar arası sızıntı testi)
//     └── Kobipo Demo Ankara Şubesi
//
// Her firmanın verisi ÖN EKLİDİR (MERKEZ / KADIKOY / IZMIR / IKINCI / ANKARA):
// böylece bir ekran yanlış firmanın verisini gösterdiğinde bu ilk bakışta görülür —
// "seçili şubenin dışına çıkma" hatasının gözle doğrulanması bunun üzerine kuruludur.
//
// Idempotent: aynı slug'lı firma varsa yeniden kullanılır, veri adına göre upsert edilir.
// Geri almak için: node scripts/seed-multi-branch-demo.mjs --temizle

import { PrismaClient } from "@prisma/client"

const p = new PrismaClient()

/** lib/slug.ts `slugify` ile aynı kural (script Node'dan çalıştığı için kopyalandı). */
const slugify = (input) =>
  (input || "")
    .toLowerCase()
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ı/g, "i")
    .replace(/İ/g, "i")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)

const OWNER_EMAIL = "tenekenett@gmail.com"
const TEMIZLE = process.argv.includes("--temizle")
// Aynı demo ağacına ADMIN olarak eklenecek EK hesaplar (test için ikinci bir
// oturum gerektiğinde): --ek-uye ornek@mail.com [--ek-uye ...]
const EK_UYELER = process.argv.reduce((acc, arg, i) => {
  if (arg === "--ek-uye" && process.argv[i + 1]) acc.push(process.argv[i + 1])
  return acc
}, [])

/** Kurulacak firma ağacı. parent === null → ana firma. */
const TREE = [
  { key: "MERKEZ", name: "Kobipo Demo Merkez", slug: "kobipo-demo-merkez", parent: null, city: "İstanbul", taxNumber: "1112223334" },
  { key: "KADIKOY", name: "Kobipo Demo Kadıköy Şubesi", slug: "kobipo-demo-kadikoy", parent: "MERKEZ", city: "İstanbul", taxNumber: "1112223334" },
  { key: "IZMIR", name: "Kobipo Demo İzmir Şubesi", slug: "kobipo-demo-izmir", parent: "MERKEZ", city: "İzmir", taxNumber: "1112223334" },
  { key: "IKINCI", name: "Kobipo Demo İkinci A.Ş.", slug: "kobipo-demo-ikinci", parent: null, city: "Bursa", taxNumber: "5556667778" },
  { key: "ANKARA", name: "Kobipo Demo Ankara Şubesi", slug: "kobipo-demo-ankara", parent: "IKINCI", city: "Ankara", taxNumber: "5556667778" },
]

const ALL_SLUGS = TREE.map((t) => t.slug)

async function temizle() {
  const companies = await p.company.findMany({
    where: { slug: { in: ALL_SLUGS } },
    select: { id: true, name: true },
  })
  if (companies.length === 0) {
    console.log("Silinecek demo firma yok.")
    return
  }
  // Company silinince tüm bağlı kayıtlar (onDelete: Cascade) birlikte gider.
  // Şubeler de parentCompanyId cascade'i ile düşer; yine de hepsi listede.
  for (const c of companies) {
    await p.company.delete({ where: { id: c.id } }).catch(() => {})
    console.log(`  silindi: ${c.name}`)
  }
}

async function main() {
  const owner = await p.user.findUniqueOrThrow({
    where: { email: OWNER_EMAIL },
    select: { id: true, email: true, name: true },
  })
  console.log(`Sahip: ${owner.email} (${owner.id})`)

  if (TEMIZLE) {
    await temizle()
    return
  }

  const ekUyeIds = []
  for (const mail of EK_UYELER) {
    const u = await p.user.findUnique({ where: { email: mail }, select: { id: true, email: true } })
    if (!u) {
      console.warn(`  UYARI: ek üye bulunamadı, atlandı — ${mail}`)
      continue
    }
    ekUyeIds.push(u.id)
    console.log(`Ek üye: ${u.email}`)
  }

  const idByKey = {}

  // 1) Firmalar + şubeler + ADMIN üyelikleri
  for (const def of TREE) {
    const existing = await p.company.findUnique({ where: { slug: def.slug }, select: { id: true } })
    const data = {
      name: def.name,
      slug: def.slug,
      taxNumber: def.taxNumber,
      taxOffice: "Demo V.D.",
      address: `${def.name} demo adresi`,
      city: def.city,
      phone: "02120000000",
      email: `${def.slug}@demo.kobipo`,
      isActive: true,
      disabledModules: [], // tüm modüller açık
      parentCompanyId: def.parent ? idByKey[def.parent] : null,
    }
    const company = existing
      ? await p.company.update({ where: { id: existing.id }, data })
      : await p.company.create({ data })
    idByKey[def.key] = company.id

    // Üyelik YALNIZ ana firmalara verilir. Şubeye doğrudan üyelik verilirse
    // getManagedBranches onu "yönetilen şube" saymaz (üye olunanları eler) ve şube,
    // üst firma seçicisinde normal firma gibi görünür — test etmek istediğimiz
    // parent-admin şube bağlamı hiç kurulmaz.
    const uyeler = def.parent ? [] : [owner.id, ...ekUyeIds]
    for (const uid of uyeler) {
      await p.userCompany.upsert({
        where: { userId_companyId: { userId: uid, companyId: company.id } },
        update: { role: "ADMIN" },
        create: { userId: uid, companyId: company.id, role: "ADMIN" },
      })
    }
    // Önceki çalıştırmadan kalmış olabilecek şube üyeliklerini temizle (yukarıdaki kural).
    if (def.parent) {
      await p.userCompany.deleteMany({
        where: { companyId: company.id, userId: { in: [owner.id, ...ekUyeIds] } },
      })
    }
    console.log(`${existing ? "güncellendi" : "oluşturuldu"}: ${def.name}${def.parent ? ` (şube → ${def.parent})` : ""}`)
  }

  // 2) Abonelik HESAP düzeyindedir → yalnız ana firmalara TRIAL aç (şubeler miras alır).
  const trialEndsAt = new Date()
  trialEndsAt.setFullYear(trialEndsAt.getFullYear() + 1)
  for (const key of ["MERKEZ", "IKINCI"]) {
    const companyId = idByKey[key]
    const sub = await p.subscription.findFirst({ where: { companyId } })
    const subData = {
      userId: owner.id,
      companyId,
      status: "TRIAL",
      trialEndsAt,
      periodStart: new Date(),
      periodEnd: trialEndsAt,
      branchQuota: 5,
    }
    if (sub) await p.subscription.update({ where: { id: sub.id }, data: subData })
    else await p.subscription.create({ data: subData })
    console.log(`  abonelik (TRIAL, ${trialEndsAt.toLocaleDateString("tr-TR")}): ${key}`)
  }

  // 3) Her firmaya ön ekli demo veri
  for (const def of TREE) {
    const companyId = idByKey[def.key]
    const P = def.key
    await seedCompanyData(companyId, P)
    console.log(`  veri: ${P} — depo, kasa/banka, 2 müşteri, 2 tedarikçi, 3 ürün, 3 fatura`)
  }

  console.log("\nHazır. Panelde:")
  console.log("  • Üst 'Aktif Firma' seçicisinde: Kobipo Demo Merkez / Kobipo Demo İkinci A.Ş. (+ DENEME)")
  console.log("  • Şubelere giriş: Ayarlar → Şubeler → ilgili şubenin 'Şubeye gir' aksiyonu")
}

/** Bir firmaya ön ekli (prefix) demo verisi yazar; ada göre idempotenttir. */
async function seedCompanyData(companyId, P) {
  // Depo
  const depoAdi = `${P} Ana Depo`
  let depo = await p.warehouse.findFirst({ where: { companyId, name: depoAdi } })
  if (!depo) {
    depo = await p.warehouse.create({
      data: { companyId, name: depoAdi, code: `${P}-D1`, isDefault: true, city: "Demo" },
    })
  }

  // Kasa + banka hesabı
  for (const acc of [
    { name: `${P} Merkez Kasa`, type: "CASH", balance: 25000 },
    { name: `${P} Demo Bank TL`, type: "BANK", balance: 150000, bankName: "Demo Bank" },
  ]) {
    const slug = slugify(acc.name)
    await p.financialAccount.upsert({
      where: { companyId_slug: { companyId, slug } },
      update: { name: acc.name, type: acc.type, balance: acc.balance, bankName: acc.bankName ?? null },
      create: { companyId, slug, name: acc.name, type: acc.type, balance: acc.balance, bankName: acc.bankName ?? null },
    })
  }

  // Müşteriler
  const musteriIds = []
  for (const n of ["A", "B"]) {
    const name = `${P} Müşteri ${n}`
    const slug = slugify(name)
    const c = await p.customer.upsert({
      where: { companyId_slug: { companyId, slug } },
      update: { name },
      create: {
        companyId,
        slug,
        name,
        code: `${P}-M${n}`,
        taxNumber: String(1000000000 + Math.floor(Math.random() * 8999999999)).slice(0, 10),
        city: "Demo",
        email: `${slug}@demo.kobipo`,
        phone: "05550000000",
      },
    })
    musteriIds.push(c.id)
  }

  // Tedarikçiler
  for (const n of ["A", "B"]) {
    const name = `${P} Tedarikçi ${n}`
    const slug = slugify(name)
    await p.supplier.upsert({
      where: { companyId_slug: { companyId, slug } },
      update: { name },
      create: {
        companyId,
        slug,
        name,
        code: `${P}-T${n}`,
        taxNumber: String(2000000000 + Math.floor(Math.random() * 7999999999)).slice(0, 10),
        city: "Demo",
      },
    })
  }

  // Ürünler — stok adetleri firmaya özgü ki listede karışma anında fark edilsin.
  const urunIds = []
  const baseStock = { MERKEZ: 100, KADIKOY: 200, IZMIR: 300, IKINCI: 400, ANKARA: 500 }[P] ?? 10
  for (let i = 1; i <= 3; i++) {
    const name = `${P} Ürün ${i}`
    const slug = slugify(name)
    const u = await p.product.upsert({
      where: { companyId_slug: { companyId, slug } },
      update: { name, stockQuantity: baseStock + i },
      create: {
        companyId,
        slug,
        name,
        code: `${P}-U${i}`,
        unit: "ADET",
        vatRate: 20,
        purchasePrice: 100 * i,
        salePrice: 150 * i,
        stockQuantity: baseStock + i,
        minStockLevel: 5,
      },
    })
    urunIds.push(u.id)
    await p.warehouseStock.upsert({
      where: { warehouseId_productId: { warehouseId: depo.id, productId: u.id } },
      update: { quantity: baseStock + i },
      create: { warehouseId: depo.id, productId: u.id, quantity: baseStock + i },
    })
  }

  // Faturalar (2 satış + 1 alış). Kalem tutarları basit tutuldu: 1 adet × satış fiyatı.
  for (let i = 1; i <= 3; i++) {
    const invoiceNo = `${P}-2026-000${i}`
    const slug = slugify(invoiceNo)
    const isPurchase = i === 3
    const net = 150 * i * 10
    const vat = net * 0.2
    const existing = await p.invoice.findFirst({ where: { companyId, invoiceNo } })
    if (existing) continue
    await p.invoice.create({
      data: {
        companyId,
        invoiceNo,
        slug,
        type: isPurchase ? "PURCHASE" : "SALES",
        invoiceType: "E_ARCHIVE",
        status: "DRAFT",
        customerId: isPurchase ? null : musteriIds[i % musteriIds.length],
        date: new Date(),
        netAmount: net,
        vatAmount: vat,
        totalAmount: net + vat,
        notes: `${P} demo faturası`,
        items: {
          create: [
            {
              productId: urunIds[i - 1],
              description: `${P} Ürün ${i}`,
              unit: "ADET",
              quantity: 10,
              unitPrice: 150 * i,
              vatRate: 20,
              vatAmount: vat,
              totalAmount: net + vat,
              order: 0,
            },
          ],
        },
      },
    })
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => p.$disconnect())
