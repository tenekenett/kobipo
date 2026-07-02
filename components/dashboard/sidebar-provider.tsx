"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { usePathname } from "next/navigation"

type SidebarContextValue = {
  collapsed: boolean
  setCollapsed: (v: boolean) => void
  toggle: () => void
}

const STORAGE_KEY = "kobipo:sidebar-collapsed"

// Bu ekranlara girince sol menü otomatik kapanır (geniş çalışma alanı için).
const AUTO_COLLAPSE_ROUTES = ["/satis/hizli", "/alis/hizli"]

const FALLBACK: SidebarContextValue = {
  collapsed: false,
  setCollapsed: () => {},
  toggle: () => {},
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

function readStoredPref(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [collapsed, setCollapsedState] = useState(false)
  const wasAutoRoute = useRef(false)

  // Kullanıcının kayıtlı tercihini ilk mount'ta yükle.
  useEffect(() => {
    setCollapsedState(readStoredPref())
  }, [])

  // Manuel değişiklikler kalıcıdır (localStorage'a yazılır).
  const setCollapsed = useCallback((v: boolean) => {
    setCollapsedState(v)
    try {
      localStorage.setItem(STORAGE_KEY, v ? "1" : "0")
    } catch {}
  }, [])

  const toggle = useCallback(() => {
    setCollapsedState((prev) => {
      const next = !prev
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0")
      } catch {}
      return next
    })
  }, [])

  // Hızlı alış/satış ekranına GİRİNCE menüyü otomatik kapat (bu kalıcı değildir);
  // ekrandan çıkınca kullanıcının kayıtlı tercihine geri dön.
  useEffect(() => {
    const isAutoRoute = AUTO_COLLAPSE_ROUTES.some((r) => pathname.startsWith(r))
    if (isAutoRoute && !wasAutoRoute.current) {
      setCollapsedState(true)
    } else if (!isAutoRoute && wasAutoRoute.current) {
      setCollapsedState(readStoredPref())
    }
    wasAutoRoute.current = isAutoRoute
  }, [pathname])

  return (
    <SidebarContext.Provider value={{ collapsed, setCollapsed, toggle }}>
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebar(): SidebarContextValue {
  return useContext(SidebarContext) ?? FALLBACK
}
