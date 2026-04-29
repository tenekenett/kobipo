"use client"

import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useEffect } from "react"
import { CariEntityFormPage } from "@/components/cari/cari-entity-form-page"

export default function EditCariEntityPage() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()

  const type = params.type as string
  const id = params.id as string
  const companyId = searchParams.get("company")

  const isValidType = type === "customers" || type === "suppliers"

  useEffect(() => {
    if (!isValidType) {
      const back = companyId ? `/cari?company=${companyId}` : "/cari"
      router.replace(back)
    }
  }, [companyId, isValidType, router])

  if (!isValidType) return null

  return <CariEntityFormPage entityType={type} mode="edit" entityId={id} />
}
