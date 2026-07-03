import type { MetadataRoute } from "next"
import { siteConfig } from "@/lib/seo/site-config"
import { DARK_ROUTE_PREFIXES } from "@/lib/theme/dark-routes"

// Uygulama (auth-gated) rotaları + auth/admin/api yüzeyleri taranmasın.
const DISALLOW: string[] = [
  ...DARK_ROUTE_PREFIXES,
  "/signin",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/invite",
  "/blog-admin",
  "/system-admin",
  "/pay",
  "/api",
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: DISALLOW,
    },
    sitemap: `${siteConfig.url}/sitemap.xml`,
    host: siteConfig.url,
  }
}
