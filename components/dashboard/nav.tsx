"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/cari", label: "Cari Hesaplar" },
  { href: "/dashboard/stok", label: "Stok" },
  { href: "/dashboard/finans", label: "Finans" },
  { href: "/dashboard/e-donusum", label: "E-Dönüşüm" },
  { href: "/dashboard/raporlar", label: "Raporlar" },
]

export function DashboardNav() {
  const pathname = usePathname()

  return (
    <nav className="border-b bg-card">
      <div className="container mx-auto flex h-16 flex-col items-center justify-between gap-2 px-4 py-2 md:flex-row md:gap-0">
        <div className="flex w-full items-center justify-between md:w-auto md:space-x-6">
          <Link href="/dashboard" className="text-xl font-bold">
            Ön Muhasebe
          </Link>
          <Button
            variant="ghost"
            size="sm"
            className="md:hidden"
            onClick={() => signOut({ callbackUrl: "/auth/signin" })}
          >
            Çıkış
          </Button>
        </div>
        <div className="flex w-full flex-wrap items-center gap-1 overflow-x-auto md:w-auto md:space-x-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "whitespace-nowrap px-2 py-1 text-xs font-medium transition-colors hover:text-primary md:px-3 md:py-2 md:text-sm",
                pathname === item.href
                  ? "text-primary border-b-2 border-primary"
                  : "text-muted-foreground"
              )}
            >
              {item.label}
            </Link>
          ))}
        </div>
        <Button
          variant="ghost"
          className="hidden md:block"
          onClick={() => signOut({ callbackUrl: "/auth/signin" })}
        >
          Çıkış
        </Button>
      </div>
    </nav>
  )
}

