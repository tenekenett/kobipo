"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { signOut, useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { Bell, Building2, Check, ChevronDown, Laptop, LogOut, Moon, Search, Settings, Sun, User } from "lucide-react"
import { allNavItems } from "@/components/dashboard/nav-config"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { useTheme } from "@/components/providers/theme-provider"

export function DashboardHeader() {
  const searchParams = useSearchParams()
  const { data: session } = useSession()
  const { selectedCompany, isLoading: companyLoading, userRole } = useDashboardCompany()
  const { theme, resolvedTheme, setTheme } = useTheme()
  const [notifCount, setNotifCount] = useState(0)
  const [globalQuery, setGlobalQuery] = useState("")
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    const companyId = selectedCompany?.id
    if (!companyId) return

    let cancelled = false
    let lastFetchedAt = 0
    const POLL_INTERVAL_MS = 5 * 60 * 1000
    const MIN_REFETCH_GAP_MS = 30 * 1000

    const fetchNotifications = async (force = false) => {
      if (cancelled) return
      if (document.visibilityState !== "visible") return
      const now = Date.now()
      if (!force && now - lastFetchedAt < MIN_REFETCH_GAP_MS) return
      lastFetchedAt = now
      try {
        const response = await fetch(`/api/notifications?companyId=${companyId}&mode=count`, {
          cache: "no-store",
        })
        if (!response.ok || cancelled) return
        const data = await response.json()
        if (!cancelled) {
          setNotifCount(Number(data?.unreadCount || 0))
        }
      } catch {
        // network errors: silently retry on next interval/visibility
      }
    }

    fetchNotifications(true)
    const interval = setInterval(() => fetchNotifications(false), POLL_INTERVAL_MS)
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchNotifications(false)
      }
    }
    document.addEventListener("visibilitychange", onVisibility)

    return () => {
      cancelled = true
      clearInterval(interval)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [selectedCompany?.id])

  const dashboardHref =
    searchParams.size > 0 ? `/dashboard?${searchParams.toString()}` : "/dashboard"

  const triggerSearchPrompt = () => {
    const input = window.prompt("Menüde ara", globalQuery)
    if (input === null) return
    setGlobalQuery(input)
    const query = input.trim().toLowerCase()
    if (!query) return
    const found = allNavItems.find((item) => item.label.toLowerCase().includes(query))
    if (found) window.location.href = found.href + window.location.search
  }

  const themeOptions: Array<{ value: "light" | "dark" | "system"; label: string; icon: typeof Sun }> = [
    { value: "light", label: "Aydınlık", icon: Sun },
    { value: "dark", label: "Karanlık", icon: Moon },
    { value: "system", label: "Sistem", icon: Laptop },
  ]

  const userName = session?.user?.name || "Kullanıcı"
  const userInitials = userName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("") || "K"

  const roleLabel =
    userRole === "ADMIN" ? "Yönetici" :
    userRole === "ACCOUNTANT" ? "Muhasebeci" :
    userRole === "STOCK" ? "Stokçu" :
    userRole === "SALES" ? "Satış" :
    "Görüntüleyici"

  const roleBadgeClass =
    userRole === "ADMIN" ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300" :
    userRole === "ACCOUNTANT" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" :
    userRole === "STOCK" ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300" :
    userRole === "SALES" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" :
    "bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300"

  return (
    <header className="flex min-h-14 shrink-0 items-center gap-3 border-b border-kobipo-border bg-white px-4 dark:border-border dark:bg-card sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="min-w-0 shrink-0 text-base font-bold">
          <Link
            href={dashboardHref}
            className="text-kobipo-navy transition-colors hover:text-kobipo-blue focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kobipo-blue/30 dark:text-foreground dark:hover:text-primary"
          >
            Dashboard
          </Link>
        </h1>
        {!companyLoading && selectedCompany?.name && (
          <span className="hidden min-w-0 items-center gap-1.5 rounded-md border border-kobipo-border bg-kobipo-offwhite px-2 py-1 text-xs dark:border-border dark:bg-muted/40 md:inline-flex">
            <Building2 className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="truncate text-muted-foreground">{selectedCompany.name}</span>
          </span>
        )}
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
        <Button
          variant="outline"
          size="icon"
          type="button"
          className="relative h-9 w-9"
          title="Bildirimler"
        >
          <Bell className="h-4 w-4" />
          {notifCount > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
              {notifCount > 99 ? "99+" : notifCount}
            </span>
          )}
        </Button>
        <Button
          variant="outline"
          size="icon"
          type="button"
          className="h-9 w-9"
          onClick={triggerSearchPrompt}
          title="Menüde ara"
        >
          <Search className="h-4 w-4" />
        </Button>
        {mounted && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-9 w-9" aria-label="Tema">
                {resolvedTheme === "dark" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel>Tema</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {themeOptions.map((opt) => {
                const Icon = opt.icon
                const active = theme === opt.value
                return (
                  <DropdownMenuItem
                    key={opt.value}
                    onClick={() => setTheme(opt.value)}
                    className="flex items-center gap-2"
                  >
                    <Icon className="h-4 w-4" />
                    <span className="flex-1">{opt.label}</span>
                    {active && <Check className="h-3.5 w-3.5 text-primary" />}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {mounted && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="group flex h-9 items-center gap-2 rounded-full border border-kobipo-border bg-white pl-1 pr-2 text-left transition-colors hover:border-kobipo-blue/40 hover:bg-kobipo-pale/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kobipo-blue/30 dark:border-border dark:bg-card dark:hover:border-primary/40 dark:hover:bg-muted/40"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-kobipo-blue text-[11px] font-semibold uppercase text-white dark:bg-primary dark:text-primary-foreground">
                  {userInitials}
                </span>
                <span className="hidden min-w-0 flex-col leading-tight md:flex">
                  <span className="truncate text-xs font-semibold text-kobipo-navy dark:text-foreground">
                    {userName}
                  </span>
                  <span className="truncate text-[10px] text-muted-foreground">{roleLabel}</span>
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <div className="flex items-center gap-2.5 p-2">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-kobipo-blue text-sm font-semibold uppercase text-white dark:bg-primary dark:text-primary-foreground">
                  {userInitials}
                </span>
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-sm font-semibold">{userName}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {session?.user?.email}
                  </span>
                  <span
                    className={cn(
                      "mt-1 inline-flex w-fit rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                      roleBadgeClass
                    )}
                  >
                    {roleLabel}
                  </span>
                </div>
              </div>
              {selectedCompany?.name && (
                <>
                  <DropdownMenuSeparator />
                  <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-muted-foreground">
                    <Building2 className="h-3 w-3 shrink-0" />
                    <span className="truncate">
                      <span className="text-muted-foreground">Aktif:</span>{" "}
                      <span className="font-medium text-foreground">{selectedCompany.name}</span>
                    </span>
                  </div>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/ayarlar/profil" className="flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Profil
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/ayarlar/firma" className="flex items-center gap-2">
                  <Settings className="h-4 w-4" />
                  Firma Ayarları
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => signOut({ callbackUrl: "/signin" })}
                className="text-red-600 focus:text-red-600"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Çıkış Yap
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  )
}
