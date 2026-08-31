import { NextResponse } from "next/server"
import { getCurrentUser } from "@/lib/auth/session"
import { requireSuperAdmin } from "@/lib/auth/require-super-admin"
import { prisma } from "@/lib/db/prisma"
import { ensureDefaultPricingItems } from "@/lib/billing/catalog"
import {
  BRANCH_ITEM_KEY,
  COMPANY_ITEM_KEY,
  moduleKeyFromPriceKey,
  modulePriceKey,
} from "@/lib/billing/constants"
import { MANAGEABLE_MODULES, MODULE_KEYS, sanitizeFreeModules } from "@/lib/modules"
import {
  freeModulesFromPricingItems,
  invalidateFreeModuleCache,
  paidDependenciesOf,
} from "@/lib/billing/free-modules"
import { syncFreeModuleGrants } from "@/lib/billing/free-modules-sync"
import { logPricingChanges, type PricingChangeInput } from "@/lib/billing/pricing-history"

export const dynamic = "force-dynamic"

/** Bir fiyat öğesi anahtarı geçerli mi? (module:<bilinenModül>, "branch" veya "company") */
function isValidItemKey(key: string): boolean {
  if (key === BRANCH_ITEM_KEY || key === COMPANY_ITEM_KEY) return true
  const mk = moduleKeyFromPriceKey(key)
  return !!mk && (MODULE_KEYS as string[]).includes(mk)
}

/** Modül anahtarından okunur etiket ("stock" → "Stok"). */
function moduleLabel(key: string): string {
  return MANAGEABLE_MODULES.find((m) => m.key === key)?.label ?? key
}

/**
 * À la carte tekil fiyatlar (her modül + ek şube) ve TEMEL (ücretsiz) modül işareti.
 * GET  — aktif öğeler herkese; ?all=1 (süper admin) pasifler dahil. Varsayılanları tohumlar.
 * PUT  — fiyatları ve `isFree` işaretini toplu günceller (süper admin). `isFree` değişirse
 *        mevcut hesaplar da hizalanır (bkz. `syncFreeModuleGrants`).
 */
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const wantAll = new URL(request.url).searchParams.get("all") === "1"
  let includeInactive = false
  if (wantAll) {
    const auth = await requireSuperAdmin()
    if ("error" in auth) return auth.error
    includeInactive = true
  }

  await ensureDefaultPricingItems()
  const items = await prisma.pricingItem.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: { sortOrder: "asc" },
  })
  return NextResponse.json({ data: items })
}

