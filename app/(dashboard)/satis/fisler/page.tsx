"use client"

import FislerListing from "@/components/fisler/fisler-listing"

export default function SatisFislerPage() {
  return (
    <FislerListing
      direction="outgoing"
      pageTitle="Satış Fişleri"
      pageDescription="Hızlı satıştan kesilen fişler. Birden fazlasını seçip tek faturaya dönüştürebilirsiniz."
    />
  )
}
