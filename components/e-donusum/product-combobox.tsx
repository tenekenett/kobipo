"use client"

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useToast } from "@/components/ui/use-toast"
import { X } from "lucide-react"

export type ComboboxProduct = {
  id: string
  name: string
  code?: string | null
  salePrice?: number | null
  vatRate: number
  unit?: string | null
}

type ProductComboboxProps = {
  companyId: string
  products: ComboboxProduct[]
  selectedProductId?: string
  /** Ürün listede yokken veya yükleme sırasında gösterilecek etiket */
  selectedLabel?: string
  defaults: { unit?: string; vatRate?: number; salePrice?: number }
  onSelect: (product: ComboboxProduct) => void
  onClearBinding?: () => void
  disabled?: boolean
}

const MAX_RESULTS = 50

function normalizeName(s: string) {
  return s.trim().toLowerCase()
}

export function ProductCombobox({
  companyId,
  products,
  selectedProductId,
  selectedLabel,
  defaults,
  onSelect,
  onClearBinding,
  disabled,
}: ProductComboboxProps) {
  const { toast } = useToast()
  const listId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [highlighted, setHighlighted] = useState(-1)
  const [creating, setCreating] = useState(false)

  const selected = useMemo(
    () => (selectedProductId ? products.find((p) => p.id === selectedProductId) : undefined),
    [products, selectedProductId]
  )

  const closedDisplay = selected?.name ?? selectedLabel ?? ""

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return products.slice(0, MAX_RESULTS)
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.code && String(p.code).toLowerCase().includes(q))
      )
      .slice(0, MAX_RESULTS)
  }, [products, query])

  const exactMatch = useMemo(() => {
    const n = normalizeName(query)
    if (!n) return false
    return products.some((p) => normalizeName(p.name) === n)
  }, [products, query])

  const canCreate = query.trim().length > 0 && !exactMatch

  const close = useCallback(() => {
    setOpen(false)
    setHighlighted(-1)
    setQuery("")
  }, [])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) close()
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open, close])

  useEffect(() => {
    setHighlighted(-1)
  }, [query, open])

  const pick = useCallback(
    (p: ComboboxProduct) => {
      onSelect(p)
      close()
      inputRef.current?.blur()
    },
    [onSelect, close]
  )

  const createProduct = useCallback(async () => {
    const name = query.trim()
    if (!name || exactMatch || creating) return
    setCreating(true)
    try {
      const res = await fetch("/api/stok/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          name,
          unit: defaults.unit || "ADET",
          vatRate: defaults.vatRate ?? 20,
          salePrice:
            defaults.salePrice != null && defaults.salePrice > 0 ? defaults.salePrice : undefined,
          isService: false,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || "Ürün kaydedilemedi")
      }
      const created: ComboboxProduct = {
        id: data.id,
        name: data.name,
        code: data.code,
        salePrice: data.salePrice != null ? Number(data.salePrice) : null,
        vatRate: Number(data.vatRate) ?? 20,
        unit: data.unit,
      }
      onSelect(created)
      close()
    } catch (e: any) {
      toast({
        title: "Hata",
        description: e.message || "Ürün oluşturulamadı",
        variant: "destructive",
      })
    } finally {
      setCreating(false)
    }
  }, [query, exactMatch, creating, companyId, defaults, onSelect, close, toast])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true)
      setQuery(closedDisplay)
      return
    }
    if (!open) return

    const total = filtered.length + (canCreate ? 1 : 0)
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
      if (highlighted >= 0 && highlighted < filtered.length) {
        pick(filtered[highlighted])
        return
      }
      if (canCreate && highlighted === filtered.length) {
        void createProduct()
        return
      }
      if (filtered.length === 1 && !canCreate) {
        pick(filtered[0])
        return
      }
      if (canCreate && filtered.length === 0) {
        void createProduct()
        return
      }
    }
  }

  const inputValue = open ? query : closedDisplay

  return (
    <div ref={containerRef} className="relative min-w-0">
      <div className="flex gap-1">
        <Input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          disabled={disabled}
          className="min-w-0 flex-1"
          placeholder="Ürün ara veya yeni ad yazın"
          value={inputValue}
          onChange={(e) => {
            setQuery(e.target.value)
            if (!open) setOpen(true)
          }}
          onFocus={() => {
            setOpen(true)
            setQuery(selected?.name ?? selectedLabel ?? "")
          }}
          onKeyDown={onKeyDown}
        />
        {selectedProductId && onClearBinding ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            title="Ürün bağlantısını kaldır"
            onClick={() => {
              onClearBinding()
              close()
            }}
            disabled={disabled}
          >
            <X className="h-4 w-4" />
          </Button>
        ) : null}
      </div>
      {open ? (
        <div
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-64 w-full min-w-[240px] overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {filtered.length === 0 && !canCreate ? (
            <div className="px-2 py-3 text-sm text-muted-foreground">Sonuç yok</div>
          ) : null}
          {filtered.map((p, i) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={highlighted === i}
              className={`flex w-full flex-col items-start rounded-sm px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground ${
                highlighted === i ? "bg-accent text-accent-foreground" : ""
              }`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(p)}
            >
              <span className="font-medium">{p.name}</span>
              {p.code ? <span className="text-xs text-muted-foreground">{p.code}</span> : null}
            </button>
          ))}
          {canCreate ? (
            <button
              type="button"
              role="option"
              aria-selected={highlighted === filtered.length}
              className={`mt-1 w-full rounded-sm border-t px-2 py-2 text-left text-sm font-medium text-primary hover:bg-accent ${
                highlighted === filtered.length ? "bg-accent" : ""
              }`}
              disabled={creating}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void createProduct()}
            >
              {creating ? "Kaydediliyor…" : `+ "${query.trim()}" adıyla yeni ürün ekle`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
