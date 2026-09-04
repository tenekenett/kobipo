/**
 * UÇTAN UCA: FİRMA BAZLI abonelik + firma bazında elle modül kapatma.
 *
 *   npx tsx scripts/test-modul-kapatma.ts
 *
 * İki kuralı birlikte sınar, çünkü ikisi de aynı yerde (`applyEntitlements`) buluşuyor:
 *
 *   1. YETKİ GEÇMEZ (2026-09-04 modeli): her firma — kök, şube, ek firma — kendi
 *      aboneliğini satın alır. Ana firmanın ödemesi şubeyi açmaz, şubenin süresi
 *      dolduğunda ana firma kapanmaz.
 *   2. ELLE KAPATMA: ücretsiz modül firma bazında kapatılabilir ve yetki her yeniden
 *      hesaplandığında (reconcile, yenileme) KAPALI kalır.
 *
 * Neden betik: saf kısım vitest'te (lib/modules.test.ts, lib/billing/free-modules-sync.test.ts)
 * ama asıl soru DB'de cevaplanıyor — yazma yolunun kendisi doğru mu.
 *
 * CANLI veritabanında koşar ama YALNIZ kendi yarattığı geçici kayıtlara dokunur
 * (`zz-e2e-` slug öneki) ve sonunda siler. Gerçek firmaların modül alanları baştan ve
 * sondan alınan parmak iziyle karşılaştırılır; betik onlara dokunursa test kalır.
 */
import { prisma } from "@/lib/db/prisma"
import { MODULE_KEYS, defaultDisabledModules, planCompanyModuleUpdate } from "@/lib/modules"
import {
  applyEntitlements,
  resolveGrantedModules,
  setCompanyModules,
} from "@/lib/billing/entitlements"
import { getFreeModuleKeys } from "@/lib/billing/free-modules"

const STAMP = Date.now().toString().slice(-8)
const ids: { users: string[]; companies: string[] } = { users: [], companies: [] }

let pass = 0
let fail = 0
const sorted = (a: string[]) => [...a].sort()
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

async function state(id: string) {
  const c = await prisma.company.findUniqueOrThrow({
    where: { id },
    select: { disabledModules: true, suppressedModules: true },
  })
  return { disabled: sorted(c.disabledModules), suppressed: sorted(c.suppressedModules) }
}

async function purchased(companyId: string) {
  const s = await prisma.subscription.findFirst({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    select: { purchasedModules: true },
  })
  return s ? sorted(s.purchasedModules) : null
}

/** Aboneliğin BUGÜN verdiği modüllerle yetkiyi yeniden uygular — reconcile deseni. */
async function recompute(companyId: string) {
  const sub = await prisma.subscription.findFirst({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    select: {
      status: true,
      purchasedModules: true,
      trialEndsAt: true,
      periodEnd: true,
      billingCycle: true,
    },
  })
  await applyEntitlements(companyId, resolveGrantedModules(sub))
}

/** Gerçek firmaların modül alanlarının parmak izi — betik bunları BOZMAMALI. */
async function fingerprint() {
  const rows = await prisma.company.findMany({
    where: { NOT: { slug: { startsWith: `zz-e2e-${STAMP}` } } },
    select: { id: true, disabledModules: true, suppressedModules: true },
    orderBy: { id: "asc" },
  })
  return JSON.stringify(
    rows.map((r) => [r.id, sorted(r.disabledModules), sorted(r.suppressedModules)]),
  )
}

