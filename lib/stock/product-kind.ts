// Ürünün "ne olduğu" sorusunun TEK tanımı.
//
// Arkada üç boolean var (isService / isSellable / isIngredient) ve bunlar
// ekranlarda üç ayrı onay kutusu olarak soruluyordu. Sonuç: 8 teorik kombinasyon,
// gerçek veride yalnızca 4'ü kullanılıyor, kalanlar ya anlamsız ya da tuzak:
//
//   • isService + isSellable  → 21 üründe işaretliydi ve HİÇBİR ŞEY yapmıyordu
//     (her iki satış ekranı da hizmetleri baştan dışlıyor)
//   • üçü de kapalı           → ürün hiçbir listede görünmüyor, uyarı da yok
//
// Bu yüzden ekranlar artık tek bir 4 seçenekli soru soruyor; boolean'lar burada
// türetiliyor. ŞEMA DEĞİŞMEDİ — yalnızca ulaşılabilir durumlar kısıtlandı.

export type ProductKind = "menu" | "ingredient" | "both" | "service"

export type ProductKindFlags = {
  isService: boolean
  isSellable: boolean
  isIngredient: boolean
}

/**
 * Mevcut bayraklardan türü çözer.
 *
 * `isService` her şeyi ezer: hizmette menü/hammadde işaretleri anlamsızdır ve
 * eski kayıtlarda dolu olabilir (yukarıdaki 21 ürün). Onları "hizmet" olarak
 * okumak, göç gerektirmeden doğru sonucu verir.
 */
export function productKindOf(p: Partial<ProductKindFlags>): ProductKind {
  if (p.isService) return "service"
  const sellable = p.isSellable !== false
  const ingredient = p.isIngredient === true
  if (sellable && ingredient) return "both"
  if (ingredient) return "ingredient"
  // Üçü de kapalı olan yetim durum da buraya düşer: "menü ürünü" en zararsız
  // varsayım (ürün en azından bir yerde görünür).
  return "menu"
}

/** Türden bayraklara. Kaydetme yolunda tek dönüşüm noktası. */
export function flagsForKind(kind: ProductKind): ProductKindFlags {
  switch (kind) {
    case "service":
      // Hizmette menü/hammadde işaretleri sıfırlanır — ölü durum bırakmamak için.
      return { isService: true, isSellable: false, isIngredient: false }
    case "ingredient":
      return { isService: false, isSellable: false, isIngredient: true }
    case "both":
      return { isService: false, isSellable: true, isIngredient: true }
    case "menu":
    default:
      return { isService: false, isSellable: true, isIngredient: false }
  }
}

export type ProductKindOption = {
  value: ProductKind
  label: string
  hint: string
}

/**
 * Ekranlarda gösterilecek seçenekler.
 *
 * Restoran & Kafe kapalı firmada "menü"/"hammadde" kelimeleri anlamsız; orada
 * aynı bayraklar "satışta görünür mü" sorusuna iner ve seçenek sayısı 3'e düşer
 * ("her ikisi" ayrımının karşılığı yok).
 */
export function productKindOptions(isRestaurant: boolean): ProductKindOption[] {
  if (!isRestaurant) {
    return [
      { value: "menu", label: "Ürün", hint: "Hızlı satış ızgarasında listelenir" },
      { value: "ingredient", label: "Ürün (satışta gizli)", hint: "Izgarada görünmez; aramayla bulunur" },
      { value: "service", label: "Hizmet", hint: "Stok takibi yapılmaz" },
    ]
  }
  return [
    { value: "menu", label: "Menü ürünü", hint: "Satılır — Latte, şişe su" },
    { value: "ingredient", label: "Hammadde", hint: "Reçetelerde kullanılır — süt, kahve çekirdeği" },
    { value: "both", label: "Her ikisi", hint: "Hem satılır hem reçetede — 250 gr paket kahve" },
    { value: "service", label: "Hizmet", hint: "Stok takibi yapılmaz" },
  ]
}

/** Liste/filtre etiketleri — form seçenekleriyle AYNI isimler kullanılsın diye. */
export function productKindLabel(kind: ProductKind, isRestaurant: boolean): string {
  return productKindOptions(isRestaurant).find((o) => o.value === kind)?.label ?? ""
}

/**
 * Filtre eşleşmesi. "Her ikisi" olan ürün hem `menu` hem `ingredient` süzgecinde
 * çıkar — kullanıcı onu ararken hangi kelimeyi düşündüyse bulsun.
 */
export function matchesKindFilter(p: Partial<ProductKindFlags>, filter: ProductKind): boolean {
  const kind = productKindOf(p)
  if (filter === "menu") return kind === "menu" || kind === "both"
  if (filter === "ingredient") return kind === "ingredient" || kind === "both"
  return kind === filter
}
