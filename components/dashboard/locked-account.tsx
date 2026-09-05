import Link from "next/link"
import { Archive, Download, Lock, ShoppingCart } from "lucide-react"
import { MANAGEABLE_MODULES } from "@/lib/modules"
import { withCompanyHref } from "@/lib/company/href"

/**
 * Panoda rakam basılamayan iki durumun ekranı. Hangisinin geçerli olduğunu çağıran
 * değil, ortak karar söyler: lib/dashboard/locked.ts → `lockedScreenFor`.
 *
 *   isArchived → veri salt-okunur arşivde; önce "verileriniz duruyor, indirebilirsiniz".
 *   kilit      → firmanın HİÇBİR modülü açık değil, menüde de yalnız Ayarlar/E-Dönüşüm
 *                kalır (bkz. components/dashboard/nav.tsx).
 *
 * Kilit ekranı 2026-09-05'e kadar "ücretli modülü olmayan" hesaba da basılıyordu ve
 * ücretsiz modüller büyüyünce çalışan müşterilerin panosunu yuttu (bkz. lib/modules.ts →
 * `isAccountLocked`). Bugün ekran yalnız gerçekten sıfır modüllü firmada çıkar; satın
 * alınabilecekleri tanıtma işi panonun üstündeki şeride taşındı
 * ([[components/dashboard/module-upsell-banner.tsx]]) — orası erişimi ENGELLEMEZ.
 *
 * Aynı bileşende durmalarının sebebi, altı pano sayfasının hepsinin bu dalı zaten
 * çağırıyor olması: ayrı bir ekran altı çağrı yerinde de kontrol isterdi.
 */
export function LockedAccount({
  companyId,
  canPurchase,
  isArchived = false,
}: {
  companyId: string
  /** Abonelik ekranı yalnız ADMIN'e açık; diğer roller yöneticiye yönlendirilir. */
  canPurchase: boolean
  /**
   * Hesap salt-okunur arşivde mi? ([[lib/billing/archive.ts]]) Öyleyse ekran satış
   * değil, "verileriniz duruyor" mesajı ve indirme yolu gösterir.
   */
  isArchived?: boolean
}) {
  // Ekran yalnız HİÇ açık modül kalmadığında basılıyor, dolayısıyla listelenecek şey
  // modüllerin tamamıdır. Eskiden burada "ücretsizler zaten açık" ayrımı yapılıyordu;
  // ölçü değişince o dal tanım gereği erişilemez oldu (açık modül varsa ekran çıkmaz).
  const purchasable = MANAGEABLE_MODULES

  if (isArchived) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="rounded-2xl border border-kobipo-border bg-white p-8 dark:border-border dark:bg-card">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
            <Archive className="h-6 w-6" />
          </div>

          <h1 className="mt-5 text-xl font-bold text-kobipo-navy dark:text-foreground">
            Hesabınız arşivde
          </h1>
          <p className="mt-2 text-sm text-kobipo-gray dark:text-muted-foreground">
            Aboneliğiniz sona ereli bir süre oldu ve hesabınız salt-okunur arşive alındı.
            <strong className="text-kobipo-navy dark:text-foreground">
              {" "}
              Hiçbir veriniz silinmedi
            </strong>{" "}
            — faturalarınız, cari hesaplarınız ve stok kayıtlarınız olduğu gibi duruyor.
            Görüntüleyebilir ve dışa aktarabilirsiniz; yeni kayıt yapmak için bir abonelik
            başlatmanız gerekir.
          </p>

          <div className="mt-6 rounded-xl border border-kobipo-border bg-kobipo-pale/40 p-4 dark:border-border dark:bg-muted/30">
            <p className="text-sm font-semibold text-kobipo-navy dark:text-foreground">
              Verilerinizi indirin
            </p>
            <p className="mt-1 text-xs text-kobipo-gray dark:text-muted-foreground">
              Cari hesaplar, faturalar, ürünler ve raporlar Excel/CSV olarak dışa
              aktarılabilir. Arşivdeyken de açıktır.
            </p>
            <Link
              href={withCompanyHref("/ayarlar/veri-aktarim", companyId)}
              className="mt-3 inline-flex items-center gap-2 rounded-lg border border-kobipo-border px-4 py-2 text-sm font-medium text-kobipo-navy hover:bg-kobipo-pale/60 dark:border-border dark:text-foreground dark:hover:bg-muted/50"
            >
              <Download className="h-4 w-4" />
              Veri aktarım ekranına git
            </Link>
          </div>

          {canPurchase ? (
            <Link
              href={withCompanyHref("/ayarlar/abonelik", companyId)}
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-kobipo-blue px-5 py-2.5 text-sm font-medium text-white hover:opacity-90"
            >
              <ShoppingCart className="h-4 w-4" />
              Aboneliği yeniden başlat
            </Link>
          ) : (
            <p className="mt-6 text-xs text-kobipo-gray dark:text-muted-foreground">
              Aboneliği yeniden başlatma yetkisi firma yöneticisindedir.
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="rounded-2xl border border-kobipo-border bg-white p-8 dark:border-border dark:bg-card">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-kobipo-pale text-kobipo-blue dark:bg-primary/15 dark:text-primary">
          <Lock className="h-6 w-6" />
        </div>

        <h1 className="mt-5 text-xl font-bold text-kobipo-navy dark:text-foreground">
          Firmanızda açık modül yok
        </h1>
        <p className="mt-2 text-sm text-kobipo-gray dark:text-muted-foreground">
          {canPurchase
            ? "Kobipo modüllerden oluşur; yalnızca ihtiyacınız olanların bedelini ödersiniz. Bir paket ya da tek tek modül seçtiğinizde ilgili menüler anında açılır."
            : "Firmanızda açık modül yok. Modül satın alma yetkisi firma yöneticisindedir; lütfen yöneticinizle iletişime geçin."}
        </p>

        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {purchasable.map((module) => (
            <li
              key={module.key}
              className="rounded-xl border border-kobipo-border bg-kobipo-pale/40 p-4 dark:border-border dark:bg-muted/30"
            >
              <p className="text-sm font-semibold text-kobipo-navy dark:text-foreground">
                {module.label}
              </p>
              <p className="mt-1 text-xs text-kobipo-gray dark:text-muted-foreground">
                {module.description}
              </p>
            </li>
          ))}
        </ul>

        {canPurchase && (
          <Link
            href={withCompanyHref("/ayarlar/abonelik", companyId)}
            className="mt-7 inline-flex items-center gap-2 rounded-lg bg-kobipo-blue px-5 py-2.5 text-sm font-medium text-white hover:opacity-90"
          >
            <ShoppingCart className="h-4 w-4" />
            Paket ve modülleri incele
          </Link>
        )}
      </div>
    </div>
  )
}
