"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { usePathname, useSearchParams } from "next/navigation"
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
import { Bell, ChevronDown, LogOut, Moon, Search, Settings, Sun } from "lucide-react"
import { allNavItems } from "@/components/dashboard/nav-config"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"

export function DashboardHeader() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { data: session } = useSession()
  const { selectedCompany, isLoading: companyLoading } = useDashboardCompany()
  const [userRole, setUserRole] = useState<string>("VIEWER")
  const [isDark, setIsDark] = useState(false)
  const [notifCount, setNotifCount] = useState(0)
  const [globalQuery, setGlobalQuery] = useState("")

  useEffect(() => {
    async function fetchRole() {
      try {
        const response = await fetch("/api/auth/user-role")
        if (response.ok) {
          const data = await response.json()
          setUserRole(data.role || "VIEWER")
        }
      } catch (error) {
        console.error("Error fetching role:", error)
      }
    }
    if (session) {
      fetchRole()
    }
  }, [session])

  useEffect(() => {
    if (session) {
      setIsDark(document.documentElement.classList.contains("dark"))
    }
  }, [session])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const companyId = params.get("company")
    if (!companyId) return
    fetch(`/api/notifications?companyId=${companyId}`).then(async (res) => {
      if (!res.ok) return
      const list = await res.json()
      setNotifCount(list.filter((n: { isRead?: boolean }) => !n.isRead).length)
    })
  }, [pathname])

  const toggleTheme = () => {
    const root = document.documentElement
    root.classList.toggle("dark")
    setIsDark(root.classList.contains("dark"))
  }

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

  return (
    <header className="flex min-h-14 shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-2 border-b border-kobipo-border bg-white px-4 py-2 sm:px-6 sm:py-0">
      <h1 className="mr-auto min-w-0 text-base font-bold">
        <Link
          href={dashboardHref}
          className="text-kobipo-navy transition-colors hover:text-kobipo-blue focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kobipo-blue/30"
        >
          Dashboard
        </Link>
      </h1>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 sm:gap-3">
        <Button variant="outline" size="sm" type="button" className="gap-1" title="Bildirimler">
          <Bell className="h-4 w-4" />
          <span className="tabular-nums text-sm font-medium">{notifCount}</span>
        </Button>
        <Button variant="outline" size="sm" type="button" className="gap-1 px-2 sm:px-3" onClick={triggerSearchPrompt} title="Menüde ara">
          <Search className="h-4 w-4" />
          <span className="hidden sm:inline">Ara</span>
        </Button>
        <Button variant="outline" size="icon" onClick={toggleTheme} aria-label="Tema">
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>

        <div className="flex w-full flex-col gap-2 border-t border-kobipo-border pt-2 sm:ml-1 sm:w-auto sm:flex-row sm:items-center sm:border-t-0 sm:pt-0 lg:ml-2">
          <div className="rounded-lg border border-kobipo-border bg-kobipo-offwhite/80 p-2 text-xs sm:max-w-[220px]">
            <p className="truncate font-semibold uppercase text-kobipo-navy">{session?.user?.name || "Kullanıcı"}</p>
            <p className="truncate text-muted-foreground">{session?.user?.email}</p>
            <span
              className={cn(
                "mt-2 inline-flex rounded-full px-2 py-1 text-[11px] font-medium",
                userRole === "ADMIN" && "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
                userRole === "ACCOUNTANT" && "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
                userRole === "STOCK" && "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
                userRole === "SALES" && "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
                userRole === "VIEWER" && "bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-400"
              )}
            >
              {userRole === "ADMIN" && "Yönetici"}
              {userRole === "ACCOUNTANT" && "Muhasebeci"}
              {userRole === "STOCK" && "Stokçu"}
              {userRole === "SALES" && "Satış"}
              {userRole === "VIEWER" && "Görüntüleyici"}
            </span>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-full justify-between sm:w-[min(100%,11rem)]">
                Hesap
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Hesap İşlemleri</DropdownMenuLabel>
              <DropdownMenuSeparator />
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
          <p className="text-xs text-muted-foreground sm:text-right">
            {companyLoading ? (
              "Firma bilgisi yükleniyor…"
            ) : (
              <>
                Aktif firma/şube:{" "}
                <span className="font-medium text-foreground">{selectedCompany?.name || "—"}</span>
              </>
            )}
          </p>
        </div>
      </div>
    </header>
  )
}
