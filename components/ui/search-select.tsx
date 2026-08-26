"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Check, ChevronsUpDown, Plus } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export type SearchOption = { id: string; name: string }

type SearchSelectProps = {
  id?: string
  options: SearchOption[]
  /** Seçili kayıt id'si ("" = seçili değil). */
  value: string
  onChange: (id: string) => void
  placeholder?: string
  emptyText?: string
  disabled?: boolean
  /** Üstte "—" (seçimi temizle) satırı göster. */
  allowClear?: boolean
  clearLabel?: string
  /**
   * Verilirse listenin altına "yeni ekle" satırı çıkar; yazılan metinle çağrılır
   * (kayıt formunu ismi doldurulmuş açmak için). Kayıt listede yoksa kullanıcı
   * bu seçicide çıkmaza düşmesin diye var.
   */
  onCreate?: (query: string) => void
  /** Yazı yokken gösterilecek ekleme satırı metni. */
  createLabel?: string
  /** Girdi kutusuna eklenecek sınıf (ör. doğrulama hatasında kırmızı kenar). */
  className?: string
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
 * Aratılabilir tekli seçim: input'a yazarak listede süzer, seçince id döner.
 * Müşteri/tedarikçi gibi kayıt listeleri için (serbest metin kabul etmez —
 * yalnızca listedekilerden seçilir).
 */
export function SearchSelect({
  id,
  options,
  value,
  onChange,
  placeholder,
  emptyText,
  disabled,
  allowClear,
  clearLabel,
  onCreate,
  createLabel,
  className,
}: SearchSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [highlight, setHighlight] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)

  const selectedName = useMemo(
    () => options.find((o) => o.id === value)?.name ?? "",
    [options, value],
  )

  // Kapalıyken input seçili adı yansıtır; dışarıdan değer değişince eşitle.
  useEffect(() => {
    if (!open) setQuery(selectedName)
  }, [selectedName, open])

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", onDocMouseDown)
    return () => document.removeEventListener("mousedown", onDocMouseDown)
  }, [])

  const matches = useMemo(() => {
    const q = norm(query)
    // Henüz yazılmadıysa (sorgu = seçili ad) ya da boşsa tüm listeyi göster.
    if (!q || query === selectedName) return options
    return options.filter((o) => norm(o.name).includes(q))
  }, [query, options, selectedName])

  // Seçili adı değil, KULLANICININ yazdığını taşı: yeni kayıt formuna ad olarak gider.
  const typedQuery = query === selectedName ? "" : query.trim()

  function select(opt: SearchOption) {
    onChange(opt.id)
    setQuery(opt.name)
    setOpen(false)
    setHighlight(-1)
  }

  function startCreate() {
    setOpen(false)
    setHighlight(-1)
    onCreate?.(typedQuery)
  }

  function clear() {
    onChange("")
    setQuery("")
    setOpen(false)
    setHighlight(-1)
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Input
          id={id}
          value={open ? query : selectedName}
          disabled={disabled}
          placeholder={placeholder || "Seçin veya arayın…"}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          className={cn("pr-8", className)}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            setHighlight(-1)
          }}
          onFocus={(e) => {
            setOpen(true)
            setQuery(selectedName)
            e.currentTarget.select()
          }}
          onKeyDown={(e) => {
            if (!open) return
            if (e.key === "ArrowDown") {
              e.preventDefault()
              setHighlight((h) => Math.min(h + 1, matches.length - 1))
            } else if (e.key === "ArrowUp") {
              e.preventDefault()
              setHighlight((h) => Math.max(h - 1, 0))
            } else if (e.key === "Enter" && highlight >= 0) {
              e.preventDefault()
              select(matches[highlight])
            } else if (e.key === "Enter" && onCreate && matches.length === 0) {
              // Eşleşme yokken Enter = yazılan adla yeni kayıt aç.
              e.preventDefault()
              startCreate()
            } else if (e.key === "Escape") {
              setOpen(false)
            }
          }}
        />
        <ChevronsUpDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      </div>
      {open && (
        <ul className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
          {allowClear && (
            <li>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  clear()
                }}
                className="w-full rounded-sm px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent"
              >
                {clearLabel || "—"}
              </button>
            </li>
          )}
          {matches.length === 0 ? (
            <li className="px-2 py-2 text-sm text-muted-foreground">
              {emptyText || "Sonuç bulunamadı"}
            </li>
          ) : (
            matches.map((opt, i) => (
              <li key={opt.id}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    select(opt)
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={`flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors ${
                    i === highlight ? "bg-accent text-accent-foreground" : "hover:bg-accent"
                  }`}
                >
                  <span className="truncate">{opt.name}</span>
                  {opt.id === value && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-kobipo-blue" />
                  )}
                </button>
              </li>
            ))
          )}
          {onCreate && (
            <li className={matches.length > 0 ? "mt-1 border-t pt-1" : ""}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  startCreate()
                }}
                className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-sm font-medium text-kobipo-blue transition-colors hover:bg-accent dark:text-primary"
              >
                <Plus className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  {typedQuery ? `“${typedQuery}” adıyla ekle` : createLabel || "Yeni kayıt ekle"}
                </span>
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
