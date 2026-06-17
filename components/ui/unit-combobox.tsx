"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { UNIT_OPTIONS } from "@/lib/data/units"

type UnitComboboxProps = {
  id?: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
}

function norm(s: string): string {
  return s
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .trim()
}

/**
 * Birim seçimi: hazır birimler (Adet, Kg, Litre…) listelenir; kullanıcı
 * listeden seçebilir ya da kendi birimini serbestçe yazabilir.
 */
export function UnitCombobox({ id, value, onChange, disabled, placeholder }: UnitComboboxProps) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)

  const matches = useMemo(() => {
    const q = norm(value.trim())
    if (!q) return UNIT_OPTIONS
    return UNIT_OPTIONS.filter((u) => norm(u.value).includes(q) || norm(u.label).includes(q))
  }, [value])

  // Yalnızca tam seçili kod listede tekse açma (gereksiz tekrar göstermeyi önler).
  const showList = open && matches.length > 0 && !(matches.length === 1 && matches[0].value === value)

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onDocMouseDown)
    return () => document.removeEventListener("mousedown", onDocMouseDown)
  }, [])

  function select(unitValue: string) {
    onChange(unitValue)
    setOpen(false)
    setHighlight(-1)
  }

  return (
    <div ref={containerRef} className="relative">
      <Input
        id={id}
        value={value}
        disabled={disabled}
        placeholder={placeholder || "Birim seçin veya yazın…"}
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
            select(matches[highlight].value)
          } else if (e.key === "Escape") {
            setOpen(false)
          }
        }}
      />
      {showList && (
        <ul className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
          {matches.map((u, i) => (
            <li key={u.value}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  select(u.value)
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors ${
                  i === highlight ? "bg-accent text-accent-foreground" : "hover:bg-accent"
                }`}
              >
                <span>{u.label}</span>
                <span className="text-xs text-muted-foreground">{u.value}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
