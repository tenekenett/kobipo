"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  companySlugForId,
  findCompanyByParam,
  getFirstAccessibleCompanyId,
  withCompanyQuery,
} from "@/lib/company/client-selection"
import { canAccessRoute, canEditPage, canViewPage, visiblePages, type PagePermissions } from "@/lib/page-access"

export type DashboardCompany = {
  id: string
  slug?: string
  /** Resmi ünvan. Ayırt edici kısa ad için `branchName` ile birlikte kullanın. */
  name: string
  /** Ünvandan ayrı kısa şube ismi; gösterim için lib/company/display-name.ts. */
  branchName?: string | null
  /** Kullanıcının BU firmadaki rolü (şubede parent-admin'den gelen sanal ADMIN). */
  role?: string
  isEDonusumEnabled?: boolean
  disabledModules?: string[]
  /** Hesap salt-okunur arşivde mi? ([[lib/billing/archive.ts]]) */
  isArchived?: boolean
  /** Kısıtlı çalışan izinleri; boş = kısıt yok. Bkz. lib/page-access.ts. */
  allowedPaths?: string[]
  writablePaths?: string[]
  /** Firma tanımlı özel rol. Yetki TAVANINI değiştirir — düşürülürse menü boşalır. */
  customRoleId?: string | null
  customRoleName?: string | null
  // Üyelik değil; parent-admin erişimiyle gelen alt şube. Üst seçicide gizlenir.
  isBranch?: boolean
  parentCompanyId?: string | null
  parentName?: string | null
  /** Şube değilken doluysa: hesaba bağlı ek firma (ayrı VKN, ortak abonelik). */
  accountRootId?: string | null
}

