// Abonelik e2e testi için izole veritabanını tohumlar. YALNIZ test konteynerinde koşar.
//
// "Koşar" burada temenni değil, KAPIDIR: betik hedefi kendisi denetler ve tek satır
// yazmadan önce iki koşulu birden arar (bkz. assertDisposableDatabase). Başlıktaki
// uyarıya güvenmek yetmiyordu — `.env` çoğu geliştirme kopyasında CANLI veritabanını
// gösterir ve yanlışlıkla çalıştırılan betik üretime beş sahte firma, iki kullanıcı ve
// bir fiyat kataloğu yazardı.
const { PrismaClient } = require("@prisma/client")
const bcrypt = require("bcryptjs")

const prisma = new PrismaClient()

/**
 * Yerel sayılan sunucular: Supabase'in yerel yığını (127.0.0.1:54322), doğrudan
 * postgres ve docker-compose servis adları.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "db", "postgres", "postgres_test"])

/** Bağlantı dizesinden YALNIZ host — parola loglara sızmasın. */
function targetHost() {
  const raw = process.env.DATABASE_URL || ""
  if (!raw) return null
  try {
    return new URL(raw).hostname
  } catch {
    return null
  }
}

function die(baslik, satirlar) {
  console.error(`\n  ${baslik}\n`)
  for (const l of satirlar) console.error(`  ${l}`)
  console.error("")
  process.exit(1)
}

/**
 * Hedefin GÖZDEN ÇIKARILABİLİR olduğunu doğrular. İki katman da geçilmeden hiçbir
 * şey yazılmaz:
 *
 *  1. HOST yerel olmalı. Uzak bir tek-kullanımlık test veritabanı meşrudur (CI), ama
 *     o zaman host AÇIKÇA adlandırılmalı: `SEED_ALLOW_REMOTE=<host>`. Sadece "=1"
 *     kabul edilseydi, kabuk profilinde unutulmuş bir değişken canlıyı da açardı.
 *  2. VERİTABANI BOŞ olmalı. Betik planları, kullanıcıları ve firmaları sıfırdan
 *     yaratır; dolu bir şemada zaten çalışmaz (benzersiz kısıtlar) ama o noktaya
 *     gelene kadar yarım veri bırakır. Üstelik bu katman, birinin canlının YEREL
 *     kopyasını tohumlamasını da engeller — 1. katman ona izin verirdi.
 */
async function assertDisposableDatabase() {
  const host = targetHost()
  if (!host) {
    die("DATABASE_URL okunamadı.", ["Tohumlama hedefi belirsizken çalışmaz."])
  }

  const izin = (process.env.SEED_ALLOW_REMOTE || "").trim()
  if (!LOCAL_HOSTS.has(host) && izin !== host) {
    die(`GÜVENLİK: '${host}' yerel bir sunucu değil — tohumlama iptal edildi.`, [
      "Bu betik izole bir test veritabanı bekler; canlıya sahte firma yazmasın diye durdu.",
      "",
      "Yerel yığını kullanın:  npm run supabase:start   (127.0.0.1:54322)",
      "Uzak bir TEK KULLANIMLIK test veritabanıysa host'u açıkça adlandırın:",
      `  SEED_ALLOW_REMOTE=${host} node scripts/seed-abonelik-test.js`,
    ])
  }

  const [firma, kullanici, plan] = await Promise.all([
    prisma.company.count(),
    prisma.user.count(),
    prisma.plan.count(),
  ])
  if (firma > 0 || kullanici > 0 || plan > 0) {
    die(`GÜVENLİK: '${host}' boş değil — tohumlama iptal edildi.`, [
      `Bulunan: ${firma} firma, ${kullanici} kullanıcı, ${plan} plan.`,
      "Bu betik sıfırdan kurar; dolu bir şemaya yazmak mevcut veriyle karışır.",
      "",
      "Temiz bir veritabanıyla koşun:  npm run supabase:reset",
    ])
  }

  console.log(`  hedef: ${host} (boş) — tohumlanıyor…\n`)
}
const DAY = 86_400_000
const now = new Date()
const at = (days) => new Date(now.getTime() + days * DAY)

const ALL = ["sales", "purchase", "stock", "finance", "reports", "hr", "restaurant"]
const FREE = ["finance"] // TEMEL modül — bağımlılığı yok, ücretsiz yapılabilir
const disabledFor = (open) => ALL.filter((k) => !open.includes(k) && !FREE.includes(k))