export async function PUT(request: Request) {
  const auth = await requireSuperAdmin()
  if ("error" in auth) return auth.error

  try {
    const body = await request.json()
    const items = Array.isArray(body?.items) ? body.items : []
    if (items.length === 0) {
      return NextResponse.json({ error: "Güncellenecek öğe yok" }, { status: 400 })
    }

    // ÖNCEKİ hâlin TAMAMI okunur. İki iş birden görüyor: ücretsiz kümesi hizalaması
    // simetrik farktan yürüyor, ve fiyat tarihçesi eski değeri ancak UPDATE'ten önce
    // görebilir — sonrasında geri dönülemez biçimde kaybolur
    // ([[lib/billing/pricing-history.ts]]).
    const before = await prisma.pricingItem.findMany()
    const previousFree = freeModulesFromPricingItems(before)
    const beforeByKey = new Map(before.map((i) => [i.key, i]))

    const ops = []
    const nextFreeKeys: string[] = []
    const touchedKeys = new Set<string>()
    const changes: PricingChangeInput[] = []
    for (const raw of items) {
      const key = String(raw?.key ?? "").trim()
      if (!isValidItemKey(key)) {
        return NextResponse.json({ error: `Geçersiz fiyat anahtarı: ${key}` }, { status: 400 })
      }
      touchedKeys.add(key)
      const monthlyPrice = Number(raw?.monthlyPrice)
      const yearlyPrice = Number(raw?.yearlyPrice)
      if (!Number.isFinite(monthlyPrice) || monthlyPrice < 0) {
        return NextResponse.json({ error: `Aylık fiyat geçersiz: ${key}` }, { status: 400 })
      }
      if (!Number.isFinite(yearlyPrice) || yearlyPrice < 0) {
        return NextResponse.json({ error: `Yıllık fiyat geçersiz: ${key}` }, { status: 400 })
      }
      const isActive = raw?.isActive == null ? true : Boolean(raw.isActive)
      const label = raw?.label ? String(raw.label).trim() : undefined

      // TEMEL (ücretsiz) modül işareti. Yalnız modül kalemlerinde anlamlı: ek şube ve ek
      // firma birer KOTA sayacıdır, ücretsiz yapılacak bir modül değil.
      const moduleKey = moduleKeyFromPriceKey(key)
      const isFree = Boolean(raw?.isFree) && !!moduleKey
      if (Boolean(raw?.isFree) && !moduleKey) {
        return NextResponse.json(
          { error: "Ek şube ve ek firma kotası ücretsiz yapılamaz; bunlar modül değil kotadır." },
          { status: 400 },
        )
      }
      if (isFree && moduleKey) nextFreeKeys.push(moduleKey)

      const previous = beforeByKey.get(key)
      changes.push({
        kind: "PRICING_ITEM",
        targetKey: key,
        targetLabel: label || previous?.label || key,
        before: previous
          ? {
              monthlyPrice: previous.monthlyPrice,
              yearlyPrice: previous.yearlyPrice,
              isActive: previous.isActive,
              isFree: previous.isFree,
              label: previous.label,
            }
          : {},
        after: { monthlyPrice, yearlyPrice, isActive, isFree, ...(label ? { label } : {}) },
        changedById: auth.user.id,
      })

      ops.push(
        prisma.pricingItem.update({
          where: { key },
          data: { monthlyPrice, yearlyPrice, isActive, isFree, ...(label ? { label } : {}) },
        }),
      )
    }

    // Gövdede gelmeyen kalemlere dokunulmuyor; ücretsiz kümesi bu yüzden hem yeni
    // işaretlilerden hem de dokunulmamış eski işaretlilerden oluşur.
    for (const key of previousFree) {
      if (!touchedKeys.has(modulePriceKey(key))) nextFreeKeys.push(key)
    }

    // BAĞIMLILIK KURALI — gereksinimi ücretli kalan bir modül ücretsiz yapılamaz. Aksi
    // halde `withModuleDependencies` gereksinimi de açar ve parası alınan modül bedavaya
    // gider (ör. Restoran & Kafe ücretsiz, Stok ücretli).
    for (const key of nextFreeKeys) {
      const blockers = paidDependenciesOf(key, nextFreeKeys)
      if (blockers.length > 0) {
        return NextResponse.json(
          {
            error:
              `"${moduleLabel(key)}" ücretsiz yapılamaz: gerektirdiği ` +
              `${blockers.map(moduleLabel).join(", ")} modülü ücretli. Önce onu da ücretsiz yapın.`,
          },
          { status: 400 },
        )
      }
    }
    const nextFree = sanitizeFreeModules(nextFreeKeys)

    await prisma.$transaction(ops)
    // Katalogda ne değiştiği kalıcı kayda geçer. Yalnız GERÇEKTEN değişen alanlar yazılır.
    await logPricingChanges(changes)
    // Hizalama ve sonraki okumalar yeni kümeyi görsün.
    invalidateFreeModuleCache()

    // Ücretsiz küme değiştiyse MEVCUT hesaplar da hizalanır: yeni ücretsizler herkeste
    // açılır, ücretsizliği kalkanlar satın almamış hesaplarda kapanır. Yeni firmalar
    // zaten `createCompany` üzerinden doğru doğuyor.
    const sync = await syncFreeModuleGrants(previousFree, nextFree)

    const updated = await prisma.pricingItem.findMany({ orderBy: { sortOrder: "asc" } })
    return NextResponse.json({ data: updated, freeModules: nextFree, sync })
  } catch (error: any) {
    console.error("billing pricing PUT error:", error)
    return NextResponse.json({ error: error?.message || "Internal server error" }, { status: 500 })
  }
}
