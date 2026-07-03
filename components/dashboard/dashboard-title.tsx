"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"
import { resolvePageTitle } from "@/lib/dashboard/page-titles"
import { siteConfig } from "@/lib/seo/site-config"

/**
 * Panel sayfalarına anlamlı tarayıcı sekme başlığı verir. Dashboard sayfalarının
 * çoğu Client Component olduğu için `metadata` export edilemiyor; bu yüzden başlık
 * pathname'e göre istemcide `document.title` üzerinden ayarlanır. Panel zaten
 * `robots: noindex` olduğundan SSR başlığına gerek yok — amaç sekme/geçmiş/yer imi
 * ve erişilebilirlik için okunabilir başlıktır. Layout'a bir kez mount edilir.
 */
export function DashboardTitle() {
  const pathname = usePathname()

  useEffect(() => {
    const base = resolvePageTitle(pathname)
    document.title = base
      ? siteConfig.titleTemplate.replace("%s", base)
      : siteConfig.title
  }, [pathname])

  return null
}
