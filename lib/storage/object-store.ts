/**
 * Nesne deposu — sağlayıcıdan bağımsız ince arayüz.
 *
 * NEDEN VAR: ürün fotoğrafları bugün Supabase Storage'da duruyor ama R2/Blob'a
 * taşınması gündemde. Uygulamanın geri kalanı (API uçları, UI, DB) bunu hiç
 * bilmesin diye tek kapı: sağlayıcı değişince YALNIZCA bu dosyaya bir adaptör
 * eklenir, `activeStore()` onu döndürür.
 *
 * Taşıma sırasında DB'ye de dokunmak gerekmez — `Product.imageUrl` TAM URL
 * saklar, dosya yolu değil. Geçiş şu ikisiyle biter:
 *   1) nesneleri kopyala (rclone)
 *   2) UPDATE products SET "imageUrl" = replace("imageUrl", <eski>, <yeni>)
 *
 * `isOwnUrl` arayüzün parçası çünkü "istemciden gelen bu URL bizim mi" sorusu
 * sağlayıcıya göre değişen TEK kuraldır ve unutulursa güvenlik açığıdır
 * (bkz. lib/stock/product-image.ts).
 */

import {
  ensureBucket,
  deleteObject,
  getPublicUrl,
  publicObjectPath,
  uploadObject,
} from "@/lib/storage/supabase-storage"

export type ObjectStore = {
  /** Tanı amaçlı ad — hata mesajlarında ve testlerde görünür. */
  readonly name: string
  /** Dosyayı yükler ve KALICI PUBLIC URL'ini döner. */
  put(path: string, body: Buffer, contentType: string): Promise<string>
  /** URL'i verilen nesneyi siler. Best-effort: hata fırlatmaz. */
  delete(url: string): Promise<void>
  /** URL bu depoya mı ait? Yabancı adresleri reddetmek için. */
  isOwnUrl(url: string): boolean
}

/**
 * Supabase Storage adaptörü. Bucket public: menü ızgarasındaki her kart için
 * imzalı URL üretmek (ve süresi dolunca yenilemek) satış ekranını gereksiz yere
 * sunucuya bağımlı kılardı. Ürün fotoğrafı gizli veri değil.
 */
function supabaseStore(bucket: string): ObjectStore {
  return {
    name: `supabase:${bucket}`,
    async put(path, body, contentType) {
      await ensureBucket(bucket, true)
      await uploadObject(bucket, path, body, contentType)
      return getPublicUrl(bucket, path)
    },
    async delete(url) {
      const path = publicObjectPath(bucket, url)
      if (path) await deleteObject(bucket, path)
    },
    isOwnUrl(url) {
      return publicObjectPath(bucket, url) !== null
    },
  }
}

/**
 * Ürün fotoğrafları deposu. Sağlayıcı değişimi burada olur:
 *   return r2Store(process.env.R2_BUCKET!, process.env.R2_PUBLIC_BASE_URL!)
 */
export function productImageStore(): ObjectStore {
  return supabaseStore("product-images")
}
