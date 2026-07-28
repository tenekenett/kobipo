"use client"

import { Building2, ArrowLeft } from "lucide-react"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"

/**
 * Parent admin bir alt şubeye "girdiğinde" (selectedCompany.isBranch) üstte uyarı
 * gösterir ve ana firmaya dönmesini sağlar. Şubeler üst firma seçicide listelenmediği
 * (Model 2) için kullanıcının hangi bağlamda olduğunu net biçimde belirtir.
 */
export function BranchContextBanner() {
  const { companies, selectedCompany, handleCompanyChange } = useDashboardCompany()

  if (!selectedCompany?.isBranch) return null

  // Şubenin GERÇEK ana firması. Önceden "listedeki ilk ana firma" alınıyordu; birden
  // fazla ana firması olan kullanıcıda "Ana firmaya dön" alakasız bir firmaya
  // götürüyordu (şube TEST Ana Firma'nınken kullanıcı reypo'ya düşüyordu).
  const mainCompany =
    companies.find((c) => !c.isBranch && c.id === selectedCompany.parentCompanyId) ??
    companies.find((c) => !c.isBranch)

  return (
    <div className="mb-4 flex flex-col gap-2 rounded-lg border border-teal-300 bg-teal-50 p-3 text-sm dark:border-teal-900/50 dark:bg-teal-950/30 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 text-teal-800 dark:text-teal-200">
        <Building2 className="h-4 w-4 shrink-0" />
        <span>
          Şu an <strong>{selectedCompany.name}</strong>
          {selectedCompany.parentName ? ` (${selectedCompany.parentName})` : ""} şubesinin
          panelindesiniz.
        </span>
      </div>
      {mainCompany && (
        <button
          type="button"
          onClick={() => handleCompanyChange(mainCompany.id)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-teal-300 bg-white px-3 py-1.5 text-xs font-semibold text-teal-800 transition hover:bg-teal-100 dark:border-teal-800 dark:bg-transparent dark:text-teal-200 dark:hover:bg-teal-900/40"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Ana firmaya dön
        </button>
      )}
    </div>
  )
}