async function main() {
  // Tek satır yazmadan ÖNCE: hedef gerçekten gözden çıkarılabilir mi?
  await assertDisposableDatabase()

  const pass = await bcrypt.hash("Test1234!", 10)

  const superAdmin = await prisma.user.create({
    data: { email: "super@test.local", name: "Süper Admin", password: pass, isSuperAdmin: true },
  })
  const owner = await prisma.user.create({
    data: { email: "sahip@test.local", name: "Firma Sahibi", password: pass },
  })

  // --- Planlar --------------------------------------------------------------
  const plans = await Promise.all([
    prisma.plan.create({
      data: {
        code: "BASLANGIC", name: "Başlangıç", description: "Küçük işletmeler için",
        monthlyPrice: 750, yearlyPrice: 7500, includedModules: ["sales"],
        includedBranches: 0, includedCompanies: 0, sortOrder: 1,
      },
    }),
    prisma.plan.create({
      data: {
        code: "PROFESYONEL", name: "Profesyonel", description: "Stok + satış + alış",
        monthlyPrice: 1500, yearlyPrice: 15000, includedModules: ["sales", "stock", "purchase"],
        includedBranches: 1, includedCompanies: 0, highlighted: true, sortOrder: 2,
      },
    }),
    prisma.plan.create({
      data: {
        code: "KURUMSAL", name: "Kurumsal", description: "Her şey dahil",
        monthlyPrice: 3000, yearlyPrice: 30000, includedModules: ALL,
        includedBranches: 3, includedCompanies: 1, sortOrder: 3,
      },
    }),
  ])
  const pro = plans[1]

  // --- Fiyat kalemleri ------------------------------------------------------
  const items = [
    ...ALL.map((k, i) => ({
      key: `module:${k}`, label: k, monthlyPrice: 300, yearlyPrice: 3000,
      sortOrder: i, isFree: FREE.includes(k),
    })),
    { key: "branch", label: "Ek Şube", monthlyPrice: 250, yearlyPrice: 2500, sortOrder: 90, isFree: false },
    { key: "company", label: "Ek Firma", monthlyPrice: 500, yearlyPrice: 5000, sortOrder: 91, isFree: false },
  ]
  for (const it of items) await prisma.pricingItem.create({ data: it })

  // --- Firma yardımcıları ---------------------------------------------------
  let vkn = 1000000001
  const mkCompany = async (over) =>
    prisma.company.create({
      data: {
        name: over.name, slug: over.slug,
        taxNumber: String(vkn++), taxOffice: "Test VD",
        address: "Test Mah. Test Cad. No:1", city: "İstanbul", email: "test@test.local",
        disabledModules: over.disabledModules ?? disabledFor([]),
        parentCompanyId: over.parentCompanyId ?? null,
        accountRootId: over.accountRootId ?? null,
        archivedAt: over.archivedAt ?? null,
      },
    })

  const link = (companyId, userId = owner.id, role = "ADMIN") =>
    prisma.userCompany.create({ data: { companyId, userId, role } })

  // === A) AKTİF — sağlıklı ücretli hesap ===================================
  const A = await mkCompany({
    name: "AKTİF TİCARET A.Ş.", slug: "aktif-as",
    disabledModules: disabledFor(["sales", "stock"]),
  })
  await link(A.id)
  const aBranch = await mkCompany({
    name: "AKTİF TİCARET A.Ş.", slug: "aktif-sube",
    parentCompanyId: A.id, accountRootId: A.id,
    disabledModules: disabledFor(["sales", "stock"]),
  })
  await prisma.company.update({ where: { id: aBranch.id }, data: { branchName: "Kadıköy Şubesi" } })
  await link(aBranch.id)

  const subA = await prisma.subscription.create({
    data: {
      userId: owner.id, companyId: A.id, planId: pro.id,
      provider: "PAYTR", providerSubscriptionId: "tok_test_visa",
      cardBrand: "Visa", cardLast4: "4242",
      status: "ACTIVE", billingCycle: "MONTHLY",
      purchasedModules: ["sales", "stock"],
      branchQuota: 2, companyQuota: 1, amount: 1500,
      autoRenew: true, cancelAtPeriodEnd: false,
      periodStart: at(-10), periodEnd: at(20),
    },
  })

  // Ödeme geçmişi: ödenmiş+faturalı, ödenmiş+faturasız, başarısız
  const inv = await prisma.invoice.create({
    data: {
      companyId: A.id, invoiceNo: "KOB2026000000123", eDocumentNo: "KOB2026000000123",
      uuid: "11111111-1111-1111-1111-111111111111", status: "SENT",
      type: "SALES", invoiceType: "E_ARCHIVE", date: at(-10),
      totalAmount: 1500, vatAmount: 250, netAmount: 1250,
    },
  })
  await prisma.packageOrder.create({
    data: {
      companyId: A.id, planId: pro.id, planName: "Profesyonel",
      resolvedModules: ["sales", "stock"], branchQuota: 2, companyQuota: 1,
      billingCycle: "MONTHLY", amount: 1500, status: "ACTIVE",
      paymentProvider: "PAYTR", paidAt: at(-10), invoiceId: inv.id, invoicedAt: at(-10),
      createdAt: at(-10),
    },
  })
  await prisma.packageOrder.create({
    data: {
      companyId: A.id, planName: "Profesyonel", resolvedModules: ["sales", "stock"],
      billingCycle: "MONTHLY", amount: 1500, discountCode: "HOSGELDIN", discountAmount: 150,
      status: "ACTIVE", paymentProvider: "PAYTR", paidAt: at(-40), createdAt: at(-40),
    },
  })
  await prisma.packageOrder.create({
    data: {
      companyId: A.id, planName: "Profesyonel", resolvedModules: ["sales"],
      billingCycle: "MONTHLY", amount: 1500, status: "FAILED",
      paymentProvider: "PAYTR", paymentError: "Yetersiz bakiye", createdAt: at(-41),
    },
  })
  await prisma.subscriptionEvent.createMany({
    data: [
      { companyId: A.id, subscriptionId: subA.id, type: "PERIOD_STARTED", actor: "PAYTR",
        summary: "Ödeme alındı, aylık dönem başladı", createdAt: at(-10) },
      { companyId: A.id, subscriptionId: subA.id, type: "MODULES_CHANGED", actor: "PAYTR",
        summary: "Açık modüller: Satış, Stok", createdAt: at(-10) },
    ],
  })

  // === B) HOŞGÖRÜ — ödeme alınamadı, erişim sürüyor ========================
  const B = await mkCompany({
    name: "HOŞGÖRÜ LTD. ŞTİ.", slug: "hosgoru-ltd",
    disabledModules: disabledFor(["sales"]),
  })
  await link(B.id)
  await prisma.subscription.create({
    data: {
      userId: owner.id, companyId: B.id, provider: "PAYTR",
      status: "PAST_DUE", billingCycle: "MONTHLY",
      purchasedModules: ["sales"], branchQuota: 1, companyQuota: 0, amount: 750,
      autoRenew: true, periodStart: at(-33), periodEnd: at(-3),
    },
  })

  // === C) SÜRESİ DOLMUŞ — kilitli, arşiv sayacı işliyor ====================
  const C = await mkCompany({
    name: "SÜRESİ DOLMUŞ A.Ş.", slug: "dolmus-as",
    disabledModules: disabledFor([]),
  })
  await link(C.id)
  const cBranch = await mkCompany({
    name: "SÜRESİ DOLMUŞ A.Ş.", slug: "dolmus-sube",
    parentCompanyId: C.id, accountRootId: C.id, disabledModules: disabledFor([]),
  })
  await link(cBranch.id)
  await prisma.subscription.create({
    data: {
      userId: owner.id, companyId: C.id, provider: "PAYTR",
      status: "EXPIRED", billingCycle: "MONTHLY",
      purchasedModules: ["sales", "stock"], branchQuota: 3, companyQuota: 0, amount: 1500,
      autoRenew: false, periodStart: at(-42), periodEnd: at(-12), lockedAt: at(-5),
    },
  })

  // === D) ARŞİV ADAYI — kilit 40 gün önce, runArchive damgalamalı ==========
  const D = await mkCompany({
    name: "ARŞİV ADAYI A.Ş.", slug: "arsiv-as",
    disabledModules: disabledFor([]),
  })
  await link(D.id)
  await prisma.subscription.create({
    data: {
      userId: owner.id, companyId: D.id, provider: "PAYTR",
      status: "EXPIRED", billingCycle: "MONTHLY",
      purchasedModules: ["sales", "stock"], branchQuota: 0, companyQuota: 0, amount: 1500,
      autoRenew: false, periodStart: at(-90), periodEnd: at(-60), lockedAt: at(-40),
    },
  })
  // Dışa aktarılacak veri: arşivde export açık kalmalı
  await prisma.customer.create({
    data: { companyId: D.id, name: "ARŞİV MÜŞTERİSİ LTD.", taxNumber: "9999999999", city: "Ankara" },
  })

  // === E) DENEME ===========================================================
  const E = await mkCompany({
    name: "DENEME LTD.", slug: "deneme-ltd",
    disabledModules: disabledFor([]),
  })
  await link(E.id)
  await prisma.subscription.create({
    data: {
      userId: owner.id, companyId: E.id, provider: "NONE",
      status: "TRIAL", purchasedModules: [], branchQuota: 1, companyQuota: 0,
      trialEndsAt: at(300), periodStart: at(-65), periodEnd: at(300),
    },
  })

  console.log("TOHUMLAMA TAMAM")
  console.log("  süper admin : super@test.local / Test1234!")
  console.log("  firma sahibi: sahip@test.local / Test1234!")
  for (const [slug, note] of [
    ["aktif-as", "ACTIVE, kart saklı, 20 gün kaldı, 1 şube"],
    ["hosgoru-ltd", "PAST_DUE — hoşgörü (3 gün geçmiş)"],
    ["dolmus-as", "EXPIRED, 5 gün önce kilitlendi, 1 şube"],
    ["arsiv-as", "EXPIRED, 40 gün önce kilitlendi → arşiv adayı"],
    ["deneme-ltd", "TRIAL"],
  ]) console.log(`  ${slug.padEnd(14)} ${note}`)
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
