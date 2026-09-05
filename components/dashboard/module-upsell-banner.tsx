"use client"

import { useEffect, useMemo, useState } from "react"
import { usePathname } from "next/navigation"
import { ShoppingCart, X } from "lucide-react"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { CompanyLink } from "@/components/dashboard/company-link"
import { MANAGEABLE_MODULES, sanitizeFreeModules } from "@/lib/modules"

/**
 * KAPALI ÜCRETLİ MODÜLLERİN TANITIMI — satın alma akışının panodaki tek girişi.
 *
 * Neden var: kapalı bir modülün nav grubu menüden gizleniyor (bkz. nav.tsx), yani
 * müşteri o modülü keşfedecek bir yüzey görmüyordu. Boşluğu `LockedAccount` dolduruyordu
 * ama o bir DUVAR: panoyu tamamen kaplıyor ve ölçüsü kaydığı anda (2026-08-31'de altı
 * modül temel yapılınca tam olarak bu oldu) çalışan müşterinin ekranını yutuyor.
 *
 * Bu şerit erişimi ENGELLEMEZ: panonun üstünde durur, kapatılabilir ve kapalı ücretli
 * modül kalmadığında hiç çizilmez. Duvar ise artık yalnız gerçekten sıfır modüllü
 * firmada çıkıyor (lib/dashboard/locked.ts).
 *
 * Yalnız PANO yollarında görünür: layout tüm panel sayfalarını sarıyor, her ekranda
 * tanıtım göstermek gürültü olurdu.
 *
 * `freeModules` sunucudan geçirilir (layout `getFreeModuleKeys()` çağırıyor): hangi
 * modülün satılabilir olduğu istemcide bilinmiyor ve yanlış bilinirse şerit, sistem
 * yöneticisinin elle kapattığı TEMEL bir modülü "satın al" diye tanıtırdı.
 */
export function ModuleUpsellBanner({ freeModules = [] }: { freeModules?: string[] }) {
  const pathname = usePathname()
  const { selectedCompany, userRole } = useDashboardCompany()
  const [dismissed, setDismissed] = useState(true)

  const companyKey = selectedCompany?.id ?? null
  const storageKey = companyKey ? `kobipo:modul-tanitim:${companyKey}` : null

  // Kapatma kararı firma bazında ve yalnız bu tarayıcıda tutulur; okunamazsa (gizli
  // pencere, site verisi kapalı) şerit görünür kalır — sessizce kaybolmasındansa.
  useEffect(() => {
    if (!storageKey) return
    try {
      setDismissed(window.localStorage.getItem(storageKey) === "1")
    } catch {
      setDismissed(false)
    }
  }, [storageKey])

  const closedPaid = useMemo(() => {
    if (!selectedCompany) return []
    const free = new Set(sanitizeFreeModules(freeModules))
    const disabled = new Set(selectedCompany.disabledModules ?? [])
    return MANAGEABLE_MODULES.filter((m) => !free.has(m.key) && disabled.has(m.key))
  }, [selectedCompany, freeModules])

  const onDashboard = pathname === "/dashboard" || pathname.startsWith("/dashboard/")
  if (!onDashboard || dismissed || !selectedCompany || userRole !== "ADMIN") return null
  if (closedPaid.length === 0) return null

  const close = () => {
    setDismissed(true)
    try {
      if (storageKey) window.localStorage.setItem(storageKey, "1")
    } catch {
      // Kapatma kalıcı olmasa da şerit bu oturumda kapanır.
    }
  }

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-kobipo-border bg-kobipo-pale/40 px-4 py-3 dark:border-border dark:bg-muted/30">
      <ShoppingCart className="h-4 w-4 shrink-0 text-kobipo-blue dark:text-primary" />
      <p className="min-w-0 flex-1 text-sm text-kobipo-gray dark:text-muted-foreground">
        <strong className="text-kobipo-navy dark:text-foreground">
          {closedPaid.map((m) => m.label).join(", ")}
        </strong>{" "}
        {closedPaid.length > 1 ? "modülleri" : "modülü"} firmanızda kapalı. Satın
        aldığınızda ilgili menüler anında açılır.
      </p>
      <CompanyLink
        href="/ayarlar/abonelik"
        className="shrink-0 rounded-lg bg-kobipo-blue px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
      >
        İncele
      </CompanyLink>
      <button
        type="button"
        onClick={close}
        aria-label="Bu bilgilendirmeyi kapat"
        className="shrink-0 rounded-md p-1 text-kobipo-gray hover:bg-kobipo-pale dark:text-muted-foreground dark:hover:bg-muted"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
