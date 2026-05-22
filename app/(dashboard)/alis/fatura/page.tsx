"use client"

import FaturalarListing from "@/components/faturalar/faturalar-listing"

export default function AlisFaturaPage() {
  return (
    <FaturalarListing
      fixedDirection="incoming"
      includeInbox={false}
      pageTitle="Alış Faturaları"
      pageDescription="İçe aktarılmış ve manuel girilmiş alış faturalarınız"
    />
  )
}
