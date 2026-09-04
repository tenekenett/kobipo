/**
 * Asistan erişimi — firma bazlı beyaz liste.
 *
 * Fiş taramanın (`lib/fis-ocr/access.ts`) birebir aynı gerekçesi: bu bir ürün
 * değil, canlıda birkaç firmayla yürütülen bir DENEME. Modül anahtarı açmak onu
 * satılabilir bir kalem yapardı (PricingItem, kota, purchasedModules, reconcile)
 * ve denemeyi kapatmak göç gerektirirdi. Env listesi Vercel'den değiştirilir.
 *
 * FAIL-CLOSED: liste tanımsız ya da boşsa HİÇ KİMSE açamaz. Ters kurgu (boş =
 * herkese açık) canlıda bir env'i unutmanın bedelini token faturasına yazardı.
 *
 * Değer: virgülle ayrılmış firma id'si veya slug'ı.
 *   ASISTAN_COMPANIES=ornek-market,cmf3x9k2p0001abcd
 */

const AYRAC = /[,\s]+/

function beyazListe(): Set<string> {
  const ham = process.env.ASISTAN_COMPANIES ?? ""
  return new Set(
    ham
      .split(AYRAC)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  )
}

/**
 * Firma denemeye dahil mi? Hem id hem slug kabul edilir — env'i elle yazan kişi
 * panelde hangisini görüyorsa onu yapıştırabilsin.
 */
export function asistanAcikMi(
  company: { id?: string | null; slug?: string | null } | null | undefined
): boolean {
  if (!company) return false
  const liste = beyazListe()
  if (liste.size === 0) return false
  const id = company.id?.toLowerCase()
  const slug = company.slug?.toLowerCase()
  return Boolean((id && liste.has(id)) || (slug && liste.has(slug)))
}
