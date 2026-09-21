/**
 * DENEME beyaz listesi — env'den okunan firma kümesi. Fiş/belge tarama, asistan
 * ve menü tarama aynı kapıyı kullanır; kural TEK yerde durur.
 *
 * NEDEN ENV, NEDEN MODÜL DEĞİL: bunlar ürün değil, canlıda birkaç firmayla
 * yürütülen DENEMELER. Modül anahtarı açmak onları satılabilir bir kalem yapar
 * (PricingItem, kota, purchasedModules, reconcile...) ve denemeyi kapatmak
 * sonradan göç gerektirirdi. Env listesi Vercel'den değiştirilir, kod dokunulmaz.
 *
 * FAIL-CLOSED: liste tanımsız ya da boşsa HİÇ KİMSE açamaz. Ters kurgu (boş =
 * herkese açık) canlıda bir env'i unutmanın bedelini model faturasına yazardı.
 *
 * Değer: virgülle ayrılmış firma id'si veya slug'ı.
 *   FIS_TARAMA_COMPANIES=ornek-market,cmf3x9k2p0001abcd
 */

const AYRAC = /[,\s]+/

function beyazListe(envAdi: string): Set<string> {
  const ham = process.env[envAdi] ?? ""
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
export function firmaBeyazListede(
  envAdi: string,
  company: { id?: string | null; slug?: string | null } | null | undefined
): boolean {
  if (!company) return false
  const liste = beyazListe(envAdi)
  if (liste.size === 0) return false
  const id = company.id?.toLowerCase()
  const slug = company.slug?.toLowerCase()
  return Boolean((id && liste.has(id)) || (slug && liste.has(slug)))
}
