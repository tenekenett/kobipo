/**
 * UÇTAN UCA (HTTP): ücretsiz paket abonelik ekranından ALINARAK açılır (2026-09-25).
 *
 *   1) npm run dev                              (http://localhost:3000)
 *   2) npx tsx scripts/test-ucretsiz-paket.ts
 *
 * Gerçek uçlardan geçer — firma açma (`POST /api/companies`), katalog, abonelik özeti,
 * indirim kodu ön izlemesi ve sipariş (`POST /api/billing/orders`). Ödemeli yolun
 * damgası için PayTR callback'inin çağırdığı `activateSubscription` süreç içinde
 * çağrılır (PayTR'a gidilmez, fatura KESİLMEZ — o iş `issueInvoiceQuietly`nin).
 *
 * Senaryolar:
 *   A. Yeni hesap: tüm modüller kapalı doğar → ücretsiz paket (0 TL) → temel modüller açık.
 *   B. Yeni şube (kotayla): kilitli doğar; şube ADMIN'i (hesap yöneticisi değil) paketi
 *      ALAMAZ (403); hesap yöneticisi alır.
 *   C. Paketi almamış şube Restoran'ı ÖDEYEREK alır → paket de alınmış sayılır.
 *
 * CANLI veritabanında koşar ama yalnız kendi yarattığı `zz-up-` kayıtlarına dokunur ve
 * sonunda siler. Oturum `NEXTAUTH_SECRET` ile imzalanmış token'dır (test-hesap-bolme.mjs
 * ile aynı yöntem).
 */
import "dotenv/config"
import { config as loadEnv } from "dotenv"
import { encode } from "next-auth/jwt"
import { prisma } from "@/lib/db/prisma"
import { MODULE_KEYS } from "@/lib/modules"
import { getFreeModuleKeys } from "@/lib/billing/free-modules"
import { activateSubscription } from "@/lib/billing/paytr-payment"

loadEnv({ path: ".env.local", override: true })

const BASE = process.env.TEST_BASE_URL || "http://localhost:3000"
const STAMP = Date.now().toString().slice(-7)
const created = { users: [] as string[], companies: [] as string[] }

let pass = 0
let fail = 0
const sorted = (a: readonly string[]) => [...a].sort()
function check(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    pass++
    console.log(`  ✅ ${label}`)
  } else {
    fail++
    console.log(`  ❌ ${label}\n       beklenen: ${e}\n       gelen   : ${a}`)
  }
}

async function makeUser(tag: string) {
  const user = await prisma.user.create({
    data: { email: `zz-up-${STAMP}-${tag}@kobipo.test`, name: `ZZ UP ${tag}`, password: "x" },
    select: { id: true, email: true },
  })
  created.users.push(user.id)
  const token = await encode({
    token: {
      id: user.id,
      email: user.email,
      isSuperAdmin: false,
      isBlogEditor: false,
    },
    secret: (process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET)!,
  })
  const cookie = `next-auth.session-token=${token}`
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { cookie, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    const text = await res.text()
    let json: any
    try {
      json = JSON.parse(text)
    } catch {
      json = { raw: text.slice(0, 200) }
    }
    return { status: res.status, body: json }
  }
  return { ...user, api }
}

async function companyRow(id: string) {
  return prisma.company.findUniqueOrThrow({
    where: { id },
    select: { disabledModules: true, freeModulesClaimedAt: true, suppressedModules: true },
  })
}

const taxNo = () => `8${STAMP}${Math.floor(Math.random() * 90 + 10)}`

