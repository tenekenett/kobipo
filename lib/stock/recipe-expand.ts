// Reçete genişletme çekirdeği — SAF ve İZOMORFİK.
//
// Sunucunun stok düşümü ile satış ekranının "yetersiz stok" uyarısı AYNI sonucu
// vermek zorunda. Bu yüzden mantık burada saf bir fonksiyon olarak durur: sunucu
// reçeteleri DB'den, istemci SWR'den yükler ve ikisi de bunu çağırır.
// (Aynı gerekçeyle saf yazılmış mevcut örnek: lib/billing/pricing.ts computeOrder.)
//
// Temel kural tek cümledir:
//   "Bileşenin aktif reçetesi VARSA açılır, YOKSA düşülür."
//
// Bundan iki şey doğal olarak çıkar:
//  - Reçeteli mamül (Latte) kendi stoğundan DÜŞMEZ; bileşenleri düşer.
//  - Yarı mamül (Espresso) SANALDIR; stok bakiyesi tutulmaz, üzerinden geçilir.
//
// Satır bazında SAPMA olabilir: porsiyon/modifier seçimi reçeteyi yalnız o satır
// için değiştirir (soya sütü, ekstra shot, büyük boy) — bkz. `RecipeEffect`.

import { convertUnit } from "@/lib/data/units"

/** Reçete ağacında izin verilen en fazla iç içe geçme. Bozuk veriye karşı son savunma. */
export const MAX_RECIPE_DEPTH = 10

/** Stok miktarları Decimal(14,4) — genişletme sonucu bu hassasiyete yuvarlanır. */
const QTY_SCALE = 10_000

export type RecipeItemInput = {
  componentProductId: string
  /** `unit` cinsinden miktar (bileşenin stok biriminden farklı olabilir). */
  quantity: number
  unit: string
  /** Fire yüzdesi; 5 → %5 fazla düşülür. */
  wastageRate?: number | null
}

export type RecipeInput = {
  /** Reçete kaç adet mamül üretir. 0/negatif ise 1 kabul edilir. */
  yieldQuantity: number
  isActive: boolean
  items: RecipeItemInput[]
}

/** productId -> reçetesi. Reçetesi olmayan ürünler haritada BULUNMAZ. */
export type RecipeMap = Map<string, RecipeInput>

/**
 * Bir satışa (satır) özel reçete sapması — porsiyon/modifier seçiminden doğar.
 * Kararlar: docs/restoran/SATIS-EKRANI.md K6 "reçete etkisi".
 *
 *  SWAP → reçetede `fromProductId` geçtiği her yerde onun YERİNE `toProductId`
 *         düşülür; MİKTAR REÇETEDEN gelir (soya sütü, sütün kaç litresi ise o
 *         kadar). `toProductId` null ise bileşen hiç düşmez ("şekersiz").
 *  ADD  → reçeteye EK olarak düşülür ("ekstra shot"); eklenen ürünün kendi
 *         reçetesi de açılır ve tüketim satılan mamüle atfedilir.
 *
 * Etki YALNIZ kendi satırına uygulanır: aynı üründen soya sütlü ve normal iki
 * latte satıldığında ikisi ayrı satırdır ve ayrı genişler.
 */
export type RecipeEffect =
  | { mode: "SWAP"; fromProductId: string; toProductId: string | null }
  | { mode: "ADD"; productId: string; quantity: number; unit: string }

export type ExpandLine = {
  productId: string
  quantity: number
  /** Seçeneklerden kopyalanan etkiler; yoksa satır bugünkü gibi genişler. */
  effects?: RecipeEffect[] | null
  /**
   * Porsiyon çarpanı: 1,5 → reçetenin TAMAMI 1,5 kat düşer ("büyük boy").
   * Reçetesi olmayan üründe YOK SAYILIR — "1,5 şişe su" diye bir şey yok.
   */
  recipeFactor?: number | null
  /**
   * false → ürünün KENDİSİ genişletilmez, yalnız `effects` işlenir.
   *
   * Fatura ucu bunu kullanıyor: reçetesiz bir ürünün satır satır yazılan kendi
   * hareketi (kendi birim fiyatıyla) korunurken, seçeneğinden gelen ek malzeme
   * yine de düşsün diye. Genişletici aynı ürünün iki satırını tek satırda
   * toplar; bu bayrak o toplamayı gerekmediği yerde devre dışı bırakır.
   */
  expandBase?: boolean
}

