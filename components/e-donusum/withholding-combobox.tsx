"use client"

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { X } from "lucide-react"

export type WithholdingType = { code: string; name: string; rate: number }

type Props = {
  types: WithholdingType[]
  /** Seçili tevkifat kodu; boş ("") = tevkifat yok. */
  value?: string
  onChange: (code: string) => void
  disabled?: boolean
  placeholder?: string
}

const MAX_RESULTS = 100

/**
 * Tevkifat kodu/isim araması yapılabilen açılır liste (searchable combobox).
 *
 * Açılır liste, `document.body`'ye bir portal ile `position: fixed` olarak
 * render edilir — böylece fatura kalemi kartındaki `overflow-hidden` (veya
 * tablonun overflow'u) tarafından KIRPILMAZ. Konum, input'un ekrandaki yerine
 * göre hesaplanır ve scroll/resize sırasında güncellenir.
 */
export function WithholdingCombobox({
  types,
  value,
  onChange,
  disabled,
  placeholder = "Tevkifat ara (kod veya isim)…",
}: Props) {
  const listId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [highlighted, setHighlighted] = useState(-1)
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null)

  const selected = useMemo(() => types.find((t) => t.code === value) || null, [types, value])
  const selectedDisplay = selected
    ? `${selected.code} · ${selected.name}${selected.code !== "650" && selected.rate ? `  (%${selected.rate})` : ""}`
    : ""

  const q = query.trim().toLowerCase()
  const rows = useMemo(() => {
    const filtered = q
      ? types.filter(
          (t) => t.code.toLowerCase().includes(q) || t.name.toLowerCase().includes(q),
        )
      : types
    return filtered.slice(0, MAX_RESULTS)
  }, [types, q])

  const updateRect = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setRect({ top: r.bottom + 4, left: r.left, width: r.width })
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    setHighlighted(-1)
    setQuery("")
  }, [])

  // Açılınca konumu hesapla; scroll/resize sırasında güncel tut.
  useEffect(() => {
    if (!open) return
    updateRect()
    const onMove = () => updateRect()
    window.addEventListener("scroll", onMove, true)
    window.addEventListener("resize", onMove)
    return () => {
      window.removeEventListener("scroll", onMove, true)
      window.removeEventListener("resize", onMove)
    }
  }, [open, updateRect])

  // Dışarı tıklayınca kapat (portal içindeki tıklamalar hariç).
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (!containerRef.current?.contains(t) && !dropdownRef.current?.contains(t)) close()
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open, close])

  useEffect(() => {
    setHighlighted(-1)
  }, [query, open])

  const pick = useCallback(
    (code: string) => {
      onChange(code)
      close()
      inputRef.current?.blur()
    },
    [onChange, close],
  )

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true)
      return
    }
    if (!open) return

    const total = rows.length
    if (e.key === "Escape") {
      e.preventDefault()
      close()
      return
    }
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setHighlighted((h) => (total === 0 ? -1 : (h + 1) % total))
      return
    }
    if (e.key === "ArrowUp") {
      e.preventDefault()
      setHighlighted((h) => (total === 0 ? -1 : (h - 1 + total) % total))
      return
    }
    if (e.key === "Enter") {
      e.preventDefault()
      if (highlighted >= 0 && highlighted < total) pick(rows[highlighted].code)
      else if (total === 1) pick(rows[0].code)
    }
  }

  const inputValue = open ? query : selectedDisplay

  const dropdown =
    open && rect
      ? createPortal(
          <div
            ref={dropdownRef}
            id={listId}
            role="listbox"
            style={{
              position: "fixed",
              top: rect.top,
              left: rect.left,
              width: rect.width,
              zIndex: 60,
            }}
            className="max-h-96 overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
          >
            {rows.length === 0 ? (
              <div className="px-2 py-3 text-sm text-muted-foreground">Sonuç yok</div>
            ) : (
              rows.map((w, i) => (
                <button
                  key={w.code}
                  type="button"
                  role="option"
                  aria-selected={highlighted === i || w.code === value}
                  className={`flex w-full flex-col items-start rounded-sm px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground ${
                    highlighted === i
                      ? "bg-accent text-accent-foreground"
                      : w.code === value
                        ? "bg-accent/50"
                        : ""
                  }`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(w.code)}
                >
                  <span className="font-medium">
                    {w.code} · {w.name}
                  </span>
                  {w.code !== "650" && w.rate ? (
                    <span className="text-xs text-muted-foreground">KDV&apos;nin %{w.rate}&apos;i</span>
                  ) : null}
                </button>
              ))
            )}
          </div>,
          document.body,
        )
      : null

  return (
    <div ref={containerRef} className="relative min-w-0 flex-1">
      <div className="flex gap-1">
        <Input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          disabled={disabled}
          className="h-9 min-w-0 flex-1 bg-white"
          placeholder={placeholder}
          value={inputValue}
          onChange={(e) => {
            setQuery(e.target.value)
            if (!open) setOpen(true)
          }}
          onFocus={() => {
            setOpen(true)
            setQuery("")
          }}
          onKeyDown={onKeyDown}
        />
        {selected ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            title="Tevkifatı kaldır"
            onClick={() => {
              onChange("")
              close()
            }}
            disabled={disabled}
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
      {dropdown}
    </div>
  )
}
