/**
 * Ürün fotoğrafı (Product.imageUrl) için sunucu tarafı yardımcıları.
 *
 * Fotoğraf üç uçtan yazılıyor (POST /products, PUT ve PATCH /products/[id]);
 * silinmesi gereken eski nesne de aynı üç yerde çıkıyor. Kural tek dosyada
 * dursun ki bir uç "yabancı URL kabul etme" kontrolünü unutmasın.
 *
 * Hangi depoda durduğunu BİLMEZ — lib/storage/object-store.ts'e sorar.
 */

import { productImageStore } from "@/lib/storage/object-store"

export type ImageUrlField =
  /** Gövdede `imageUrl` yok → alana DOKUNMA (mevcut fotoğraf korunur). */
  | { changed: false }
  /** Geçerli değer: URL ya da null (fotoğrafı kaldır). */
  | { changed: true; url: string | null }
  /** Bize ait olmayan adres — çağıran 400 döner. */
  | { changed: true; error: string }

/**
 * İstek gövdesindeki `imageUrl` alanını okur ve doğrular.
 *
 * SERBEST URL KABUL EDİLMEZ: yalnızca kendi deposumuzdaki bir nesnenin URL'i
 * geçer. Aksi halde firmadaki herhangi bir yazma yetkilisi menü kartına
 * dışarıdan bir adres yazabilir; satış ekranı her açılışta o adrese istek atar
 * (izleme pikseli, bir gün kırılıp bozuk görsele düşen bağlantı).
 */
export function readImageUrlField(body: Record<string, unknown>): ImageUrlField {
  if (!("imageUrl" in body)) return { changed: false }
  const raw = body.imageUrl
  if (raw == null) return { changed: true, url: null }
  const url = String(raw).trim()
  if (!url) return { changed: true, url: null }
  if (!productImageStore().isOwnUrl(url)) {
    return {
      changed: true,
      error:
        "Ürün fotoğrafı yalnızca Kobipo'ya yüklenmiş bir görsel olabilir. " +
        "Fotoğrafı /api/stok/products/image ucundan yükleyip dönen URL'i gönderin.",
    }
  }
  return { changed: true, url }
}

/**
 * Artık kullanılmayan fotoğrafı depodan siler (best-effort; hata fırlatmaz).
 * Menü fotoğrafı sık değişen bir şeydir; temizlenmezse her değişiklik depoda
 * bir yetim dosya bırakır.
 */
export async function deleteProductImage(url: string | null | undefined): Promise<void> {
  if (!url) return
  await productImageStore().delete(url)
}
