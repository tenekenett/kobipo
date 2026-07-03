import type { BlogPost } from "@/lib/content/blog"
import { siteConfig, absoluteUrl } from "./site-config"

type JsonLd = Record<string, unknown>

export function organizationJsonLd(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: siteConfig.name,
    legalName: siteConfig.organization.legalName,
    url: siteConfig.url,
    logo: absoluteUrl(siteConfig.logo),
    email: siteConfig.organization.email,
    slogan: siteConfig.tagline,
    description: siteConfig.description,
    ...(siteConfig.organization.sameAs.length ? { sameAs: siteConfig.organization.sameAs } : {}),
  }
}

export function websiteJsonLd(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: siteConfig.name,
    url: siteConfig.url,
    inLanguage: siteConfig.language,
    publisher: { "@type": "Organization", name: siteConfig.name },
  }
}

export function articleJsonLd(post: BlogPost, path: string): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.excerpt,
    articleSection: post.category,
    inLanguage: siteConfig.language,
    datePublished: post.isoDate,
    dateModified: post.isoDate,
    author: { "@type": "Person", name: post.author },
    publisher: {
      "@type": "Organization",
      name: siteConfig.name,
      logo: { "@type": "ImageObject", url: absoluteUrl(siteConfig.logo) },
    },
    image: absoluteUrl(post.coverImageUrl ?? siteConfig.ogImage.url),
    mainEntityOfPage: { "@type": "WebPage", "@id": absoluteUrl(path) },
  }
}

export function breadcrumbJsonLd(items: { label: string; href?: string }[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.label,
      ...(item.href ? { item: absoluteUrl(item.href) } : {}),
    })),
  }
}

export function faqJsonLd(items: { q: string; a: string }[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  }
}
