/**
 * Ürünün iki gruplama ekseni: KATEGORİ ve MARKA.
 *
 * İkisi de aynı modelde yaşar — ürünün kendi metni (`Product.category` /
 * `Product.brand`) + firma bazlı öneri listesi (CompanyDefinition, tip aşağıda).
 * Satır içi seçici (components/stok/product-group-select.tsx), yönetim penceresi
 * (components/stok/category-manager-dialog.tsx) ve toplu yeniden adlandırma ucu
 * (`/api/stok/products/category?field=`) eksen adını buradan alır.
 *
 * Eksenler BİRBİRİNDEN BAĞIMSIZDIR: "Bosch" kategori değil, "Matkap" marka değil.
 * Tek alana sıkıştırılsalardı süzgeç "Bosch matkapları"nı soramazdı.
 */

export type ProductGroupKind = "category" | "brand"

/** Eksenin tanım tipi ve Türkçe çekimli metinleri. Ürün alanının adı `kind`in kendisidir. */
export const PRODUCT_GROUP_TEXT = {
  category: {
    definitionType: "PRODUCT_CATEGORY",
    title: "Kategoriler",
    description:
      "Ürün eklerken bu listeden seçilir. Silmek, kategoriyi kullanan ürünlerin kategorisini de boşaltır — satış ekranındaki sekme böyle kalkar.",
    Noun: "Kategori",
    noun: "kategori",
    Acc: "Kategoriyi",
    poss: "kategorisi",
    possAcc: "kategorisini",
    loc: "kategorisindeki",
    dat: "kategorisine",
    pluralAcc: "Kategorileri",
    without: "kategorisiz",
    // Satış/adisyon ekranındaki sekmeler kategoriden üretiliyor; silmenin oradaki
    // etkisi söylenmezse "sekme neden kayboldu" sorusu doğuyor.
    deleteNote: (label: string) => ` ve satış ekranındaki "${label}" sekmesi kaybolacak`,
  },
  brand: {
    definitionType: "PRODUCT_BRAND",
    title: "Markalar",
    description:
      "Ürün eklerken bu listeden seçilir. Silmek, markayı kullanan ürünlerin markasını da boşaltır.",
    Noun: "Marka",
    noun: "marka",
    Acc: "Markayı",
    poss: "markası",
    possAcc: "markasını",
    loc: "markasındaki",
    dat: "markasına",
    pluralAcc: "Markaları",
    without: "markasız",
    deleteNote: (_label: string) => "",
  },
} as const

/**
 * Süzgeçte "değeri girilmemiş" seçeneği (ör. Markasız). Gerçek bir etiketle
 * çakışmasın diye kullanıcının yazmayacağı bir değer; ekran, dışa aktarım ve
 * liste ucu AYNI sabiti tanır — biri tanımazsa "Markasız" Excel'de boş döner.
 */
export const PRODUCT_GROUP_NONE = "__none__"

/** Süzgeç değerini Prisma koşuluna çevirir: NONE → `null` (IS NULL), diğerleri aynen. */
export function groupWhereValue(value: string): string | null {
  return value === PRODUCT_GROUP_NONE ? null : value
}

/** Ürünün etiketi seçili süzgece uyuyor mu ("ALL" = süzgeç yok). */
export function matchesGroupFilter(label: string | null | undefined, filter: string): boolean {
  if (filter === "ALL") return true
  const value = (label ?? "").trim()
  return filter === PRODUCT_GROUP_NONE ? value === "" : value === filter
}

export type GroupChip = { value: string; count: number }

/**
 * Süzgeç rozetleri. Yalnız ürünlerde GEÇEN etiketler rozet olur: tanımlı ama
 * hiç kullanılmamış bir marka tıklanınca boş liste verirdi.
 *
 * - SIRA `all` (süzgeçsiz liste) üzerindeki kullanım sayısıdır, eşitlikte ad:
 *   süzgeç değiştikçe rozetler yer değiştirseydi kullanıcı aradığını her
 *   seferinde yeniden arardı.
 * - SAYI `scope` (bu eksen DIŞINDAKİ süzgeçler uygulanmış küme) üzerindendir —
 *   tür rozetleriyle aynı anlam: "buna basarsam kaç kayıt kalır".
 */
export function groupChips(
  all: Array<string | null | undefined>,
  scope: Array<string | null | undefined>,
): { chips: GroupChip[]; noneCount: number } {
  const usage = new Map<string, number>()
  for (const raw of all) {
    const value = (raw ?? "").trim()
    if (value) usage.set(value, (usage.get(value) ?? 0) + 1)
  }
  const inScope = new Map<string, number>()
  let noneCount = 0
  for (const raw of scope) {
    const value = (raw ?? "").trim()
    if (value) inScope.set(value, (inScope.get(value) ?? 0) + 1)
    else noneCount++
  }
  const chips = Array.from(usage.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "tr"))
    .map(([value]) => ({ value, count: inScope.get(value) ?? 0 }))
  return { chips, noneCount }
}

/**
 * Kapalı görünümde gösterilecek rozetler: ilk `limit` tanesi + (gizli kalan
 * bölümdeyse) SEÇİLİ olan. Seçili rozet gizlenseydi kullanıcı hangi süzgecin
 * açık olduğunu göremezdi.
 */
export function visibleGroupChips(chips: GroupChip[], active: string, limit: number): GroupChip[] {
  const head = chips.slice(0, limit)
  if (head.some((c) => c.value === active)) return head
  const selected = chips.find((c) => c.value === active)
  return selected ? [...head, selected] : head
}
