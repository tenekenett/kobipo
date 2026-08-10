"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Search } from "lucide-react"
import { allNavItems, moduleKeyForPath, navGroups } from "@/components/dashboard/nav-config"
import { useDashboardCompany, useVisiblePages } from "@/components/dashboard/dashboard-company-provider"
import { MODULE_KEYS } from "@/lib/modules"

// href -> menü grubu başlığı (sonuçlarda grup etiketi + grup adıyla arama için).
const GROUP_BY_HREF: Record<string, string> = (() => {
  const map: Record<string, string> = {}
  for (const g of navGroups) for (const href of g.hrefs) map[href] = g.title
  return map
})()

const lc = (s: string) => s.toLocaleLowerCase("tr")

/**
 * `userRole` artık yalnızca geriye dönük uyumluluk için duruyor: erişilebilir sayfa
 * listesi kenar çubuğuyla AYNI kaynaktan (useVisiblePages) geliyor. Ayrı hesaplayan
 * bir arama kutusu, menüde gizlenmiş sayfaya giden bir link bırakırdı.
 */
export function MenuSearch({ userRole: _userRole }: { userRole: string }) {
  const router = useRouter()
  const visibleHrefs = useVisiblePages()
  const { selectedCompany } = useDashboardCompany()
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [highlighted, setHighlighted] = useState(0)

  const results = useMemo(() => {
    // Kullanıcının erişebildiği TÜM menü öğeleri: izin (rol ∩ kısıt listesi) VE modül.
    // Modül filtresi eskiden burada yoktu — kapalı modülün sayfası kenar çubuğunda
    // gizliyken arama kutusunda çıkıyordu.
    const visible = new Set(visibleHrefs)
    const disabled = new Set(selectedCompany ? selectedCompany.disabledModules ?? [] : MODULE_KEYS)
    const items = allNavItems.filter((i) => {
      if (!visible.has(i.href)) return false
      const moduleKey = i.module ?? moduleKeyForPath(i.href)
      return !(moduleKey && disabled.has(moduleKey))
    })
    const q = lc(query.trim())
    if (!q) return items
    // Etikete VEYA ait olduğu grup başlığına göre eşleşir (ör. "finans" → tüm grup).
    return items.filter(
      (i) => lc(i.label).includes(q) || lc(GROUP_BY_HREF[i.href] ?? "").includes(q)
    )
  }, [query, visibleHrefs, selectedCompany])

  useEffect(() => {
    setHighlighted(0)
  }, [query])

  // Açılınca input'a odaklan.
  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  // Dışarı tıklayınca kapat.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  const go = (href: string) => {
    setOpen(false)
    setQuery("")
    // Aktif firma (?company=) ve diğer query paramları korunur.
    const search = typeof window !== "undefined" ? window.location.search : ""
    router.push(href + search)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false)
      return
    }
    if (results.length === 0) return
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setHighlighted((h) => (h + 1) % results.length)
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setHighlighted((h) => (h - 1 + results.length) % results.length)
    } else if (e.key === "Enter") {
      e.preventDefault()
      const item = results[highlighted]
      if (item) go(item.href)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="outline"
        size="icon"
        type="button"
        className="h-9 w-9"
        onClick={() => setOpen((o) => !o)}
        title="Menüde ara"
        aria-expanded={open}
      >
        <Search className="h-4 w-4" />
      </Button>

      {open && (
        <div className="fixed inset-x-2 top-14 z-50 overflow-hidden rounded-xl border border-kobipo-border bg-white shadow-lg dark:border-border dark:bg-card sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-80">
          <div className="flex items-center gap-2 border-b border-kobipo-border px-3 py-2 dark:border-border">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Menüde ara…"
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <ul className="max-h-72 overflow-y-auto p-1">
            {results.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                Sonuç bulunamadı
              </li>
            ) : (
              results.map((item, i) => {
                const Icon = item.icon
                const group = GROUP_BY_HREF[item.href]
                return (
                  <li key={item.href}>
                    <button
                      type="button"
                      onMouseEnter={() => setHighlighted(i)}
                      onClick={() => go(item.href)}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                        highlighted === i ? "bg-muted" : "hover:bg-muted/60"
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate">{item.label}</span>
                      {group && (
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {group}
                        </span>
                      )}
                    </button>
                  </li>
                )
              })
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
