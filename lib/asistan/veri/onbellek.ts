/**
 * İSTEK ÖMÜRLÜ önbellek — tek bir asistan isteği içinde aynı ağır hesabı iki kez
 * yapmamak için.
 *
 * Somut sebep: `computeCariAging` firmanın TÜM carilerini, faturalarıyla ve
 * ödemeleriyle birlikte çeken iki büyük sorgu koşturuyor (ölçüldü: bu firmada
 * 2,4 sn, tek başına en pahalı iş). Tek bir sohbet sorusunda dört kez
 * çağrılabiliyordu: vadesi geçen alacak sinyali, vadesi geçen borç sinyali ve
 * modelin çağırdığı `vadesi_gecenler` / `cari_ara` araçları. Dördü de aynı
 * cevabı istiyor.
 *
 * NEDEN React `cache()` DEĞİL: o yalnız React istek kapsamında memoize eder;
 * ölçüm tezgâhı ve testler o kapsamın dışında koşuyor ve orada sessizce
 * memoize ETMİYOR — yani en çok ihtiyaç duyulan yerde (ölçüm) devre dışı kalır.
 * Açıkça taşınan bir harita her yerde aynı davranır.
 *
 * SÜRESİ İSTEK KADAR: harita çağıranda yaratılır, istek bitince çöpe gider.
 * Kalıcı olsaydı kullanıcı bir tahsilat girdikten sonra eski rakamı görürdü.
 */

export type IstekOnbellegi = Map<string, Promise<unknown>>

export function istekOnbellegi(): IstekOnbellegi {
  return new Map()
}

/**
 * Anahtar daha önce sorulduysa AYNI promise'i döndürür.
 *
 * Promise saklanıyor, sonuç değil: iki çağrı aynı anda gelirse (sinyaller
 * paralel koşuyor) ikisi de tek hesabı bekler. Sonuç saklansaydı ikisi de
 * "henüz yok" görüp hesabı ayrı ayrı başlatırdı — ki düzeltilmek istenen tam
 * olarak bu.
 */
export function hatirla<T>(
  onbellek: IstekOnbellegi | undefined,
  anahtar: string,
  uret: () => Promise<T>
): Promise<T> {
  if (!onbellek) return uret()
  const mevcut = onbellek.get(anahtar)
  if (mevcut) return mevcut as Promise<T>
  const soz = uret()
  onbellek.set(anahtar, soz)
  return soz
}