/**
 * Dış dünyadan (istemci gövdesi, JSON kolonu) gelen etkileri güvenli okur.
 *
 * Etki stoğu düşüren bir girdi olduğu için burada TEK tanım var: tanınmayan mod,
 * eksik ürün ya da geçersiz miktar sessizce ELENİR — uydurma bir miktarla stok
 * bozulmasındansa etkisiz kalması yeğdir.
 */
export function parseRecipeEffects(value: unknown): RecipeEffect[] {
  if (!Array.isArray(value)) return []
  const out: RecipeEffect[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue
    const effect = raw as Record<string, unknown>
    if (effect.mode === "SWAP" && effect.fromProductId) {
      out.push({
        mode: "SWAP",
        fromProductId: String(effect.fromProductId),
        toProductId: effect.toProductId ? String(effect.toProductId) : null,
      })
      continue
    }
    if (effect.mode === "ADD" && effect.productId) {
      const quantity = Number(effect.quantity)
      if (!Number.isFinite(quantity) || quantity <= 0) continue
      out.push({
        mode: "ADD",
        productId: String(effect.productId),
        quantity,
        unit: String(effect.unit ?? ""),
      })
    }
  }
  return out
}

/** Reçetesi genişletilebilir mi (var, aktif ve dolu)? */
export function hasActiveRecipe(recipes: RecipeMap, productId: string): boolean {
  const recipe = recipes.get(productId)
  return Boolean(recipe && recipe.isActive && recipe.items.length > 0)
}

/** Bozuk/eksik çarpanı 1'e çeker; makul aralığın dışına çıkmaz. */
function normalizeFactor(value: unknown): number {
  const factor = Number(value)
  if (!Number.isFinite(factor) || factor <= 0) return 1
  return Math.min(factor, 100)
}

export type ExpandErrorReason = "CYCLE" | "DEPTH" | "UNIT_MISMATCH"

export type ExpandError = {
  productId: string
  reason: ExpandErrorReason
  /** Kullanıcıya gösterilebilir açıklama (döngü zinciri, birim çifti vb.). */
  detail?: string
}

export type ExpandResult = {
  /**
   * Reçetesi OLMAYAN ürünler — bugünkü davranış: ürünün kendisi düşer.
   * (şişe su, kutu kola, reçete tanımlanmamış her ürün)
   */
  direct: Array<{ productId: string; quantity: number }>
  /**
   * Reçeteden türeyen hammadde düşümleri — bileşenin KENDİ stok birimi cinsinden.
   * `sources`: bu miktara yol açan üst düzey mamül(ler)in id'si; hareket
   * açıklamasında ("Reçete: Latte") ve tüketim raporunda kullanılır.
   *
   * `direct` ile AYRI tutulur (aynı üründe ikisi birden olsa bile): raporlar
   * reçete tüketimini doğrudan satıştan ayırabilsin diye. Stok açısından sorun
   * değil — adjustWarehouseStock her ikisini de işler, revertStockByReference
   * ise ürün+depo bazında toplayıp tersler.
   */
  components: Array<{ productId: string; quantity: number; sources: string[] }>
  errors: ExpandError[]
}

function roundQty(n: number): number {
  return Math.round(n * QTY_SCALE) / QTY_SCALE
}

/**
 * Genişletme hatasını kullanıcıya gösterilebilir Türkçe cümleye çevirir.
 *
 * `detail` ham productId zinciri taşır (saf fonksiyon ürün adlarını bilmez), o
 * yüzden çağıran `nameOf` verir. Metin TEK yerde durur: aynı hata reçete
 * ekranında, hızlı satışta ve adisyonda aynı cümleyle görünsün — bunlar
 * kullanıcının aynı bozukluğu farklı ekranlarda tanıyabilmesi gereken hatalar.
 */
export function describeExpandError(
  error: ExpandError,
  nameOf: (productId: string) => string
): string {
  switch (error.reason) {
    case "CYCLE":
      return `Reçete döngüsü: ${(error.detail ?? error.productId).split(" → ").map(nameOf).join(" → ")}`
    case "DEPTH":
      return `"${nameOf(error.productId)}" reçetesi ${error.detail} kattan derin — açılamadı`
    case "UNIT_MISMATCH":
      return `"${nameOf(error.productId)}" için ${error.detail} dönüşümü yapılamıyor — bu bileşen stoktan DÜŞMEZ`
    default:
      return `"${nameOf(error.productId)}": ${error.reason}`
  }
}

