"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"
import { cn } from "@/lib/utils"
import {
  Shield,
  LayoutDashboard,
  Building2,
  Users,
  FileText,
  Settings,
  LogOut,
  Menu,
  X,
  Bell,
  Coins,
  LifeBuoy,
  DatabaseBackup,
} from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface SystemAdminNavProps {
  user: {
    name: string | null
    email: string | null
  }
}

const navItems = [
  {
    title: "Dashboard",
    href: "/system-admin",
    icon: LayoutDashboard,
  },
  {
    title: "Firmalar",
    href: "/system-admin/companies",
    icon: Building2,
  },
  {
    title: "Kullanıcılar",
    href: "/system-admin/users",
    icon: Users,
  },
  {
    title: "Kontör",
    href: "/system-admin/kontor",
    icon: Coins,
  },
  {
    title: "Destek",
    href: "/system-admin/destek",
    icon: LifeBuoy,
  },
  {
    title: "Sistem Logları",
    href: "/system-admin/logs",
    icon: FileText,
  },
  {
    title: "Yedekleme",
    href: "/system-admin/backup",
    icon: DatabaseBackup,
  },
  {
    title: "Ayarlar",
    href: "/system-admin/settings",
    icon: Settings,
  },
]

export function SystemAdminNav({ user }: SystemAdminNavProps) {
  const pathname = usePathname()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:fixed lg:inset-y-0 lg:z-50 lg:flex lg:w-72 lg:flex-col">
        <div className="flex grow flex-col gap-y-5 overflow-y-auto bg-slate-900 border-r border-slate-800 px-6 pb-4">
          {/* Logo */}
          <div className="flex h-16 shrink-0 items-center gap-3 border-b border-slate-800">
            <div className="w-10 h-10 bg-gradient-to-br from-red-500 to-orange-500 rounded-xl flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div>
              <span className="font-bold text-white">System Admin</span>
              <p className="text-xs text-slate-500">Yönetim Paneli</p>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex flex-1 flex-col">
            <ul role="list" className="flex flex-1 flex-col gap-y-7">
              <li>
                <ul role="list" className="-mx-2 space-y-1">
                  {navItems.map((item) => {
                    const isActive = pathname === item.href || 
                      (item.href !== "/system-admin" && pathname.startsWith(item.href))
                    
                    return (
                      <li key={item.title}>
                        <Link
                          href={item.href}
                          className={cn(
                            "group flex gap-x-3 rounded-lg p-3 text-sm font-medium leading-6 transition-all",
                            isActive
                              ? "bg-gradient-to-r from-red-500/20 to-orange-500/20 text-white border-l-2 border-red-500"
                              : "text-slate-400 hover:text-white hover:bg-slate-800"
                          )}
                        >
                          <item.icon
                            className={cn(
                              "h-5 w-5 shrink-0",
                              isActive ? "text-red-400" : "text-slate-500 group-hover:text-slate-300"
                            )}
                          />
                          {item.title}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </li>

              {/* User Info */}
              <li className="mt-auto">
                <div className="flex items-center gap-x-4 px-2 py-3 border-t border-slate-800">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center text-white font-medium">
                    {user.name?.charAt(0) || user.email?.charAt(0) || "A"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">
                      {user.name || "Admin"}
                    </p>
                    <p className="text-xs text-slate-500 truncate">
                      {user.email}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => signOut({ callbackUrl: "/" })}
                    className="text-slate-400 hover:text-white hover:bg-slate-800"
                  >
                    <LogOut className="w-4 h-4" />
                  </Button>
                </div>
              </li>
            </ul>
          </nav>
        </div>
      </aside>

      {/* Mobile Header */}
      <div className="sticky top-0 z-40 lg:hidden flex items-center gap-x-6 bg-slate-900 px-4 py-4 shadow-sm border-b border-slate-800">
        <button
          type="button"
          className="-m-2.5 p-2.5 text-slate-400 lg:hidden"
          onClick={() => setMobileMenuOpen(true)}
        >
          <Menu className="h-6 w-6" />
        </button>
        <div className="flex-1 flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-red-500 to-orange-500 rounded-lg flex items-center justify-center">
            <Shield className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-white">System Admin</span>
        </div>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="text-slate-400">
              <Bell className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 bg-slate-900 border-slate-800">
            <DropdownMenuLabel className="text-slate-400">Bildirimler</DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-slate-800" />
            <DropdownMenuItem className="text-slate-300">
              Yeni bildirim yok
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="relative z-50 lg:hidden">
          <div className="fixed inset-0 bg-slate-950/80" onClick={() => setMobileMenuOpen(false)} />
          <div className="fixed inset-y-0 left-0 z-50 w-full overflow-y-auto bg-slate-900 px-6 py-6 sm:max-w-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-gradient-to-br from-red-500 to-orange-500 rounded-lg flex items-center justify-center">
                  <Shield className="w-4 h-4 text-white" />
                </div>
                <span className="font-bold text-white">System Admin</span>
              </div>
              <button
                type="button"
                className="-m-2.5 rounded-md p-2.5 text-slate-400"
                onClick={() => setMobileMenuOpen(false)}
              >
                <X className="h-6 w-6" />
              </button>
            </div>
            <div className="mt-6 flow-root">
              <div className="-my-6 divide-y divide-slate-800">
                <div className="space-y-2 py-6">
                  {navItems.map((item) => {
                    const isActive = pathname === item.href || 
                      (item.href !== "/system-admin" && pathname.startsWith(item.href))
                    
                    return (
                      <Link
                        key={item.title}
                        href={item.href}
                        onClick={() => setMobileMenuOpen(false)}
                        className={cn(
                          "-mx-3 flex items-center gap-3 rounded-lg px-3 py-2.5 text-base font-medium",
                          isActive
                            ? "bg-slate-800 text-white"
                            : "text-slate-400 hover:bg-slate-800 hover:text-white"
                        )}
                      >
                        <item.icon className="h-5 w-5" />
                        {item.title}
                      </Link>
                    )
                  })}
                </div>
                <div className="py-6">
                  <button
                    onClick={() => signOut({ callbackUrl: "/" })}
                    className="-mx-3 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-base font-medium text-red-400 hover:bg-slate-800"
                  >
                    <LogOut className="h-5 w-5" />
                    Çıkış Yap
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

