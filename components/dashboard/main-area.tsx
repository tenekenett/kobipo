"use client"

import { cn } from "@/lib/utils"
import { useSidebar } from "@/components/dashboard/sidebar-provider"

/**
 * Sağ içerik alanı. Sol menü daraltıldığında (collapsed) masaüstünde sol
 * boşluğu (lg:pl-56 → lg:pl-0) kaldırarak içerik tam genişliğe yayılır.
 */
export function MainArea({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar()
  return (
    <div
      className={cn(
        "min-w-0 pt-14 transition-[padding] duration-200 ease-in-out lg:pt-0",
        collapsed ? "lg:pl-0" : "lg:pl-56"
      )}
    >
      <div className="min-h-screen flex-1 bg-kobipo-offwhite dark:bg-background">
        {children}
      </div>
    </div>
  )
}
