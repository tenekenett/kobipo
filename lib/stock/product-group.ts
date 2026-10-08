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
    allLabel: "Tüm kategoriler",
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
    allLabel: "Tüm markalar",
    deleteNote: (_label: string) => "",
  },
} as const
