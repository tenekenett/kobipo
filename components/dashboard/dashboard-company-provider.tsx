"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"

export type DashboardCompany = { id: string; name: string }

type DashboardCompanyContextValue = {
  companies: DashboardCompany[]
  selectedCompanyId: string | null
  selectedCompany: DashboardCompany | null
  isLoading: boolean
  fetchCompanies: () => Promise<void>
  handleCompanyChange: (companyId: string) => void
}

const DashboardCompanyContext = createContext<DashboardCompanyContextValue | null>(null)

export function DashboardCompanyProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [companies, setCompanies] = useState<DashboardCompany[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const fetchCompanies = useCallback(async () => {
    try {
      const response = await fetch("/api/companies")
      if (response.ok) {
        const data = await response.json()
        setCompanies(data)
      }
    } catch (error) {
      console.error("Error fetching companies:", error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCompanies()
  }, [fetchCompanies])

  useEffect(() => {
    const companyId = searchParams.get("company")
    if (companyId) {
      setSelectedCompanyId(companyId)
      localStorage.setItem("selectedCompanyId", companyId)
    } else {
      const stored = localStorage.getItem("selectedCompanyId")
      if (stored) {
        setSelectedCompanyId(stored)
        router.replace(`?company=${stored}`)
      }
    }
  }, [searchParams, router])

  const handleCompanyChange = useCallback(
    (companyId: string) => {
      setSelectedCompanyId(companyId)
      localStorage.setItem("selectedCompanyId", companyId)
      router.push(`?company=${companyId}`)
    },
    [router]
  )

  const selectedCompany = useMemo(
    () => companies.find((c) => c.id === selectedCompanyId) ?? null,
    [companies, selectedCompanyId]
  )

  const value = useMemo(
    () => ({
      companies,
      selectedCompanyId,
      selectedCompany,
      isLoading,
      fetchCompanies,
      handleCompanyChange,
    }),
    [companies, selectedCompanyId, selectedCompany, isLoading, fetchCompanies, handleCompanyChange]
  )

  return <DashboardCompanyContext.Provider value={value}>{children}</DashboardCompanyContext.Provider>
}

export function useDashboardCompany() {
  const ctx = useContext(DashboardCompanyContext)
  if (!ctx) {
    throw new Error("useDashboardCompany must be used within DashboardCompanyProvider")
  }
  return ctx
}
