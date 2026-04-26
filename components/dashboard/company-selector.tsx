"use client"

import { Label } from "@/components/ui/label"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"

export function CompanySelector() {
  const { companies, selectedCompanyId, isLoading, handleCompanyChange } = useDashboardCompany()

  if (isLoading) {
    return (
      <div className="mb-4 flex items-center justify-center rounded-lg border bg-card p-4">
        <div className="text-sm text-muted-foreground">Yükleniyor...</div>
      </div>
    )
  }

  const hasMultipleCompanies = companies.length > 1

  if (!hasMultipleCompanies) {
    return null
  }

  return (
    <div className="mb-4 flex flex-col space-y-2 rounded-lg border bg-card p-4 md:flex-row md:items-center md:space-x-4 md:space-y-0">
      <Label className="text-sm font-medium">Sube:</Label>
      <select
        value={selectedCompanyId || ""}
        onChange={(e) => handleCompanyChange(e.target.value)}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm md:w-auto"
      >
        <option value="">Sube Secin</option>
        {companies.map((company) => (
          <option key={company.id} value={company.id}>
            {company.name}
          </option>
        ))}
      </select>
    </div>
  )
}
