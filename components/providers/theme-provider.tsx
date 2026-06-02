"use client"

import { createContext, useContext, useEffect, useState, useCallback } from "react"
import { usePathname } from "next/navigation"
import { isDarkRoute } from "@/lib/theme/dark-routes"

type Theme = "light" | "dark" | "system"
type ResolvedTheme = "light" | "dark"

interface ThemeContextValue {
  theme: Theme
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
}

const STORAGE_KEY = "kobipo-theme"
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light"
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

function applyTheme(resolved: ResolvedTheme, pathname: string | null) {
  const root = document.documentElement
  const effective: ResolvedTheme = isDarkRoute(pathname) ? resolved : "light"
  root.classList.toggle("dark", effective === "dark")
  root.style.colorScheme = effective
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [theme, setThemeState] = useState<Theme>("system")
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light")

  useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "system"
    const resolved = stored === "system" ? getSystemTheme() : stored
    setThemeState(stored)
    setResolvedTheme(resolved)
  }, [])

  useEffect(() => {
    applyTheme(resolvedTheme, pathname)
  }, [resolvedTheme, pathname])

  useEffect(() => {
    if (theme !== "system") return
    const mql = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => {
      setResolvedTheme(mql.matches ? "dark" : "light")
    }
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [theme])

  const setTheme = useCallback((next: Theme) => {
    localStorage.setItem(STORAGE_KEY, next)
    const resolved = next === "system" ? getSystemTheme() : next
    setThemeState(next)
    setResolvedTheme(resolved)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark")
  }, [resolvedTheme, setTheme])

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    return {
      theme: "system" as Theme,
      resolvedTheme: "light" as ResolvedTheme,
      setTheme: () => {},
      toggleTheme: () => {},
    }
  }
  return ctx
}
