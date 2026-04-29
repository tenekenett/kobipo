"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Logo } from "@/components/ui/Logo"
import { cn } from "@/lib/utils"
import { LogOut, Menu, X, ChevronDown, Building2, Loader2 } from "lucide-react"
import { allNavItems, navGroups, navItemActive, type NavItemDef } from "@/components/dashboard/nav-config"
import { NewBranchDialog } from "@/components/dashboard/new-branch-dialog"
import { useState, useEffect, useCallback, useMemo } from "react"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
export function DashboardNav() {
  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [pendingHref, setPendingHref] = useState<string | null>(null)
  const { userRole, selectedCompany } = useDashboardCompany()
  /** Grup başlığı -> kapalıysa true (varsayılan: tüm gruplar kapalı) */
  const [navGroupClosed, setNavGroupClosed] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(navGroups.map((g) => [g.title, true]))
  )

  // Role göre filtrelenmiş menü öğeleri
  const navItems = useMemo(
    () =>
      allNavItems.filter((item) => {
        if (item.href === "/e-donusum" && !selectedCompany?.isEDonusumEnabled) {
          return false
        }
        return item.roles.includes(userRole)
      }),
    [selectedCompany?.isEDonusumEnabled, userRole]
  )

  const groupedItems = useMemo(
    () =>
      navGroups
        .map((group) => ({
          ...group,
          items: group.hrefs
            .map((href) => navItems.find((item) => item.href === href))
            .filter((item): item is NavItemDef => Boolean(item)),
        }))
        .filter((group) => group.items.length > 0),
    [navItems]
  )

  useEffect(() => {
    setNavGroupClosed(() => {
      const next: Record<string, boolean> = {}
      for (const group of groupedItems) {
        const hasActive = group.items.some((item) => navItemActive(pathname, item.href))
        next[group.title] = !hasActive
      }
      return next
    })
  }, [pathname, groupedItems])

  useEffect(() => {
    setPendingHref(null)
  }, [pathname])

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
      <div className="fixed left-0 top-0 z-40 hidden h-dvh max-h-dvh w-56 flex-col overflow-hidden border-r border-white/10 bg-kobipo-navy lg:flex">
        <div className="flex h-14 shrink-0 items-center border-b border-white/10 px-4">
          <Logo variant="dark" size="sm" href="/dashboard" />
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
                      const isActive = navItemActive(pathname, item.href)

                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          onClick={() => setPendingHref(item.href)}
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
                    {group.title === "Ayarlar" && (
                      <NewBranchDialog>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-white/55 transition-colors hover:bg-white/[0.08] hover:text-white"
                        >
                          <Building2 className="h-4 w-4 shrink-0" />
                          Yeni Şube
                        </button>
                      </NewBranchDialog>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <nav className="fixed left-0 right-0 top-0 z-40 h-14 border-b border-kobipo-border bg-white lg:hidden">
        <div className="flex h-14 items-center justify-between px-6">
          <Logo variant="light" size="sm" href="/" />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileMenuOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
        </div>
      </nav>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="fixed inset-0 bg-kobipo-navy/40 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} />
          <div className="fixed inset-y-0 right-0 w-full max-w-xs bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-kobipo-border p-4">
              <span className="font-semibold text-kobipo-navy">Menü</span>
              <Button variant="ghost" size="icon" onClick={() => setMobileMenuOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="space-y-2 overflow-y-auto p-4">
              {groupedItems.map((group) => (
                <div key={`mobile-${group.title}`} className="rounded-lg border border-kobipo-border bg-kobipo-offwhite/80">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.title)}
                    className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-kobipo-gray"
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
                    <div className="space-y-0.5 border-t border-kobipo-border px-1 py-2">
                      {group.items.map((item: any) => {
                        const Icon = item.icon
                        const isActive = navItemActive(pathname, item.href)

                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => {
                              setPendingHref(item.href)
                              setMobileMenuOpen(false)
                            }}
                            className={cn(
                              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                              pendingHref === item.href && "opacity-80",
                              isActive
                                ? "bg-kobipo-pale font-semibold text-kobipo-blue"
                                : "font-medium text-kobipo-gray hover:bg-kobipo-pale hover:text-kobipo-blue"
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
                      {group.title === "Ayarlar" && (
                        <NewBranchDialog>
                          <button
                            type="button"
                            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-kobipo-gray transition-colors hover:bg-kobipo-pale hover:text-kobipo-blue"
                          >
                            <Building2 className="h-5 w-5 shrink-0" />
                            Yeni Şube
                          </button>
                        </NewBranchDialog>
                      )}
                    </div>
                  )}
                </div>
              ))}
              <div className="border-t border-kobipo-border pt-4">
                <Button
                  variant="ghost"
                  className="w-full justify-start text-red-600 hover:text-red-600 hover:bg-red-50"
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
