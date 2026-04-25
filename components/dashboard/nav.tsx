"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut, useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  LayoutDashboard,
  Users,
  Package,
  Wallet,
  FileText,
  BarChart3,
  LogOut,
  Menu,
  X,
  ChevronDown,
  Receipt,
  FileCheck,
  Warehouse,
  BookOpen,
  Settings,
  Bell,
  Moon,
  Sun,
  Search,
} from "lucide-react"
import { useState, useEffect } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

// Tüm menü öğeleri ve erişebilecek roller
const allNavItems = [
  { 
    href: "/dashboard", 
    label: "Dashboard", 
    icon: LayoutDashboard,
    roles: ["ADMIN", "ACCOUNTANT", "STOCK", "SALES", "VIEWER"]
  },
  { 
    href: "/cari", 
    label: "Cari Hesaplar", 
    icon: Users,
    roles: ["ADMIN", "ACCOUNTANT", "SALES"]
  },
  { 
    href: "/stok", 
    label: "Stok", 
    icon: Package,
    roles: ["ADMIN", "STOCK", "SALES"]
  },
  { 
    href: "/finans", 
    label: "Finans", 
    icon: Wallet,
    roles: ["ADMIN", "ACCOUNTANT"]
  },
  { 
    href: "/e-donusum", 
    label: "E-Dönüşüm", 
    icon: FileText,
    roles: ["ADMIN", "ACCOUNTANT", "SALES"]
  },
  { 
    href: "/faturalar", 
    label: "Faturalar", 
    icon: Receipt,
    roles: ["ADMIN", "ACCOUNTANT", "SALES"]
  },
  { 
    href: "/cek-senet", 
    label: "Çek/Senet", 
    icon: FileCheck,
    roles: ["ADMIN", "ACCOUNTANT"]
  },
  { 
    href: "/depolar", 
    label: "Depolar", 
    icon: Warehouse,
    roles: ["ADMIN", "STOCK"]
  },
  { 
    href: "/muhasebe/yevmiye", 
    label: "Muhasebe", 
    icon: BookOpen,
    roles: ["ADMIN", "ACCOUNTANT"]
  },
  { 
    href: "/raporlar", 
    label: "Raporlar", 
    icon: BarChart3,
    roles: ["ADMIN", "ACCOUNTANT", "STOCK", "SALES", "VIEWER"]
  },
  { 
    href: "/finans/hareketler", 
    label: "Finans Hareketleri", 
    icon: Wallet,
    roles: ["ADMIN", "ACCOUNTANT"]
  },
]

export function DashboardNav() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [userRole, setUserRole] = useState<string>("VIEWER")
  const [isDark, setIsDark] = useState(false)
  const [notifCount, setNotifCount] = useState(0)
  const [globalQuery, setGlobalQuery] = useState("")

  // Kullanıcı rolünü al
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
      setNotifCount(list.filter((n: any) => !n.isRead).length)
    })
  }, [pathname])

  const toggleTheme = () => {
    const root = document.documentElement
    root.classList.toggle("dark")
    setIsDark(root.classList.contains("dark"))
  }

  const runGlobalSearch = () => {
    const query = globalQuery.trim().toLowerCase()
    if (!query) return
    const found = allNavItems.find((item) => item.label.toLowerCase().includes(query))
    if (found) {
      window.location.href = found.href + window.location.search
    }
  }

  // Role göre filtrelenmiş menü öğeleri
  const navItems = allNavItems.filter(item => item.roles.includes(userRole))

  return (
    <>
      <div className="fixed left-0 top-0 z-40 hidden h-screen w-72 border-r bg-background lg:flex lg:flex-col">
        <div className="border-b p-4">
          <Link href="/dashboard" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500">
              <span className="text-sm font-bold text-white">M</span>
            </div>
            <div>
              <p className="text-lg font-bold">Muhasebe</p>
              <p className="text-xs text-muted-foreground">Ön Muhasebe Paneli</p>
            </div>
          </Link>
        </div>
        <div className="border-b p-3 space-y-2">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="w-full justify-start">
              <Bell className="mr-2 h-4 w-4" /> Bildirim ({notifCount})
            </Button>
            <Button variant="outline" size="icon" onClick={toggleTheme}>
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </div>
          <div className="flex gap-2">
            <input
              className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              placeholder="Global arama (⌘K)"
              value={globalQuery}
              onChange={(e) => setGlobalQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runGlobalSearch()}
            />
            <Button variant="outline" size="icon" onClick={runGlobalSearch}>
              <Search className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          <div className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon
              const isActive = pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(item.href)) ||
                (item.href === "/muhasebe/yevmiye" && pathname.startsWith("/muhasebe"))

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              )
            })}
          </div>
        </div>

        <div className="border-t p-3">
          <div className="mb-3 rounded-lg bg-muted p-2 text-xs">
            <p className="font-medium text-foreground">{session?.user?.name || "Kullanıcı"}</p>
            <p className="truncate text-muted-foreground">{session?.user?.email}</p>
            <span className={cn(
              "mt-2 inline-flex rounded-full px-2 py-1 text-[11px] font-medium",
              userRole === "ADMIN" && "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
              userRole === "ACCOUNTANT" && "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
              userRole === "STOCK" && "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
              userRole === "SALES" && "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
              userRole === "VIEWER" && "bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-400",
            )}>
              {userRole === "ADMIN" && "Yönetici"}
              {userRole === "ACCOUNTANT" && "Muhasebeci"}
              {userRole === "STOCK" && "Stokçu"}
              {userRole === "SALES" && "Satış"}
              {userRole === "VIEWER" && "Görüntüleyici"}
            </span>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-full justify-between">
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
        </div>
      </div>

      <nav className="fixed left-0 right-0 top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 lg:hidden">
        <div className="flex h-16 items-center justify-between px-4">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-500">
              <span className="text-sm font-bold text-white">M</span>
            </div>
            <span className="text-lg font-bold">Muhasebe</span>
          </Link>
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
          <div className="fixed inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} />
          <div className="fixed inset-y-0 right-0 w-full max-w-xs bg-background shadow-lg">
            <div className="flex items-center justify-between p-4 border-b">
              <span className="font-bold">Menü</span>
              <Button variant="ghost" size="icon" onClick={() => setMobileMenuOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="p-4 space-y-2">
              {navItems.map((item) => {
                const Icon = item.icon
                const isActive = pathname === item.href || 
                  (item.href !== "/dashboard" && pathname.startsWith(item.href)) ||
                  (item.href === "/muhasebe/yevmiye" && pathname.startsWith("/muhasebe"))
                
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    {item.label}
                  </Link>
                )
              })}
              <div className="pt-4 border-t">
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
