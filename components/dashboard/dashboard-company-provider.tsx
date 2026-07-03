"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  companySlugForId,
  findCompanyByParam,
  getFirstAccessibleCompanyId,
  withCompanyQuery,
} from "@/lib/company/client-selection"

export type DashboardCompany = {
  id: string
  slug?: string
  name: string
  isEDonusumEnabled?: boolean
  disabledModules?: string[]
  // Üyelik değil; parent-admin erişimiyle gelen alt şube. Üst seçicide gizlenir.
  isBranch?: boolean
  parentName?: string | null
}

type DashboardCompanyContextValue = {
  companies: DashboardCompany[]
  selectedCompanyId: string | null
  selectedCompany: DashboardCompany | null
  userRole: string
  isLoading: boolean
  fetchCompanies: () => Promise<void>
  handleCompanyChange: (companyId: string) => void
}

const DashboardCompanyContext = createContext<DashboardCompanyContextValue | null>(null)

type DashboardCompanyProviderProps = {
  children: React.ReactNode
  initialCompanies?: DashboardCompany[]
  initialRole?: string
}

export function DashboardCompanyProvider({
  children,
  initialCompanies = [],
  initialRole = "VIEWER",
}: DashboardCompanyProviderProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [companies, setCompanies] = useState<DashboardCompany[]>(initialCompanies)
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const [userRole, setUserRole] = useState(initialRole)
  const [isLoading, setIsLoading] = useState(initialCompanies.length === 0)

  const pushCompanyToUrl = useCallback(
    (companyId: string) => {
      router.replace(withCompanyQuery(searchParams.toString(), companySlugForId(companies, companyId)))
    },
    [router, searchParams, companies]
  )

  useEffect(() => {
    setCompanies(initialCompanies)
    setUserRole(initialRole)
    setIsLoading(initialCompanies.length === 0)
  }, [initialCompanies, initialRole])

  const fetchCompanies = useCallback(async () => {
    try {
      const companiesResponse = await fetch("/api/companies", { cache: "no-store" })
      if (companiesResponse.ok) {
        const companiesData = await companiesResponse.json()
        setCompanies(companiesData)
      }
    } catch (error) {
      console.error("Error fetching companies:", error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (initialCompanies.length === 0) {
      fetchCompanies()
    }
  }, [fetchCompanies, initialCompanies.length])

  useEffect(() => {
    const raw = searchParams.get("company")
    if (raw) {
      // URL slug VEYA cuid taşıyabilir → içeride her zaman cuid tut.
      const match = findCompanyByParam(companies, raw)
      const resolvedId = match?.id ?? raw
      setSelectedCompanyId(resolvedId)
      localStorage.setItem("selectedCompanyId", resolvedId)
      // Eski cuid URL'i okunabilir slug'a sessizce yükselt.
      if (match?.slug && match.slug !== raw) {
        router.replace(withCompanyQuery(searchParams.toString(), match.slug))
      }
    } else {
      const stored = localStorage.getItem("selectedCompanyId")
      if (stored) {
        setSelectedCompanyId(stored)
        pushCompanyToUrl(stored)
      }
    }
  }, [searchParams, companies, router, pushCompanyToUrl])

  useEffect(() => {
    if (companies.length === 0) return

    // selectedCompanyId slug de olabilir (companies yüklenmeden set edildiyse) → cuid'e düzelt.
    const match = findCompanyByParam(companies, selectedCompanyId)
    if (match) {
      if (match.id !== selectedCompanyId) {
        setSelectedCompanyId(match.id)
        localStorage.setItem("selectedCompanyId", match.id)
      }
      return
    }

    const firstCompanyId = getFirstAccessibleCompanyId(companies)
    if (!firstCompanyId) return

    setSelectedCompanyId(firstCompanyId)
    localStorage.setItem("selectedCompanyId", firstCompanyId)
    pushCompanyToUrl(firstCompanyId)
  }, [companies, selectedCompanyId, pushCompanyToUrl])

  const handleCompanyChange = useCallback(
    (companyId: string) => {
      setSelectedCompanyId(companyId)
      localStorage.setItem("selectedCompanyId", companyId)
      router.push(withCompanyQuery(searchParams.toString(), companySlugForId(companies, companyId)))
    },
    [router, searchParams, companies]
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
      userRole,
      isLoading,
      fetchCompanies,
      handleCompanyChange,
    }),
    [companies, selectedCompanyId, selectedCompany, userRole, isLoading, fetchCompanies, handleCompanyChange]
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