/**
 * Satılan kalemleri hammaddeye kadar açar.
 *
 * @param unitOf Bir ürünün STOK birimini döndürür (ör. süt → "LT"). Bilinmiyorsa
 *   null; bu durumda dönüşüm yapılamaz ve UNIT_MISMATCH hatası üretilir.
 *
 * Aynı hammadde birden fazla daldan gelirse tek satırda toplanır (ör. hem latte
 * hem americano'dan gelen kahve). Hatalı dallar atlanır ama diğerleri işlenmeye
 * devam eder — çağıran taraf `errors` boş değilse ne yapacağına kendisi karar verir.
 */
export function expandRecipeLines(args: {
  lines: ExpandLine[]
  recipes: RecipeMap
  unitOf: (productId: string) => string | null | undefined
}): ExpandResult {
  const { lines, recipes, unitOf } = args
  const directTotals = new Map<string, number>()
  const componentTotals = new Map<string, { quantity: number; sources: Set<string> }>()
  const errors: ExpandError[] = []

  /**
   * @param root Bu dala yol açan üst düzey mamül; null ise henüz reçeteye
   *   girilmemiştir (yani ürünün kendisi satılıyor).
   * @param swaps Bu SATIRIN seçeneklerinden gelen bileşen değişimleri; alt
   *   reçetelere de taşınır ("sütsüz" latte'de süt, ara mamülün içinden gelse
   *   bile düşmemeli).
   */
  function walk(
    productId: string,
    qty: number,
    path: string[],
    root: string | null,
    swaps: Map<string, string | null>,
  ) {
    if (!Number.isFinite(qty) || qty === 0) return

    const recipe = recipes.get(productId)
    // Reçetesi yok / pasif / boş → bu bir hammaddedir, doğrudan düşülür.
    if (!recipe || !recipe.isActive || recipe.items.length === 0) {
      if (root === null) {
        directTotals.set(productId, (directTotals.get(productId) ?? 0) + qty)
      } else {
        const entry = componentTotals.get(productId) ?? { quantity: 0, sources: new Set<string>() }
        entry.quantity += qty
        entry.sources.add(root)
        componentTotals.set(productId, entry)
      }
      return
    }

    // Döngü: A → B → A. Kayıt anında da engelleniyor (bkz. lib/stock/recipe.ts),
    // burası veri elle bozulsa bile sonsuz döngüyü kesen savunma katmanı.
    if (path.includes(productId)) {
      errors.push({
        productId,
        reason: "CYCLE",
        detail: [...path, productId].join(" → "),
      })
      return
    }
    if (path.length >= MAX_RECIPE_DEPTH) {
      errors.push({ productId, reason: "DEPTH", detail: String(MAX_RECIPE_DEPTH) })
      return
    }

    const yieldQty = recipe.yieldQuantity > 0 ? recipe.yieldQuantity : 1
    const nextPath = [...path, productId]

    for (const item of recipe.items) {
      // Seçenek değişimi: bileşenin YERİNE başkası düşer, miktar reçeteden
      // gelir. Hedef boşsa bileşen hiç düşmez ("şekersiz").
      const isSwapped = swaps.has(item.componentProductId)
      const targetId = isSwapped
        ? swaps.get(item.componentProductId) ?? null
        : item.componentProductId
      if (!targetId) continue

      const wastageFactor = 1 + (Number(item.wastageRate) || 0) / 100
      // Reçete kaleminin kendi birimi cinsinden gereken miktar.
      const needInItemUnit = (item.quantity / yieldQty) * qty * wastageFactor

      // Birim, DEĞİŞTİRİLEN ürünün stok biriminden okunur: reçete "0,2 LT süt"
      // diyorsa soya sütü de LT cinsinden düşer. Birimler çevrilemiyorsa
      // (LT → ADET) hata üretilir; sessizce 0 düşmek stoğu bozardı.
      const stockUnit = unitOf(targetId)
      const converted = convertUnit(needInItemUnit, item.unit, stockUnit)
      if (converted == null) {
        errors.push({
          productId: targetId,
          reason: "UNIT_MISMATCH",
          detail: `${item.unit || "?"} → ${stockUnit || "?"}`,
        })
        continue
      }

      // İlk reçete adımında kök belirlenir; alt seviyelerde aynı kök taşınır,
      // böylece "Espresso üzerinden gelen kahve" de Latte'ye atfedilir.
      walk(targetId, converted, nextPath, root ?? productId, swaps)
    }
  }

  for (const line of lines) {
    if (!line?.productId) continue
    const quantity = Number(line.quantity) || 0
    if (!quantity) continue

    const effects = (line.effects ?? []).filter(Boolean)
    const swaps = new Map<string, string | null>()
    for (const effect of effects) {
      if (effect.mode === "SWAP" && effect.fromProductId) {
        swaps.set(effect.fromProductId, effect.toProductId || null)
      }
    }

    // Porsiyon çarpanı reçetenin tamamını ölçekler; reçetesi olmayan üründe
    // yok sayılır (satılan adet DEĞİŞMEZ, yalnız malzeme ölçeklenir).
    const factor = hasActiveRecipe(recipes, line.productId)
      ? normalizeFactor(line.recipeFactor)
      : 1

    if (line.expandBase !== false) {
      walk(line.productId, quantity * factor, [], null, swaps)
    }

    // Ek malzeme (ADD): kök SATILAN üründür — hareket açıklamasında ve tüketim
    // raporunda "Reçete: Latte" olarak görünsün, doğrudan satışla karışmasın.
    // Çarpan UYGULANMAZ: büyük boy latte'nin ekstra shot'ı yine tek shot'tır.
    for (const effect of effects) {
      if (effect.mode !== "ADD" || !effect.productId) continue
      const need = (Number(effect.quantity) || 0) * quantity
      if (!need) continue

      const stockUnit = unitOf(effect.productId)
      const converted = convertUnit(need, effect.unit, stockUnit)
      if (converted == null) {
        errors.push({
          productId: effect.productId,
          reason: "UNIT_MISMATCH",
          detail: `${effect.unit || "?"} → ${stockUnit || "?"}`,
        })
        continue
      }
      walk(effect.productId, converted, [], line.productId, swaps)
    }
  }

  // 0,0001'in altında kalan artıklar Decimal(14,4)'te saklanamaz; hareket yazılmaz.
  const direct = Array.from(directTotals.entries())
    .map(([productId, quantity]) => ({ productId, quantity: roundQty(quantity) }))
    .filter((d) => d.quantity !== 0)

  const components = Array.from(componentTotals.entries())
    .map(([productId, entry]) => ({
      productId,
      quantity: roundQty(entry.quantity),
      sources: Array.from(entry.sources),
    }))
    .filter((d) => d.quantity !== 0)

  return { direct, components, errors }
}

