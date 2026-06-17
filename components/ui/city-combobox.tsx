"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { TURKISH_CITIES, normalizeCity } from "@/lib/data/turkish-cities"

type CityComboboxProps = {
  id?: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
}

/**
 * Şehir seçimi: serbest yazılabilir input + birkaç harf yazılınca açılan
 * filtreli il listesi. Türkçe karakter/aksan farklarına toleranslıdır
 * (ör. "sanli" → "Şanlıurfa").
 */
export function CityCombobox({ id, value, onChange, disabled, placeholder }: CityComboboxProps) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)

  const query = value.trim()
  const matches = useMemo(() => {
    if (!query) return []
    const q = normalizeCity(query)
    return TURKISH_CITIES.filter((c) => normalizeCity(c).includes(q))
  }, [query])

  // Tam ve tek eşleşme zaten seçilmişse listeyi gösterme.
  const showList =
    open && matches.length > 0 && !(matches.length === 1 && matches[0] === value)

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onDocMouseDown)
    return () => document.removeEventListener("mousedown", onDocMouseDown)
  }, [])

  function select(city: string) {
    onChange(city)
    setOpen(false)
    setHighlight(-1)
  }

  return (
    <div ref={containerRef} className="relative">
      <Input
        id={id}
        value={value}
        disabled={disabled}
        placeholder={placeholder || "Şehir yazın…"}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setHighlight(-1)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!showList) return
          if (e.key === "ArrowDown") {
            e.preventDefault()
            setHighlight((h) => Math.min(h + 1, matches.length - 1))
          } else if (e.key === "ArrowUp") {
            e.preventDefault()
            setHighlight((h) => Math.max(h - 1, 0))
          } else if (e.key === "Enter" && highlight >= 0) {
            e.preventDefault()
            select(matches[highlight])
          } else if (e.key === "Escape") {
            setOpen(false)
          }
        }}
      />
      {showList && (
        <ul className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
          {matches.map((city, i) => (
            <li key={city}>
              <button
                type="button"
                // mousedown: input blur olmadan seçimi yakala (liste kapanmadan).
                onMouseDown={(e) => {
                  e.preventDefault()
                  select(city)
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`w-full rounded-sm px-2 py-1.5 text-left text-sm transition-colors ${
                  i === highlight ? "bg-accent text-accent-foreground" : "hover:bg-accent"
                }`}
              >
                {city}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
