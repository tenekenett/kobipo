import type { Metadata } from "next"
import { siteConfig, absoluteUrl } from "./site-config"

type OgImage = { url: string; width?: number; height?: number; alt?: string }

type PageMetadataOptions = {
  /** Sayfa başlığı (title template ile "%s | Kobipo" olur). Verilmezse root varsayılanı miras alınır. */
  title?: string
  description?: string
  /** Canonical yol, ör. "/kurumsal/blog". metadataBase ile mutlak hale gelir. */
  path: string
  type?: "website" | "article"
  images?: OgImage[]
  noindex?: boolean
  /** article için: ISO 8601 tarih */
  publishedTime?: string
  authors?: string[]
  section?: string
}

/**
 * Herkese açık sayfalar için tutarlı Metadata üretir: canonical, tam OpenGraph ve
 * Twitter kartı. Root layout'ta metadataBase ayarlı olduğu için göreli yollar mutlaklaşır.
 */
export function pageMetadata(opts: PageMetadataOptions): Metadata {
  const { title, description, path, type = "website", images, noindex, publishedTime, authors, section } = opts
  const desc = description ?? siteConfig.description
  const ogImages = (images ?? [siteConfig.ogImage]).map((img) => ({
    url: absoluteUrl(img.url),
    width: img.width,
    height: img.height,
    alt: img.alt ?? title ?? siteConfig.title,
  }))

  return {
    ...(title ? { title } : {}),
    description: desc,
    alternates: { canonical: path },
    openGraph: {
      type,
      url: absoluteUrl(path),
      siteName: siteConfig.name,
      locale: siteConfig.locale,
      title: title ?? siteConfig.title,
      description: desc,
      images: ogImages,
      ...(type === "article"
        ? {
            ...(publishedTime ? { publishedTime } : {}),
            ...(authors ? { authors } : {}),
            ...(section ? { section } : {}),
          }
        : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: title ?? siteConfig.title,
      description: desc,
      images: ogImages.map((i) => i.url),
    },
    ...(noindex ? { robots: { index: false, follow: false } } : {}),
  }
}
