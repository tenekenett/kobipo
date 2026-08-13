"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Building2, Plus } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { companyDisplayName } from "@/lib/company/display-name"

// Dropdown'da "yeni firma" aksiyonu için sahte değer (gerçek cuid ile çakışmaz).
const NEW_COMPANY = "__new_company__"

export function CompanySelector() {
  const router = useRouter()
  const { companies, selectedCompanyId, selectedCompany, isLoading, handleCompanyChange } =
    useDashboardCompany()
  // Seçim URL/localStorage'dan türer; sağlayıcı `useSearchParams` kullandığı için
  // React ağacı sunucu ile istemcide birebir aynı sarılmıyor ve Radix'in ürettiği
  // id (`aria-controls`) kayarak hydration uyarısı düşürüyordu. Çözüm: SSR ile ilk
  // istemci render'ında AYNI iskeleti bas, gerçek seçiciyi bağlandıktan sonra çiz —
  // böylece karşılaştırılacak bir Select hiç olmuyor.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (isLoading) {
    return (
      <div className="mb-4 h-[52px] w-56 animate-pulse rounded-xl border border-kobipo-border bg-muted/40 dark:border-border" />
    )
  }

  // Şube bağlamındayken seçici gizlenir; bağlam ve çıkış BranchContextBanner'da.
  if (selectedCompany?.isBranch) {
    return null
  }

  // Alt şubeler üst seçicide GÖSTERİLMEZ (yalnızca Şube Yönetimi'nden girilir).
  const mainCompanies = companies.filter((c) => !c.isBranch)
  if (mainCompanies.length <= 1) {
    return null
  }

  // Buraya kadarki kararlar iki tarafta da AYNI veriden (SSR'den gelen firma listesi)
  // çıkar; tek fark Select'in çizilme anı. Tek firmalı kullanıcıda iskelet hiç görünmez,
  // çok firmalıda aynı ölçüde bir kutu olduğu için yer değiştirme (layout shift) olmaz.
  if (!mounted) {
    return (
      <div className="mb-4 h-[52px] w-56 animate-pulse rounded-xl border border-kobipo-border bg-muted/40 dark:border-border" />
    )
  }

  const value = mainCompanies.some((c) => c.id === selectedCompanyId)
    ? selectedCompanyId ?? ""
    : ""

  return (
    <div className="mb-4 inline-flex items-center gap-3 rounded-xl border border-kobipo-border bg-card px-3 py-2 shadow-sm transition-colors hover:border-kobipo-blue/40 dark:border-border">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-kobipo-blue/15 to-kobipo-mid/10 text-kobipo-blue dark:from-primary/20 dark:to-primary/5 dark:text-primary">
        <Building2 className="h-4 w-4" />
      </span>
      <div className="flex min-w-0 flex-col">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-kobipo-gray">
          Aktif Firma
        </span>
        <Select
          value={value}
          onValueChange={(val) => {
            if (val === NEW_COMPANY) {
              router.push("/companies/new")
              return
            }
            handleCompanyChange(val)
          }}
        >
          <SelectTrigger className="h-6 w-auto justify-start gap-1.5 border-0 bg-transparent p-0 text-sm font-bold text-kobipo-navy shadow-none focus:ring-0 focus:ring-offset-0 dark:text-foreground">
            <SelectValue placeholder="Firma seçin" />
          </SelectTrigger>
          <SelectContent className="min-w-[220px]">
            {mainCompanies.map((company) => (
              <SelectItem key={company.id} value={company.id} className="cursor-pointer">
                {/* Ünvanlar şubeler arasında aynı olabildiği için şube ismi parantezde. */}
                {companyDisplayName(company)}
              </SelectItem>
            ))}
            <SelectSeparator />
            <SelectItem
              value={NEW_COMPANY}
              className="cursor-pointer font-semibold text-kobipo-blue focus:text-kobipo-blue dark:text-primary"
            >
              <span className="flex items-center gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                Yeni firma ekle
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