/** buildRecipeMap girdisi — /api/restoran/recipes yanıtıyla yapısal olarak uyumlu. */
export type RecipeRecord = {
  productId: string
  yieldQuantity: number
  isActive: boolean
  items: RecipeItemInput[]
}

/**
 * Reçete kayıtlarını genişletme haritasına çevirir.
 *
 * Sunucudaki loadRecipeContext (lib/stock/recipe.ts) ile AYNI kuralı uygular:
 * haritaya yalnızca AKTİF reçeteler girer. Pasif reçete satışta açılmadığı için
 * istemcideki maliyet/yetersizlik hesabında da açılmamış sayılmalı — bu tek
 * satırlık fark iki tarafın sessizce ayrışmasına yeter, o yüzden tek yerde durur.
 */
export function buildRecipeMap(recipes: RecipeRecord[]): RecipeMap {
  const map: RecipeMap = new Map()
  for (const recipe of recipes) {
    if (!recipe.isActive) continue
    const yieldQty = Number(recipe.yieldQuantity)
    map.set(recipe.productId, {
      yieldQuantity: yieldQty > 0 ? yieldQty : 1,
      isActive: true,
      items: recipe.items.map((item) => ({
        componentProductId: item.componentProductId,
        quantity: Number(item.quantity) || 0,
        unit: item.unit,
        wastageRate: item.wastageRate != null ? Number(item.wastageRate) : null,
      })),
    })
  }
  return map
}

/**
 * `from` ürününün reçete ağacında `target` ürününe giden bir yol var mı?
 * Varsa zinciri döndürür (ör. ["Espresso", "Latte"]), yoksa null.
 *
 * Reçete KAYDEDİLİRKEN döngü kontrolü için kullanılır: P ürününe bileşen olarak
 * C eklenecekse, C'den P'ye ulaşılabiliyorsa bu bir döngü demektir.
 */
export function findRecipePath(
  from: string,
  target: string,
  recipes: RecipeMap
): string[] | null {
  const seen = new Set<string>()

  function dfs(node: string, path: string[]): string[] | null {
    if (node === target) return [...path, node]
    if (seen.has(node) || path.length >= MAX_RECIPE_DEPTH) return null
    seen.add(node)

    const recipe = recipes.get(node)
    if (!recipe) return null

    for (const item of recipe.items) {
      const found = dfs(item.componentProductId, [...path, node])
      if (found) return found
    }
    return null
  }

  return dfs(from, [])
}
