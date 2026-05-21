"use client"

import FaturalarListing from "@/components/faturalar/faturalar-listing"

export default function AlisFaturaPage() {
  return (
    <FaturalarListing
      fixedDirection="incoming"
      pageTitle="Alış Faturaları"
      pageDescription="Tedarikçilerden gelen tüm alış faturalarınız"
    />
  )
}