type DashboardCompanyContextValue = {
  companies: DashboardCompany[]
  selectedCompanyId: string | null
  selectedCompany: DashboardCompany | null
  userRole: string
  /** Seçili firmadaki efektif sayfa izinleri (rol + kısıt listesi). */
  pagePermissions: PagePermissions
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
  const [fallbackRole, setFallbackRole] = useState(initialRole)
  const [isLoading, setIsLoading] = useState(initialCompanies.length === 0)

  const pushCompanyToUrl = useCallback(
    (companyId: string) => {
      router.replace(withCompanyQuery(searchParams.toString(), companySlugForId(companies, companyId)))
    },
    [router, searchParams, companies]
  )

  useEffect(() => {
    setCompanies(initialCompanies)
    setFallbackRole(initialRole)
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

    // ÖNEMLİ — bu effect ile yukarıdaki "URL/localStorage → seçim" effect'i AYNI
    // commit'te çalışır ve buradaki `selectedCompanyId`, o render'ın closure'ından
    // gelir: yukarıdaki effect setSelectedCompanyId(...) çağırmış olsa bile burası
    // hâlâ ESKİ değeri (ilk render'da null) görür. Bu yüzden aşağıdaki "eşleşme yok →
    // ilk firmaya dön" dalı, URL'de açıkça belirtilmiş geçerli bir firmayı ezip
    // adres çubuğunu ilk firmaya çeviriyordu. Birden fazla firması/şubesi olan
    // kullanıcıda semptom: menüler arasında gezerken aktif firma kendiliğinden
    // değişiyor. Çözüm: geçerli bir seçim KAYNAĞI varsa (URL param'ı ya da
    // localStorage) kararı ona bırak — burada hiçbir şey yapma.
    const urlParam = searchParams.get("company")
    if (urlParam && findCompanyByParam(companies, urlParam)) return
    if (!urlParam) {
      const stored = typeof window !== "undefined" ? localStorage.getItem("selectedCompanyId") : null
      if (stored && findCompanyByParam(companies, stored)) return
    }

    // selectedCompanyId slug de olabilir (companies yüklenmeden set edildiyse) → cuid'e düzelt.
    const match = findCompanyByParam(companies, selectedCompanyId)
    if (match) {
      if (match.id !== selectedCompanyId) {
        setSelectedCompanyId(match.id)
        localStorage.setItem("selectedCompanyId", match.id)
      }
      return
    }

    // Buraya yalnızca gerçekten geçerli bir seçim yoksa düşülür: URL'de firma yok
    // (ya da erişilemeyen bir firma), localStorage'da da kullanılabilir bir kayıt yok.
    const firstCompanyId = getFirstAccessibleCompanyId(companies)
    if (!firstCompanyId) return

    setSelectedCompanyId(firstCompanyId)
    localStorage.setItem("selectedCompanyId", firstCompanyId)
    pushCompanyToUrl(firstCompanyId)
  }, [companies, selectedCompanyId, pushCompanyToUrl, searchParams])

  const handleCompanyChange = useCallback(
    (companyId: string) => {
      setSelectedCompanyId(companyId)
      localStorage.setItem("selectedCompanyId", companyId)
      router.push(withCompanyQuery(searchParams.toString(), companySlugForId(companies, companyId)))
    },
    [router, searchParams, companies]
  )

  // Seçili firmayı cookie'ye de yaz: server component'ler `?company=` param'ı olmayan
  // gezinmelerde (kart/hızlı-aksiyon linkleri, doğrudan URL) bu cookie'ye düşer ve
  // kullanıcı ana firmaya geri atılmaz. Bkz. getAuthContext / ACTIVE_COMPANY_COOKIE.
  useEffect(() => {
    if (!selectedCompanyId) return
    document.cookie = `activeCompanyId=${encodeURIComponent(selectedCompanyId)}; path=/; max-age=31536000; samesite=lax`
  }, [selectedCompanyId])

  const selectedCompany = useMemo(
    () => companies.find((c) => c.id === selectedCompanyId) ?? null,
    [companies, selectedCompanyId]
  )

  // Rol SEÇİLİ firmadan gelir. Önceden yalnızca `initialRole` (ilk ÜYE firmanın rolü)
  // kullanılıyor ve firma değişince güncellenmiyordu: A firmasında ACCOUNTANT, B'de ADMIN
  // olan kullanıcı B'ye geçtiğinde hâlâ muhasebeci menüsünü görüyordu. Şubede de aynı —
  // şubedeki (parent-admin) sanal ADMIN rolü yerine ana firmanın rolü uygulanıyordu.
  // Seçim çözülene kadar ilk firmanın rolüne düşülür.
  const userRole = selectedCompany?.role ?? fallbackRole

  // İzinler de role gibi SEÇİLİ firmadan gelir: aynı kullanıcı bir şubede kısıtlı,
  // diğerinde kısıtsız olabilir. Seçim çözülmeden önce kısıt uygulanmaz — menüyü
  // yanlışlıkla boşaltmamak için; gerçek koruma zaten sunucu kapısında.
  const pagePermissions = useMemo<PagePermissions>(
    () => ({
      role: userRole,
      allowedPaths: selectedCompany?.allowedPaths ?? [],
      writablePaths: selectedCompany?.writablePaths ?? [],
      // Bayrak DÜŞÜRÜLMEMELİ: özel rolde tavan `assignablePages()`, aksi halde
      // `pagesForRole("CUSTOM")` hesaplanır ve o boş kümedir → kullanıcı her sayfada
      // "yetkiniz yok" görür. (page-access ayrıca enum'a da bakarak bunu yakalar.)
      custom: Boolean(selectedCompany?.customRoleId) || userRole === "CUSTOM",
    }),
    [userRole, selectedCompany]
  )

  const value = useMemo(
    () => ({
      companies,
      selectedCompanyId,
      selectedCompany,
      userRole,
      pagePermissions,
      isLoading,
      fetchCompanies,
      handleCompanyChange,
    }),
    [
      companies,
      selectedCompanyId,
      selectedCompany,
      userRole,
      pagePermissions,
      isLoading,
      fetchCompanies,
      handleCompanyChange,
    ]
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

/**
 * Sağlayıcı YOKSA null döner — fırlatmaz.
 *
 * Panelin bazı parçaları (ör. sayfa yetkisi seçici) sistem yönetim panelinde de
 * kullanılıyor; orada seçili firma kavramı yok. Bileşeni ikizlemek yerine firma
 * bağlamını isteğe bağlı okuyoruz: iki ayrı seçici, "panelde gördüğüm liste ile
 * kalıpta gördüğüm liste farklı" türü sessiz tutarsızlık üretirdi.
 */
export function useOptionalDashboardCompany() {
  return useContext(DashboardCompanyContext)
}

/**
 * Kullanıcının görebildiği menü sayfaları (rol ∩ izin listesi).
 * Menü, arama kutusu ve sayfa guard'ı AYNI listeden beslenmeli — ayrı hesaplayan
 * bir tüketici, kapalı sayfaya giden bir link bırakır.
 */
export function useVisiblePages(): string[] {
  const { pagePermissions } = useDashboardCompany()
  return useMemo(() => visiblePages(pagePermissions), [pagePermissions])
}

/** Belirli bir menü sayfası görünür mü? */
export function useCanView(href: string): boolean {
  const { pagePermissions } = useDashboardCompany()
  return useMemo(() => canViewPage(pagePermissions, href), [pagePermissions, href])
}

/**
 * Rastgele bir panel YOLU açılabilir mi? Sunucudaki `assertRouteAccessOrRedirect` ile
 * aynı yordamdan (`canAccessRoute`) besleniyor.
 *
 * `useCanView`den farkı: o yalnız MENÜ href'lerini tanır ve menüsüz bir sayfa için
 * (ör. `/raporlar/vergiler`, `/cari/ekstre`, `/muhasebe/yevmiye`) YÖNETİCİDE bile
 * false döner — link süzmek için kullanılırsa ekranı herkese boşaltır. Bu ise yolun
 * sahibini çözer ve sahibi olmayan yolu kapıya tabi saymaz.
 *
 * Hook değil, YÜKLEM döndürür: liste süzerken satır başına hook çağrılamaz.
 */
export function useRouteAccess(): (pathname: string) => boolean {
  const { pagePermissions } = useDashboardCompany()
  return useCallback(
    (pathname: string) => canAccessRoute(pagePermissions, pathname),
    [pagePermissions]
  )
}

/**
 * Bu sayfada yazma (ekle/düzenle/sil) yetkisi var mı?
 *
 * Yalnızca ARAYÜZ içindir — düğmeyi gizler. Gerçek kısıt sunucu kapısındadır
 * (lib/page-access.ts); burada true dönmesi ucun geçeceği anlamına gelmez.
 */
export function useCanEdit(href: string): boolean {
  const { pagePermissions } = useDashboardCompany()
  return useMemo(() => canEditPage(pagePermissions, href), [pagePermissions, href])
}