async function main() {
  const free = await getFreeModuleKeys()
  const paid = MODULE_KEYS.filter((k) => !free.includes(k))
  const freeOnlyDisabled = sorted(paid)
  console.log(`ücretsiz: [${free.join(", ")}]  ücretli: [${paid.join(", ")}]\n`)
  if (free.length === 0 || !paid.includes("restaurant")) {
    throw new Error("Senaryo en az bir ücretsiz modül ve ücretli Restoran varsayıyor")
  }

  // ------------------------------------------------------------------------------
  console.log("A) Yeni hesap — kayıt sonrası ilk firma")
  const owner = await makeUser("sahip")
  const rootRes = await owner.api("POST", "/api/companies", {
    name: `ZZ-UP ${STAMP} KÖK`,
    taxNumber: taxNo(),
    taxOffice: "Deneme VD",
    address: "Deneme Mah. 1",
    city: "İstanbul",
    district: "Kadıköy",
    email: `zz-up-${STAMP}@kobipo.test`,
  })
  check("firma açıldı (201)", rootRes.status, 201)
  const rootId: string = rootRes.body.id
  created.companies.push(rootId)

  let row = await companyRow(rootId)
  check("doğuşta TÜM modüller kapalı", sorted(row.disabledModules), sorted(MODULE_KEYS))
  check("damga yok", row.freeModulesClaimedAt, null)

  let cat = await owner.api("GET", `/api/billing/catalog?companyId=${rootId}`)
  check("katalog: freeModulesClaimed=false", cat.body.freeModulesClaimed, false)
  check("katalog: ücretsiz küme sunucudan", sorted(cat.body.freeModules), sorted(free))

  let sub = await owner.api("GET", `/api/billing/subscription?companyId=${rootId}`)
  check("abonelik özeti: açık modül yok", sub.body.openModules, [])

  const freeSelection = { companyId: rootId, planId: null, chosenModules: [], branchQuota: 0, companyQuota: 0, billingCycle: "MONTHLY" }

  const disc = await owner.api("POST", "/api/discount-codes/validate", {
    ...freeSelection,
    code: "HERHANGI",
    scope: "PACKAGE",
  })
  check(
    "indirim ön izlemesi ücretsiz pakette 422 + doğru sebep",
    [disc.status, String(disc.body.error).includes("Ücretsiz pakete")],
    [422, true],
  )

  const withCode = await owner.api("POST", "/api/billing/orders", { ...freeSelection, discountCode: "HERHANGI" })
  check(
    "indirim kodlu ücretsiz sipariş 422 + doğru sebep",
    [withCode.status, String(withCode.body.error).includes("Ücretsiz pakete")],
    [422, true],
  )
  row = await companyRow(rootId)
  check("…ve damga basılmadı", row.freeModulesClaimedAt, null)

  const claim = await owner.api("POST", "/api/billing/orders", freeSelection)
  check("ücretsiz paket siparişi 200", claim.status, 200)
  check("yanıt freeClaim=true", claim.body.freeClaim, true)

  row = await companyRow(rootId)
  check("damga basıldı", row.freeModulesClaimedAt != null, true)
  check("temel modüller açık, yalnız ücretliler kapalı", sorted(row.disabledModules), freeOnlyDisabled)

  const order = await prisma.packageOrder.findUniqueOrThrow({ where: { id: claim.body.id } })
  check("sipariş ACTIVE", order.status, "ACTIVE")
  check("sipariş 0 TL", Number(order.amount), 0)
  check("sağlayıcı FREE", order.paymentProvider, "FREE")
  check("paidAt boş (fatura yeniden deneme işi taramaz)", order.paidAt, null)
  check("fatura yok", order.invoiceId, null)
  check("satın alınan kümeye ücretsiz yazılmadı", order.resolvedModules, [])
  check("abonelik satırı AÇILMADI (süre yok)", await prisma.subscription.count({ where: { companyId: rootId } }), 0)
  const ev = await prisma.subscriptionEvent.findFirst({ where: { companyId: rootId }, orderBy: { createdAt: "desc" } })
  check("olay kaydı yazıldı", ev?.summary?.startsWith("Ücretsiz paket etkinleştirildi") ?? false, true)

  const again = await owner.api("POST", "/api/billing/orders", freeSelection)
  check("ikinci kez: 400 'zaten etkin'", [again.status, String(again.body.error).includes("zaten etkin")], [400, true])
  check("ikinci sipariş yazılmadı", await prisma.packageOrder.count({ where: { companyId: rootId } }), 1)

  cat = await owner.api("GET", `/api/billing/catalog?companyId=${rootId}`)
  check("katalog: freeModulesClaimed=true", cat.body.freeModulesClaimed, true)
  sub = await owner.api("GET", `/api/billing/subscription?companyId=${rootId}`)
  check("abonelik özeti: açık = ücretsizler", sorted(sub.body.openModules), sorted(free))

  // ------------------------------------------------------------------------------
  console.log("\nB) Yeni şube — kotayla açılır, kilitli doğar, paketi hesap yöneticisi alır")
  // Kota: kökte aktif abonelik (şube açma hakkı). Modül vermez.
  await prisma.subscription.create({
    data: {
      userId: owner.id,
      companyId: rootId,
      status: "ACTIVE",
      billingCycle: "MONTHLY",
      purchasedModules: [],
      branchQuota: 2,
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    },
  })
  const branchRes = await owner.api("POST", "/api/companies", {
    name: `ZZ-UP ${STAMP} KÖK`,
    branchName: "ŞUBE B",
    parentCompanyId: rootId,
    address: "Şube Mah. 2",
    city: "Ankara",
    email: `zz-up-${STAMP}-b@kobipo.test`,
  })
  check("şube açıldı (201)", branchRes.status, 201)
  const branchB: string = branchRes.body.id
  created.companies.push(branchB)
  row = await companyRow(branchB)
  check("şube: TÜM modüller kapalı", sorted(row.disabledModules), sorted(MODULE_KEYS))
  check("şube: damga yok (kök paketi DEVRETMEZ)", row.freeModulesClaimedAt, null)

  const branchAdmin = await makeUser("subeadmin")
  await prisma.userCompany.create({ data: { userId: branchAdmin.id, companyId: branchB, role: "ADMIN" } })
  const catB = await branchAdmin.api("GET", `/api/billing/catalog?companyId=${branchB}`)
  check("şube ADMIN'i: canPurchase=false", catB.body.canPurchase, false)
  const denied = await branchAdmin.api("POST", "/api/billing/orders", { ...freeSelection, companyId: branchB })
  check("şube ADMIN'i ücretsiz paketi ALAMAZ (403)", denied.status, 403)
  check("…damga yok", (await companyRow(branchB)).freeModulesClaimedAt, null)

  const claimB = await owner.api("POST", "/api/billing/orders", { ...freeSelection, companyId: branchB })
  check("hesap yöneticisi şube için alır (200)", [claimB.status, claimB.body.freeClaim], [200, true])
  row = await companyRow(branchB)
  check("şube: temel modüller açık", sorted(row.disabledModules), freeOnlyDisabled)

  // ------------------------------------------------------------------------------
  console.log("\nC) Paketi ALMAMIŞ şube Restoran'ı ödeyerek alır → paket de alınmış sayılır")
  const branchRes2 = await owner.api("POST", "/api/companies", {
    name: `ZZ-UP ${STAMP} KÖK`,
    branchName: "ŞUBE C",
    parentCompanyId: rootId,
    address: "Şube Mah. 3",
    city: "İzmir",
    email: `zz-up-${STAMP}-c@kobipo.test`,
  })
  check("şube C açıldı (201)", branchRes2.status, 201)
  const branchC: string = branchRes2.body.id
  created.companies.push(branchC)

  const paidOrder = await owner.api("POST", "/api/billing/orders", {
    ...freeSelection,
    companyId: branchC,
    chosenModules: ["restaurant"],
  })
  check("ücretli sipariş açıldı (freeClaim DEĞİL)", [paidOrder.status, paidOrder.body.free], [200, false])
  check("tutar > 0", Number(paidOrder.body.amount) > 0, true)
  check("ödeme öncesi damga yok", (await companyRow(branchC)).freeModulesClaimedAt, null)

  // PayTR callback'inin yaptığı: sipariş ödendi → abonelik uygulanır (fatura burada yok).
  const pending = await prisma.packageOrder.findUniqueOrThrow({ where: { id: paidOrder.body.id } })
  await activateSubscription(pending)
  row = await companyRow(branchC)
  check("ödeme sonrası damga basıldı", row.freeModulesClaimedAt != null, true)
  check("şube C: tüm modüller açık (restoran + temel)", row.disabledModules, [])

  console.log("\nD) Kök firma etkilenmedi")
  row = await companyRow(rootId)
  check("kök: yalnız ücretliler kapalı", sorted(row.disabledModules), freeOnlyDisabled)
}

main()
  .catch((e) => {
    fail++
    console.error("\n💥 BEKLENMEYEN HATA:", e)
  })
  .finally(async () => {
    // Şubeler önce (parentCompanyId), sonra kök. Abonelik/sipariş/üyelik firmayla
    // cascade silinir; olay kaydı firma FK'sı taşımadığı için ayrıca silinir.
    const ids = [...created.companies].reverse()
    await prisma.subscriptionEvent.deleteMany({ where: { companyId: { in: ids } } })
    for (const id of ids) {
      await prisma.company.deleteMany({ where: { id } })
    }
    await prisma.user.deleteMany({ where: { id: { in: created.users } } })
    const leftover = await prisma.company.count({ where: { name: { startsWith: `ZZ-UP ${STAMP}` } } })
    console.log(`\ntemizlik: kalan geçici firma = ${leftover}`)
    console.log(`SONUÇ: ${pass} geçti, ${fail} kaldı`)
    await prisma.$disconnect()
    process.exit(fail === 0 && leftover === 0 ? 0 : 1)
  })
