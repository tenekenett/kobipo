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
  Building2,
  Receipt,
  FileCheck,
  Warehouse,
  BookOpen,
  Settings,
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
    href: "/", 
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

interface NavItemsProps {
  userRole: string
}

export function DashboardNav() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [userRole, setUserRole] = useState<string>("VIEWER")

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
    }
  }, [session])

  // Role göre filtrelenmiş menü öğeleri
  const navItems = allNavItems.filter(item => item.roles.includes(userRole))

  return (
    <>
      <nav className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          {/* Logo */}
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-emerald-500 to-cyan-500 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">M</span>
              </div>
              <span className="font-bold text-lg hidden sm:block">Muhasebe</span>
            </Link>

            {/* Desktop Navigation */}
            <div className="hidden lg:flex items-center gap-1">
              {navItems.map((item) => {
                const Icon = item.icon
                const isActive = pathname === item.href || 
                  (item.href !== "/" && pathname.startsWith(item.href)) ||
                  (item.href === "/muhasebe/yevmiye" && pathname.startsWith("/muhasebe"))
                
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                )
              })}
            </div>
          </div>

          {/* Right Side */}
          <div className="flex items-center gap-2">
            {/* Role Badge */}
            <span className={cn(
              "hidden sm:inline-flex px-2 py-1 rounded-full text-xs font-medium",
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

            {/* User Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-2">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center text-white font-medium text-sm">
                    {session?.user?.name?.charAt(0) || session?.user?.email?.charAt(0) || "U"}
                  </div>
                  <ChevronDown className="h-4 w-4 hidden sm:block" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div>
                    <p className="font-medium">{session?.user?.name || "Kullanıcı"}</p>
                    <p className="text-xs text-muted-foreground">{session?.user?.email}</p>
                  </div>
                </DropdownMenuLabel>
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
                  <LogOut className="h-4 w-4 mr-2" />
                  Çıkış Yap
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Mobile Menu Button */}
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setMobileMenuOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
          </div>
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
                  (item.href !== "/" && pathname.startsWith(item.href)) ||
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
