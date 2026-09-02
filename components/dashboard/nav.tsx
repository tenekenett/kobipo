"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { signOut } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { KobipoLogoMark } from "@/components/ui/kobipo-logo-mark"
import { cn } from "@/lib/utils"
import { LogOut, Menu, X, ChevronDown, Loader2 } from "lucide-react"
import { allNavItems, navGroups, navItemActive, standaloneNavHrefs, type NavItemDef } from "@/components/dashboard/nav-config"
import { MODULE_GROUP_TO_KEY, MODULE_KEYS } from "@/lib/modules"
import { useState, useEffect, useCallback, useMemo } from "react"
import { useDashboardCompany, useVisiblePages } from "@/components/dashboard/dashboard-company-provider"
import { withCompanyHref } from "@/lib/company/href"
import { useSidebar } from "@/components/dashboard/sidebar-provider"
import { landingPathFor } from "@/lib/page-access"
import { DENEME_PAGES, E_DONUSUM_PAGES, moduleKeyForPath } from "@/lib/nav/pages"
export function DashboardNav() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [pendingHref, setPendingHref] = useState<string | null>(null)
  const { selectedCompany, pagePermissions } = useDashboardCompany()
  const visibleHrefs = useVisiblePages()
  // Logo tıklaması kısıtlı çalışanı rol panosuna değil, yetkili olduğu ilk sayfaya
  // götürür — pano ciro/kâr rakamı basıyor.
  const landingPath = useMemo(
    () =>
      landingPathFor(pagePermissions, {
        disabledModules: selectedCompany?.disabledModules ?? [],
        isEDonusumEnabled: selectedCompany?.isEDonusumEnabled !== false,
      }),
    [pagePermissions, selectedCompany]
  )
  const { collapsed } = useSidebar()

  // Aktif firma seçimi URL'de ?company=<slug> ile taşınır. Nav linkleri bunu KORUMALIDIR;
  // aksi halde her gezinme param'sız gider ve server tarafı varsayılan (ilk/ana) firmaya
  // düşer — kullanıcı sürekli ana firmaya "geri atılır". Bkz. resolveActiveCompany.
  const companyParam = selectedCompany?.slug ?? selectedCompany?.id ?? null
  const withCompany = useCallback(
    (href: string) => withCompanyHref(href, companyParam),
    [companyParam]
  )
  /** Grup başlığı -> kapalıysa true (varsayılan: tüm gruplar kapalı) */
  const [navGroupClosed, setNavGroupClosed] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(navGroups.map((g) => [g.title, true]))
  )

  // Role VE kısıtlı çalışan iznine göre filtrelenmiş menü öğeleri.
  // `visibleHrefs` zaten rol matrisinin izin listesiyle kesişimi (lib/page-access.ts),
  // yani rol kontrolü burada ikinci kez yapılmaz.
  const eDonusumEnabled = Boolean(selectedCompany?.isEDonusumEnabled)
  const denemeAcik = selectedCompany?.isFisTaramaEnabled === true

  const navItems = useMemo(() => {
    const visible = new Set(visibleHrefs)
    return allNavItems.filter((item) => {
      // e-Dönüşüm AYRI bir eksendir: modül değil, firma bayrağı. Buradaki kontrol
      // eskiden yalnız "/e-donusum" href'ine bakıyordu ve o href NAV_PAGES'te YOK —
      // yani hiçbir zaman bir şey elemiyordu. Gerçek sayfalar (/ayarlar/e-donusum,
      // /e-donusum/seri-no, /e-donusum/sablon, /e-donusum/kontor) e-Dönüşüm
      // kapalıyken de menüde duruyordu. Liste artık tek kaynaktan geliyor.
      if (!eDonusumEnabled && E_DONUSUM_PAGES.includes(item.href)) return false
      // Deneme sayfası: bayrak AÇIKÇA true değilse gizli (firma seçilmemişken de).
      if (DENEME_PAGES.includes(item.href) && !denemeAcik) return false
      return visible.has(item.href)
    })
  }, [denemeAcik, eDonusumEnabled, visibleHrefs])

  // Firma için kapalı modüllerin nav gruplarını gizle.
  //
  // `disabledModules` bir RED listesi olduğu için "bilgi yok" hâli tehlikeli: boş küme
  // "hepsi açık" demektir. Seçili firma YOKKEN (henüz firma açmamış kullanıcı, ya da
  // seçim çözülmeden önceki ilk render) bu, satın alınmamış modüllerin menüde
  // görünmesine yol açıyordu — hiç firması olmayan kullanıcı VIEWER'a düşüp yalnız
  // "Raporlar" grubunu görüyordu. Bilgi yoksa HİÇBİR modül açık sayılmaz (fail closed).
  const disabledModules = useMemo(
    () => new Set(selectedCompany ? selectedCompany.disabledModules ?? [] : MODULE_KEYS),
    [selectedCompany]
  )

  const groupedItems = useMemo(
    () =>
      navGroups
        .filter((group) => {
          const moduleKey = MODULE_GROUP_TO_KEY[group.title]
          return !(moduleKey && disabledModules.has(moduleKey))
        })
        .map((group) => ({
          ...group,
          items: group.hrefs
            .map((href) => navItems.find((item) => item.href === href))
            .filter((item): item is NavItemDef => Boolean(item))
            // Öğe kendi modülünü belirtmişse (grubundan bağımsız) o modül kapalıyken
            // düşer. Örn. Stok grubundaki "Reçeteler" yalnızca Restoran & Kafe açıkken
            // görünür. Modül belirtmeyen öğeler grubun kararına tabidir.
            .filter((item) => !(item.module && disabledModules.has(item.module))),
        }))
        .filter((group) => group.items.length > 0),
    [navItems, disabledModules]
  )

  const standaloneItems = useMemo(
    () =>
      standaloneNavHrefs
        .map((href) => navItems.find((item) => item.href === href))
        .filter((item): item is NavItemDef => Boolean(item))
        // Düz linkler grup süzgecinden GEÇMİYOR — grupları elemek onları elemez.
        // "Kontör" bu yüzden e-Dönüşüm kapalıyken menüde kalıyordu (o kısım artık
        // navItems'ta çözülüyor); modül bağı olan bir öğe eklenirse de burada düşsün.
        .filter((item) => {
          const moduleKey = item.module ?? moduleKeyForPath(item.href)
          return !(moduleKey && disabledModules.has(moduleKey))
        }),
    [navItems, disabledModules]
  )

  useEffect(() => {
    setNavGroupClosed(() => {
      const next: Record<string, boolean> = {}
      for (const group of groupedItems) {
        const hasActive = group.items.some((item) => navItemActive(pathname, item.href, searchParams))
        next[group.title] = !hasActive
      }
      return next
    })
  }, [pathname, groupedItems, searchParams])

  useEffect(() => {
    setPendingHref(null)
  }, [pathname])

  const startNav = useCallback(
    (href: string) => {
      // Zaten bulunulan sayfaya tıklanırsa gezinme olmaz; pathname
      // değişmediği için yükleniyor spinner'ı temizlenmez. Bu yüzden
      // aynı route için spinner'ı hiç başlatma.
      if (href !== pathname) {
        setPendingHref(href)
      }
    },
    [pathname]
  )

  const isGroupOpen = useCallback(
    (title: string) => navGroupClosed[title] !== true,
    [navGroupClosed]
  )

  const toggleGroup = (title: string) => {
    setNavGroupClosed((prev) => {
      const group = groupedItems.find((g) => g.title === title)
      if (!group) return prev

      const isOpen = prev[title] !== true
      if (isOpen) {
        return { ...prev, [title]: true }
      }
      const next: Record<string, boolean> = {}
      for (const g of groupedItems) {
        next[g.title] = g.title === title ? false : true
      }
      return next
    })
  }

  return (
    <>
      <div
        className={cn(
          "fixed left-0 top-0 z-40 hidden h-dvh max-h-dvh w-56 flex-col overflow-hidden border-r border-white/10 bg-kobipo-navy dark:border-border dark:bg-card",
          collapsed ? "lg:hidden" : "lg:flex"
        )}
      >
        <div className="flex h-14 shrink-0 items-center border-b border-white/10 px-4">
          <Link href={withCompany(landingPath)} className="inline-flex shrink-0 items-center">
            <KobipoLogoMark className="h-12 w-auto" />
          </Link>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain p-3 [-webkit-overflow-scrolling:touch]">
          <div className="space-y-1">
            {groupedItems.map((group) => (
              <div key={group.title} className="rounded-lg border border-white/10 bg-white/[0.04]">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.title)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-white/70 hover:bg-white/[0.06] hover:text-white"
                >
                  {group.title}
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 text-white/50 transition-transform duration-200",
                      isGroupOpen(group.title) ? "rotate-0" : "-rotate-90"
                    )}
                  />
                </button>
                {isGroupOpen(group.title) && (
                  <div className="space-y-0.5 border-t border-white/10 px-1.5 py-2">
                    {group.items.map((item: any) => {
                      const Icon = item.icon
                      const isActive = navItemActive(pathname, item.href, searchParams)

                      return (
                        <Link
                          key={item.href}
                          href={withCompany(item.href)}
                          onClick={() => startNav(item.href)}
                          className={cn(
                            "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                            pendingHref === item.href && "opacity-80",
                            isActive
                              ? "bg-kobipo-blue font-semibold text-white"
                              : "font-medium text-white/55 hover:bg-white/[0.08] hover:text-white"
                          )}
                        >
                          {pendingHref === item.href ? (
                            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                          ) : (
                            <Icon className="h-4 w-4 shrink-0" />
                          )}
                          {item.label}
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}
            {standaloneItems.length > 0 && (
              <div className="mt-2 space-y-0.5 border-t border-white/10 pt-3">
                {standaloneItems.map((item) => {
                  const Icon = item.icon
                  const isActive = navItemActive(pathname, item.href, searchParams)
                  return (
                    <Link
                      key={item.href}
                      href={withCompany(item.href)}
                      onClick={() => startNav(item.href)}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                        pendingHref === item.href && "opacity-80",
                        isActive
                          ? "bg-kobipo-blue font-semibold text-white"
                          : "font-medium text-white/70 hover:bg-white/[0.08] hover:text-white"
                      )}
                    >
                      {pendingHref === item.href ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                      ) : (
                        <Icon className="h-4 w-4 shrink-0" />
                      )}
                      {item.label}
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <nav className="fixed left-0 right-0 top-0 z-40 h-14 border-b border-white/10 bg-kobipo-navy dark:border-border dark:bg-card lg:hidden">
        <div className="flex h-14 items-center justify-between px-4">
          <Link href={withCompany(landingPath)} className="inline-flex shrink-0 items-center">
            <KobipoLogoMark className="h-11 w-auto" />
          </Link>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileMenuOpen(true)}
            className="text-white hover:bg-white/10 hover:text-white"
          >
            <Menu className="h-5 w-5" />
          </Button>
        </div>
      </nav>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="fixed inset-0 bg-kobipo-navy/40 backdrop-blur-sm dark:bg-black/60" onClick={() => setMobileMenuOpen(false)} />
          <div className="fixed inset-y-0 right-0 flex w-full max-w-xs flex-col bg-white shadow-lg dark:bg-card">
            <div className="flex shrink-0 items-center justify-between border-b border-kobipo-border p-4 dark:border-border">
              <span className="font-semibold text-kobipo-navy dark:text-foreground">Menü</span>
              <Button variant="ghost" size="icon" onClick={() => setMobileMenuOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-y-contain p-4 [-webkit-overflow-scrolling:touch]">
              {groupedItems.map((group) => (
                <div key={`mobile-${group.title}`} className="rounded-lg border border-kobipo-border bg-kobipo-offwhite/80 dark:border-border dark:bg-muted/30">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.title)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-kobipo-gray dark:text-muted-foreground"
                  >
                    {group.title}
                    <ChevronDown
                      className={cn(
                        "h-4 w-4 shrink-0 transition-transform duration-200",
                        isGroupOpen(group.title) ? "rotate-0" : "-rotate-90"
                      )}
                    />
                  </button>
                  {isGroupOpen(group.title) && (
                    <div className="space-y-0.5 border-t border-kobipo-border px-1 py-2 dark:border-border">
                      {group.items.map((item: any) => {
                        const Icon = item.icon
                        const isActive = navItemActive(pathname, item.href, searchParams)

                        return (
                          <Link
                            key={item.href}
                            href={withCompany(item.href)}
                            onClick={() => {
                              startNav(item.href)
                              setMobileMenuOpen(false)
                            }}
                            className={cn(
                              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                              pendingHref === item.href && "opacity-80",
                              isActive
                                ? "bg-kobipo-pale font-semibold text-kobipo-blue dark:bg-primary/15 dark:text-primary"
                                : "font-medium text-kobipo-gray hover:bg-kobipo-pale hover:text-kobipo-blue dark:text-muted-foreground dark:hover:bg-muted/40 dark:hover:text-foreground"
                            )}
                          >
                            {pendingHref === item.href ? (
                              <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
                            ) : (
                              <Icon className="h-5 w-5 shrink-0" />
                            )}
                            {item.label}
                          </Link>
                        )
                      })}
                    </div>
                  )}
                </div>
              ))}
              {standaloneItems.length > 0 && (
                <div className="border-t border-kobipo-border pt-2 space-y-0.5 dark:border-border">
                  {standaloneItems.map((item) => {
                    const Icon = item.icon
                    const isActive = navItemActive(pathname, item.href, searchParams)
                    return (
                      <Link
                        key={item.href}
                        href={withCompany(item.href)}
                        onClick={() => {
                          startNav(item.href)
                          setMobileMenuOpen(false)
                        }}
                        className={cn(
                          "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                          pendingHref === item.href && "opacity-80",
                          isActive
                            ? "bg-kobipo-pale font-semibold text-kobipo-blue dark:bg-primary/15 dark:text-primary"
                            : "font-medium text-kobipo-gray hover:bg-kobipo-pale hover:text-kobipo-blue dark:text-muted-foreground dark:hover:bg-muted/40 dark:hover:text-foreground"
                        )}
                      >
                        {pendingHref === item.href ? (
                          <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
                        ) : (
                          <Icon className="h-5 w-5 shrink-0" />
                        )}
                        {item.label}
                      </Link>
                    )
                  })}
                </div>
              )}
              <div className="border-t border-kobipo-border pt-4 dark:border-border">
                <Button
                  variant="ghost"
                  className="w-full justify-start text-red-600 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                  onClick={() => signOut({ callbackUrl: "/signin" })}
                >
                  <LogOut className="h-5 w-5 mr-3" />
                  Çıkış Yap
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