async function main() {
  const free = await getFreeModuleKeys()
  const paid = MODULE_KEYS.filter((k) => !free.includes(k))
  const lockedAtBirth = sorted(defaultDisabledModules(free))
  console.log(`ücretsiz modüller: [${free.join(", ")}]`)
  console.log(`ücretli modüller : [${paid.join(", ")}]\n`)
  if (!free.includes("hr") || !free.includes("stock") || !paid.includes("restaurant")) {
    // Senaryo "ücretsiz bir modülü kapatmak, ödenmiş bir modülü iptal etmemeli" sorusunu
    // soruyor; bunun için en az bir ücretsiz gereksinim (stock) ve ona bağımlı bir
    // ücretli modül (restaurant) gerekiyor.
    throw new Error("Bu senaryo hr+stock ücretsiz, restaurant ücretli varsayıyor")
  }

  const before = await fingerprint()

  // --- kurulum: kök firma + şube. Abonelik YALNIZ KÖKTE. ---------------------------
  const user = await prisma.user.create({
    data: { email: `zz-e2e-${STAMP}@kobipo.test`, name: "ZZ E2E", password: "x" },
    select: { id: true },
  })
  ids.users.push(user.id)

  const root = await prisma.company.create({
    data: {
      name: "ZZ-E2E KÖK FİRMA",
      slug: `zz-e2e-${STAMP}-kok`,
      taxNumber: `9${STAMP}9`,
      disabledModules: defaultDisabledModules(free),
    },
    select: { id: true },
  })
  ids.companies.push(root.id)

  // Şube `createCompany` ile aynı şekilde doğar: ücretsizler açık, ücretliler kilitli.
  const branch = await prisma.company.create({
    data: {
      name: "ZZ-E2E KÖK FİRMA",
      branchName: "ŞUBE",
      slug: `zz-e2e-${STAMP}-sube`,
      parentCompanyId: root.id,
      accountRootId: root.id,
      disabledModules: defaultDisabledModules(free),
    },
    select: { id: true },
  })
  ids.companies.push(branch.id)

  const activePeriod = {
    status: "ACTIVE",
    billingCycle: "MONTHLY",
    periodStart: new Date(),
    periodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000),
  }
  await prisma.subscription.create({
    data: { userId: user.id, companyId: root.id, purchasedModules: ["restaurant"], branchQuota: 3, ...activePeriod },
  })

  console.log("1) Kök Restoran'ı satın aldı; şube hiçbir şey almadı")
  await recompute(root.id)
  await recompute(branch.id)
  check("kök: hiçbir modül kapalı değil", (await state(root.id)).disabled, [])
  check("ŞUBE: yetki GEÇMEDİ — ücretliler kapalı", (await state(branch.id)).disabled, lockedAtBirth)
  check("şube: ücretsizler yine de açık", lockedAtBirth.includes("hr"), false)
  check("şube: kendi aboneliği yok", await purchased(branch.id), null)

  console.log("\n2) Şube KENDİ aboneliğini alır (Restoran)")
  await prisma.subscription.create({
    data: { userId: user.id, companyId: branch.id, purchasedModules: ["restaurant"], branchQuota: 0, ...activePeriod },
  })
  await recompute(branch.id)
  check("şube: kendi ödemesiyle açıldı", (await state(branch.id)).disabled, [])
  check("kök: etkilenmedi", (await state(root.id)).disabled, [])

  console.log("\n3) Şubenin süresi doldu — ana firma çalışmaya DEVAM etmeli")
  const past = new Date(Date.now() - 24 * 3600 * 1000)
  await prisma.subscription.updateMany({
    where: { companyId: branch.id },
    data: { status: "EXPIRED", periodEnd: past },
  })
  await recompute(branch.id)
  await recompute(root.id)
  check("şube: ücretli modüller kapandı", (await state(branch.id)).disabled, lockedAtBirth)
  check("kök: hâlâ açık", (await state(root.id)).disabled, [])

  // Şube yeniden abone olur; kalan adımlar onun üstünde yürüyor.
  await prisma.subscription.updateMany({
    where: { companyId: branch.id },
    data: { status: "ACTIVE", periodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000) },
  })
  await recompute(branch.id)

  console.log("\n4) Admin ŞUBEDE ücretsiz 'Personel'i kapatır (kapsam: yalnız firma)")
  {
    const plan = planCompanyModuleUpdate(["hr"], free)
    check("karar: suppressed", plan.suppressed, ["hr"])
    await setCompanyModules(branch.id, plan.granted, { modules: plan.suppressed, scope: "company" })
    check("şube: hr kapalı", (await state(branch.id)).disabled, ["hr"])
    check("şube: kalıcı kapatma yazıldı", (await state(branch.id)).suppressed, ["hr"])
    check("kök: etkilenmedi", (await state(root.id)).disabled, [])
    check("şube aboneliği: restoran duruyor", await purchased(branch.id), ["restaurant"])
  }

  console.log("\n5) ASIL SINAV — yetki yeniden hesaplanır (reconcile / dönem yenileme)")
  await recompute(branch.id)
  check("şube: hr HÂLÂ kapalı", (await state(branch.id)).disabled, ["hr"])

  console.log("\n6) Şubede ücretsiz 'Stok' da kapatılır — ÖDENMİŞ Restoran ne olur?")
  {
    const plan = planCompanyModuleUpdate(["hr", "stock"], free)
    await setCompanyModules(branch.id, plan.granted, { modules: plan.suppressed, scope: "company" })
    check("şube: stok + zincirle restoran kapalı", (await state(branch.id)).disabled, [
      "hr",
      "restaurant",
      "stock",
    ])
    check("şube: kapatma kaydı yalnız ücretsizler", (await state(branch.id)).suppressed, [
      "hr",
      "stock",
    ])
    check("şube aboneliği: restoran yetkisi İPTAL EDİLMEDİ", await purchased(branch.id), [
      "restaurant",
    ])
    check("kök: restoran AÇIK kaldı", (await state(root.id)).disabled, [])
  }

  console.log("\n7) Şubede ÜCRETLİ 'Restoran' kapatılır — yalnız ŞUBENİN yetkisi kalkar")
  {
    const plan = planCompanyModuleUpdate(["restaurant"], free)
    check("karar: kapatma kaydı yok (ücretli)", plan.suppressed, [])
    await setCompanyModules(branch.id, plan.granted, { modules: plan.suppressed, scope: "company" })
    check("şube aboneliği: satın alma yetkisi kalktı", await purchased(branch.id), [])
    check("kök aboneliği: DOKUNULMADI", await purchased(root.id), ["restaurant"])
    check("kök: restoran hâlâ açık", (await state(root.id)).disabled, [])
  }

  console.log("\n8) Kapsam 'hesabın tümü': kapatma her firmaya yayılır")
  {
    const plan = planCompanyModuleUpdate(["reports"], free)
    await setCompanyModules(root.id, plan.granted, { modules: plan.suppressed, scope: "account" })
    check("kök: reports kapalı", (await state(root.id)).disabled, ["reports"])
    check("şube: kapatma kaydı yayıldı", (await state(branch.id)).suppressed, ["reports"])
    // Şube kendi aboneliğinden üretiliyor: 7. adımda restoranı düştüğü için kapalı.
    check("şube: reports + restoran kapalı", (await state(branch.id)).disabled, [
      "reports",
      "restaurant",
    ])
  }

  console.log("\n9) Yeni şube KİLİTLİ doğar (createCompany deseni)")
  {
    const child = await prisma.company.create({
      data: {
        name: "ZZ-E2E KÖK FİRMA",
        branchName: "YENİ ŞUBE",
        slug: `zz-e2e-${STAMP}-yeni`,
        parentCompanyId: root.id,
        accountRootId: root.id,
        disabledModules: defaultDisabledModules(free),
      },
      select: { id: true },
    })
    ids.companies.push(child.id)
    await recompute(child.id)
    check("yeni şube: ücretliler kapalı, ücretsizler açık", (await state(child.id)).disabled, lockedAtBirth)
  }

  console.log("\n10) Gerçek firmalara dokunulmadı mı?")
  check("diğer firmaların modül alanları değişmedi", (await fingerprint()) === before, true)
}

main()
  .catch((e) => {
    fail++
    console.error("\n💥 BEKLENMEYEN HATA:", e)
  })
  .finally(async () => {
    // Temizlik: firma silme cascade'li; kullanıcı ayrı siliniyor.
    if (ids.companies.length) {
      await prisma.company.deleteMany({ where: { id: { in: ids.companies } } })
    }
    if (ids.users.length) {
      await prisma.user.deleteMany({ where: { id: { in: ids.users } } })
    }
    const leftover = await prisma.company.count({ where: { slug: { startsWith: "zz-e2e-" } } })
    console.log(`\ntemizlik: kalan geçici firma = ${leftover}`)
    console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`)
    await prisma.$disconnect()
    process.exit(fail === 0 && leftover === 0 ? 0 : 1)
  })
