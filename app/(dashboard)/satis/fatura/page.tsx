"use client"

import FaturalarListing from "@/components/faturalar/faturalar-listing"

export default function SatisFaturaPage() {
  return (
    <FaturalarListing
      fixedDirection="outgoing"
      pageTitle="Satış Faturaları"
      pageDescription="Müşterilere düzenlenen tüm giden faturalarınız"
    />
  )
}
