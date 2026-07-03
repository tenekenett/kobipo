import type { Metadata } from "next"
import HomeContent from "@/components/site/home-content"
import { homeFaqs } from "@/lib/content/home-faqs"
import { JsonLd } from "@/components/seo/json-ld"
import { organizationJsonLd, websiteJsonLd, faqJsonLd } from "@/lib/seo/structured-data"
import { pageMetadata } from "@/lib/seo/metadata"
import { siteConfig } from "@/lib/seo/site-config"

export const metadata: Metadata = {
  ...pageMetadata({ path: "/" }),
  // Ana sayfa başlığı template ("%s | Kobipo") olmadan tam marka başlığını kullanır.
  title: { absolute: siteConfig.title },
}

export default function Page() {
  return (
    <>
      <JsonLd data={[organizationJsonLd(), websiteJsonLd(), faqJsonLd(homeFaqs)]} />
      <HomeContent />
    </>
  )
}
