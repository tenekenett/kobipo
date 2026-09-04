/**
 * GEÇİŞ: hesap bazlı abonelikten FİRMA bazlı aboneliğe (2026-09-04).
 *
 *   npx tsx scripts/abonelik-firma-bazina-gecis.ts           → yalnız rapor (kuru çalışma)
 *   npx tsx scripts/abonelik-firma-bazina-gecis.ts --uygula   → yazar
 *
 * Neden gerekli: yeni modelde `applyEntitlements` yalnız verilen firmaya yazıyor ve her
 * firmanın yetkisi KENDİ abonelik satırından üretiliyor. Bugün şubelerin ve ek firmaların
 * kendi satırı YOK — kökün aboneliğinden yararlanıyorlardı. Hiçbir şey yapılmazsa ilk
 * reconcile/yenileme turunda çalışan müşterinin şubesi sessizce kilitlenir.
 *
 * Karar (kullanıcı, 2026-09-04): mevcut şube ve ek firmalar DÖNEM SONUNA KADAR korunur.
 * Bu betik her üyeye kökün aboneliğinin bir KOPYASINI açar — para alınmaz, tarih aynı
 * kalır. Yenilemede her firma kendi ödemesini yapar.
 *
 * Kopyaya girmeyen üç alan bilinçli:
 *   - branchQuota / companyQuota = 0 → kota HESAP düzeyinde kalıyor, kökün satırında
 *     durur; kopyalasaydık hesabın açabileceği şube sayısı üye sayısı kadar çoğalırdı.
 *   - autoRenew = false ve providerSubscriptionId = null → saklı kart kökün satırında.
 *     "Açık" yazıp çekim yapamamak, dönem sonunda sessizce kapanmak demekti.
 *   - paymentRef = null → bu satırın arkasında ayrı bir tahsilat yok.
 *
 * Tekrar çalıştırılabilir: kendi aboneliği olan firma atlanır.
 */
import { prisma } from "@/lib/db/prisma"
import { applyEntitlements, resolveGrantedModules } from "@/lib/billing/entitlements"

const APPLY = process.argv.includes("--uygula")

type Row = {
  id: string
  name: string
  branchName: string | null
  kind: "şube" | "ek firma"
  rootId: string
  rootName: string
}

async function main() {
  // Hesap üyeleri: şube (parentCompanyId dolu) VE ek firma (dolu değil, accountRootId dolu).
  const members = await prisma.company.findMany({
    where: { accountRootId: { not: null } },
    select: {
      id: true,
      name: true,
      branchName: true,
      parentCompanyId: true,
      accountRootId: true,
      disabledModules: true,
      subscriptions: { select: { id: true }, take: 1 },
    },
    orderBy: { createdAt: "asc" },
  })

  const roots = new Map<string, { name: string } | null>()
  for (const m of members) {
    if (m.accountRootId && !roots.has(m.accountRootId)) {
      roots.set(
        m.accountRootId,
        await prisma.company.findUnique({
          where: { id: m.accountRootId },
          select: { name: true },
        }),
      )
    }
  }

  const willCopy: Row[] = []
  const skipped: string[] = []

  for (const m of members) {
    const rootId = m.accountRootId!
    const label = m.branchName ? `${m.name} (${m.branchName})` : m.name
    if (m.subscriptions.length > 0) {
      skipped.push(`${label} — kendi aboneliği zaten var`)
      continue
    }
    willCopy.push({
      id: m.id,
      name: m.name,
      branchName: m.branchName,
      kind: m.parentCompanyId ? "şube" : "ek firma",
      rootId,
      rootName: roots.get(rootId)?.name ?? rootId,
    })
  }

  console.log(`hesap üyesi firma : ${members.length}`)
  console.log(`kopyalanacak      : ${willCopy.length}`)
  console.log(`atlanan           : ${skipped.length}`)
  for (const s of skipped) console.log(`  · ${s}`)
  console.log("")

  for (const row of willCopy) {
    const rootSub = await prisma.subscription.findFirst({
      where: { companyId: row.rootId },
      orderBy: { createdAt: "desc" },
    })
    const label = row.branchName ? `${row.name} (${row.branchName})` : row.name

    if (!rootSub) {
      // Kökün de aboneliği yoksa kopyalanacak bir hak yok: firma zaten ücretsiz
      // modüllerle çalışıyordu, öyle kalır.
      console.log(`  ⊘ ${row.kind} ${label} — kökte (${row.rootName}) abonelik yok, atlandı`)
      continue
    }

    const granted = resolveGrantedModules(rootSub)
    console.log(
      `  ${APPLY ? "✎" : "·"} ${row.kind} ${label} ← ${row.rootName} ` +
        `[${rootSub.status}${rootSub.periodEnd ? `, bitiş ${rootSub.periodEnd.toISOString().slice(0, 10)}` : ""}] ` +
        `modüller: ${rootSub.purchasedModules.join(", ") || "—"}` +
        `${granted.length === 0 ? " (bugün yetki üretmiyor)" : ""}`,
    )

    if (!APPLY) continue

    await prisma.subscription.create({
      data: {
        userId: rootSub.userId,
        companyId: row.id,
        planId: rootSub.planId,
        provider: "NONE",
        status: rootSub.status,
        billingCycle: rootSub.billingCycle,
        purchasedModules: rootSub.purchasedModules,
        branchQuota: 0,
        companyQuota: 0,
        amount: null,
        autoRenew: false,
        cancelAtPeriodEnd: rootSub.cancelAtPeriodEnd,
        trialEndsAt: rootSub.trialEndsAt,
        periodStart: rootSub.periodStart,
        periodEnd: rootSub.periodEnd,
        lockedAt: rootSub.lockedAt,
      },
    })
    // Yetkiyi yeniden uygula: sonuç bugünküyle AYNI olmalı (kopya aynı hakkı taşıyor).
    // Farklı çıkarsa satır zaten elle düzenlenmişti — rapor onu gösterir.
    await applyEntitlements(row.id, granted)
  }

  if (!APPLY) {
    console.log("\nKURU ÇALIŞMA — hiçbir şey yazılmadı. Yazmak için: --uygula")
  } else {
    console.log("\nUygulandı.")
  }
}

main()
  .catch((e) => {
    console.error("HATA:", e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
