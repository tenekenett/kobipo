import Link from "next/link"
import { Lock, ShoppingCart } from "lucide-react"
import { MANAGEABLE_MODULES, sanitizeFreeModules } from "@/lib/modules"
import { withCompanyHref } from "@/lib/company/href"

/**
 * Hiçbir ÜCRETLİ modülü açık olmayan hesabın karşılama ekranı. Yeni firma ücretli
 * modüller kapalı doğduğu için (modül = satın alınan şey) ilk giriş burasıdır: rakam
 * basmak yerine ne satın alınacağını gösterir.
 *
 * Dashboard'da widget'ların yerini alır; menüde de yalnız Ayarlar/E-Dönüşüm — ve varsa
 * temel (ücretsiz) modüller — kalır (bkz. components/dashboard/nav.tsx).
 */
export function LockedAccount({
  companyId,
  canPurchase,
  freeModules = [],
}: {
  companyId: string
  /** Abonelik ekranı yalnız ADMIN'e açık; diğer roller yöneticiye yönlendirilir. */
  canPurchase: boolean
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
