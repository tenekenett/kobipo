"use client"

import FislerListing from "@/components/fisler/fisler-listing"

export default function AlisFislerPage() {
  return (
    <FislerListing
      direction="incoming"
      pageTitle="Alış Fişleri"
      pageDescription="Hızlı alıştan kesilen fişler. Birden fazlasını seçip tek faturaya dönüştürebilirsiniz."
    />
  )
}
