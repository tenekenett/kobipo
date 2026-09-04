/**
 * UÇTAN UCA: firma bazında elle modül kapatma (`Company.suppressedModules`).
 *
 *   npx tsx scripts/test-modul-kapatma.ts
 *
 * Neden betik: kuralın saf kısmı vitest'te (lib/modules.test.ts,
 * lib/billing/free-modules-sync.test.ts) ama asıl soru DB'de cevaplanıyor — "yetki
 * yeniden hesaplandığında kapatma ayakta kalıyor mu". Bu, ekranın bugüne kadarki
 * hatasının tam olarak yaşandığı yer; regresyonu ancak gerçek yazma yolu yakalar.
 *
 * CANLI veritabanında koşar ama YALNIZ kendi yarattığı geçici kayıtlara dokunur
 * (`zz-e2e-` slug öneki) ve sonunda siler. Gerçek firmaların modül alanları baştan ve
 * sondan alınan parmak iziyle karşılaştırılır; betik onlara dokunursa test kalır.
 */
import { prisma } from "@/lib/db/prisma"
import { MODULE_KEYS, planCompanyModuleUpdate } from "@/lib/modules"
import {
  applyEntitlements,
  resolveGrantedModules,
  setAccountModules,
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

async function purchased(rootId: string) {
  const s = await prisma.subscription.findFirstOrThrow({
    where: { companyId: rootId },
    orderBy: { createdAt: "desc" },
    select: { purchasedModules: true },
  })
  return sorted(s.purchasedModules)
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
  console.log(`ücretsiz modüller: [${free.join(", ")}]`)
  console.log(`ücretli modüller : [${paid.join(", ")}]\n`)
  if (!free.includes("hr") || !free.includes("stock") || !paid.includes("restaurant")) {
    // Senaryo "ücretsiz bir modülü kapatmak, ödenmiş bir modülü iptal etmemeli" sorusunu
    // soruyor; bunun için en az bir ücretsiz gereksinim (stock) ve ona bağımlı bir
    // ücretli modül (restaurant) gerekiyor.
    throw new Error("Bu senaryo hr+stock ücretsiz, restaurant ücretli varsayıyor")
  }

  const before = await fingerprint()

  // --- kurulum: kök firma + şube + ACTIVE abonelik (restaurant satın alınmış) --------
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
      disabledModules: [],
    },
    select: { id: true },
  })
  ids.companies.push(root.id)

  const branch = await prisma.company.create({
    data: {
      name: "ZZ-E2E KÖK FİRMA",
      branchName: "ŞUBE",
      slug: `zz-e2e-${STAMP}-sube`,
      parentCompanyId: root.id,
      accountRootId: root.id,
      disabledModules: [],
    },
    select: { id: true },
  })
  ids.companies.push(branch.id)

  const sub = await prisma.subscription.create({
    data: {
      userId: user.id,
      companyId: root.id,
      status: "ACTIVE",
      billingCycle: "MONTHLY",
      purchasedModules: ["restaurant"],
      periodStart: new Date(),
      periodEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      branchQuota: 3,
    },
    select: { id: true },
  })

  const grantNow = async () => {
    const s = await prisma.subscription.findUniqueOrThrow({
      where: { id: sub.id },
      select: {
        status: true,
        purchasedModules: true,
        trialEndsAt: true,
        periodEnd: true,
        billingCycle: true,
      },
    })
    return resolveGrantedModules(s)
  }

  console.log("1) Başlangıç: abonelik uygulanır (ücretsizler + satın alınan restaurant)")
  await applyEntitlements(root.id, await grantNow())
  check("kök: hiçbir modül kapalı değil", (await state(root.id)).disabled, [])
  check("şube: hiçbir modül kapalı değil", (await state(branch.id)).disabled, [])

  console.log("\n2) Admin ŞUBEDE ücretsiz 'Personel'i kapatır (kapsam: yalnız firma)")
  {
    const plan = planCompanyModuleUpdate(["hr"], free)
    check("karar: suppressed", plan.suppressed, ["hr"])
    check("karar: hr yetkiden düşmez", plan.granted.includes("hr"), true)
    await setAccountModules(branch.id, plan.granted, { modules: plan.suppressed, scope: "company" })
    check("şube: hr kapalı", (await state(branch.id)).disabled, ["hr"])
    check("şube: kalıcı kapatma yazıldı", (await state(branch.id)).suppressed, ["hr"])
    check("kök: etkilenmedi", (await state(root.id)).disabled, [])
    check("kök: kapatma yok", (await state(root.id)).suppressed, [])
    check("abonelik: restaurant duruyor", await purchased(root.id), ["restaurant"])
  }

  console.log("\n3) ASIL SINAV — yetki yeniden hesaplanır (reconcile / dönem yenileme)")
  await applyEntitlements(root.id, await grantNow())
  check("şube: hr HÂLÂ kapalı (eskiden burada geri açılıyordu)", (await state(branch.id)).disabled, [
    "hr",
  ])
  check("kök: hâlâ tamamen açık", (await state(root.id)).disabled, [])

  console.log("\n4) Şubede ücretsiz 'Stok' da kapatılır — ÖDENMİŞ Restoran ne olur?")
  {
    const plan = planCompanyModuleUpdate(["hr", "stock"], free)
    await setAccountModules(branch.id, plan.granted, { modules: plan.suppressed, scope: "company" })
    check("şube: stok + zincirle restoran kapalı", (await state(branch.id)).disabled, [
      "hr",
      "restaurant",
      "stock",
    ])
    check("şube: kapatma kaydı yalnız ücretsizler", (await state(branch.id)).suppressed, [
      "hr",
      "stock",
    ])
    check("kök: restoran AÇIK kaldı", (await state(root.id)).disabled, [])
    check("abonelik: restoran yetkisi İPTAL EDİLMEDİ", await purchased(root.id), ["restaurant"])
  }

  console.log("\n5) Kökte ÜCRETLİ 'Restoran' kapatılır — hesabın tümünü etkilemeli")
  {
    const plan = planCompanyModuleUpdate(["restaurant"], free)
    check("karar: kapatma kaydı yok (ücretli)", plan.suppressed, [])
    await setAccountModules(root.id, plan.granted, { modules: plan.suppressed, scope: "company" })
    check("abonelik: satın alma yetkisi kalktı", await purchased(root.id), [])
    check("kök: restoran kapalı", (await state(root.id)).disabled, ["restaurant"])
    check("şube: kendi kapatmaları duruyor", (await state(branch.id)).disabled, [
      "hr",
      "restaurant",
      "stock",
    ])
  }

  console.log("\n6) Kapsam 'hesabın tümü': kökten kapatma şubeye de yayılır")
  {
    const plan = planCompanyModuleUpdate(["reports"], free)
    await setAccountModules(root.id, plan.granted, { modules: plan.suppressed, scope: "account" })
    check("kök: reports kapalı", (await state(root.id)).disabled, ["reports"])
    check("kök: kapatma kaydı", (await state(root.id)).suppressed, ["reports"])
    check("şube: kapatma kaydı ÜZERİNE YAZILDI", (await state(branch.id)).suppressed, ["reports"])
    check("şube: reports kapalı, eski kapatmalar kalktı", (await state(branch.id)).disabled, [
      "reports",
    ])
  }

  console.log("\n7) Yeni şube kökün kapatmasını devralır (createCompany deseni)")
  {
    const parent = await prisma.company.findUniqueOrThrow({
      where: { id: root.id },
      select: { disabledModules: true, suppressedModules: true },
    })
    const child = await prisma.company.create({
      data: {
        name: "ZZ-E2E KÖK FİRMA",
        branchName: "YENİ ŞUBE",
        slug: `zz-e2e-${STAMP}-yeni`,
        parentCompanyId: root.id,
        accountRootId: root.id,
        disabledModules: parent.disabledModules,
        suppressedModules: parent.suppressedModules,
      },
      select: { id: true },
    })
    ids.companies.push(child.id)
    await applyEntitlements(root.id, await grantNow())
    check("yeni şube: reports kapalı doğdu ve kapalı kaldı", (await state(child.id)).disabled, [
      "reports",
    ])
  }

  console.log("\n8) Kapatma geri alınır (admin anahtarı tekrar açar)")
  {
    const plan = planCompanyModuleUpdate([], free)
    await setAccountModules(root.id, plan.granted, { modules: [], scope: "account" })
    check("kök: kapatma kaydı temizlendi", (await state(root.id)).suppressed, [])
    check("şube: kapatma kaydı temizlendi", (await state(branch.id)).suppressed, [])
    // Restoran 5. adımda yetkiden düşmüştü; burada elle yeniden verildi.
    check("abonelik: restoran yeniden verildi", await purchased(root.id), ["restaurant"])
    check("kök: her şey açık", (await state(root.id)).disabled, [])
    check("şube: her şey açık", (await state(branch.id)).disabled, [])
  }

  console.log("\n9) Gerçek firmalara dokunulmadı mı?")
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
