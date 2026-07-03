import type { MetadataRoute } from "next"
import { siteConfig } from "@/lib/seo/site-config"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kobipo — KOBİ Muhasebe ve İşletme Yönetimi",
    short_name: siteConfig.name,
    description: siteConfig.description,
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0c3b6b",
    lang: "tr",
    icons: [
      { src: "/assets/icons/kobipo-favicon-32.png", sizes: "32x32", type: "image/png" },
      { src: "/assets/icons/kobipo-ikon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/assets/icons/kobipo-ikon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
