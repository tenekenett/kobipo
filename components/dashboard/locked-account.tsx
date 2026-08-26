import Link from "next/link"
import { Archive, Download, Lock, ShoppingCart } from "lucide-react"
import { MANAGEABLE_MODULES, sanitizeFreeModules } from "@/lib/modules"
import { withCompanyHref } from "@/lib/company/href"

/**
 * Hiçbir ÜCRETLİ modülü açık olmayan hesabın karşılama ekranı. Yeni firma ücretli
 * modüller kapalı doğduğu için (modül = satın alınan şey) ilk giriş burasıdır: rakam
 * basmak yerine ne satın alınacağını gösterir.
 *
 * Dashboard'da widget'ların yerini alır; menüde de yalnız Ayarlar/E-Dönüşüm — ve varsa
 * temel (ücretsiz) modüller — kalır (bkz. components/dashboard/nav.tsx).
 *
 * ARŞİVDEKİ hesap da buraya düşer (ücretli modülleri kapalıdır) ama gördüğü ekran
 * FARKLIDIR: ona modül satmadan önce "verileriniz duruyor, indirebilirsiniz" demek
 * gerekir. Aynı bileşende durmasının sebebi, altı dashboard sayfasının hepsinin bu
 * dalı zaten çağırıyor olması — ayrı bir ekran altı çağrı yerinde de kontrol isterdi.
 */
export function LockedAccount({
  companyId,
  canPurchase,
  freeModules = [],
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
  /**
   * Sistem yöneticisinin TEMEL yaptığı modüller — bu hesapta zaten açıklar. Listede
   * "satın alınacaklar" arasında görünmemeli, yoksa ekran kullanıcıya kapalı olmayan
   * bir şeyi satmaya çalışır.
   */
  freeModules?: string[]
}) {
  const free = new Set(sanitizeFreeModules(freeModules))
  const purchasable = MANAGEABLE_MODULES.filter((m) => !free.has(m.key))
  const openFree = MANAGEABLE_MODULES.filter((m) => free.has(m.key))

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
          Hesabınız hazır — şimdi modüllerinizi seçin
        </h1>
        <p className="mt-2 text-sm text-kobipo-gray dark:text-muted-foreground">
          {canPurchase
            ? "Kobipo modüllerden oluşur; yalnızca ihtiyacınız olanların bedelini ödersiniz. Bir paket ya da tek tek modül seçtiğinizde ilgili menüler anında açılır."
            : "Firmanızda henüz açık modül yok. Modül satın alma yetkisi firma yöneticisindedir; lütfen yöneticinizle iletişime geçin."}
        </p>

        {openFree.length > 0 && (
          <p className="mt-4 rounded-lg border border-kobipo-border bg-kobipo-pale/40 px-4 py-3 text-xs text-kobipo-gray dark:border-border dark:bg-muted/30 dark:text-muted-foreground">
            <strong className="text-kobipo-navy dark:text-foreground">
              {openFree.map((m) => m.label).join(", ")}
            </strong>{" "}
            {openFree.length > 1 ? "modülleri" : "modülü"} hesabınızda ücretsiz açık —
            menüden hemen kullanabilirsiniz.
          </p>
        )}

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
