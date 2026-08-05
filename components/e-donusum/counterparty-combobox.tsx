"use client"

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Plus, X } from "lucide-react"
import { QuickCariDialog, type CreatedCari, type CariKind } from "@/components/e-donusum/quick-cari-dialog"

export type Counterparty = {
  id: string
  name: string
  /** Takma ad: ünvanı hatırlamayan kullanıcı cariyi bununla bulur. */
  nickname?: string | null
  taxNumber?: string | null
}

export type CounterpartySelection = { kind: "customer" | "supplier"; id: string }

type CounterpartyComboboxProps = {
  customers: Counterparty[]
  suppliers: Counterparty[]
  selectedCustomerId?: string
  selectedSupplierId?: string
  onSelect: (selection: CounterpartySelection | null) => void
  disabled?: boolean
  /** Liste açılmadan önce gereken minimum karakter sayısı (varsayılan 2). */
  minChars?: number
  placeholder?: string
  /** Hızlı cari ekleme için gerekli. Verilirse "+ Yeni cari ekle" aksiyonu çıkar. */
  companyId?: string
  /** Yeni cari oluşturulunca (oluşan cari + tip) çağrılır. companyId ile birlikte gerekir. */
  onCreated?: (created: CreatedCari, kind: CariKind) => void
  /** Ekleme dialog'unda ön seçili tip. Satış → "customer", alış → "supplier". */
  defaultCreateKind?: CariKind
  /** Ekleme aksiyonunu zorla aç/kapat. Varsayılan: companyId ve onCreated verildiyse açık. */
  allowCreate?: boolean
}

const MAX_RESULTS = 50

type Row = CounterpartySelection & {
  name: string
  nickname?: string | null
  taxNumber?: string | null
}

export function CounterpartyCombobox({
  customers,
  suppliers,
  selectedCustomerId,
  selectedSupplierId,
  onSelect,
  disabled,
  minChars = 2,
  placeholder = "İsim veya VKN/TCKN yazın…",
  companyId,
  onCreated,
  defaultCreateKind = "customer",
  allowCreate,
}: CounterpartyComboboxProps) {
  const listId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [highlighted, setHighlighted] = useState(-1)

  // Hızlı cari ekleme dialog'u durumu.
  const canCreate = (allowCreate ?? true) && Boolean(companyId && onCreated)
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState("")

  const selectedDisplay = useMemo(() => {
    if (selectedCustomerId) {
      const c = customers.find((x) => x.id === selectedCustomerId)
      if (c) return c.taxNumber ? `${c.name} (${c.taxNumber})` : c.name
    }
    if (selectedSupplierId) {
      const s = suppliers.find((x) => x.id === selectedSupplierId)
      if (s) return s.taxNumber ? `${s.name} (${s.taxNumber})` : s.name
    }
    return ""
  }, [customers, suppliers, selectedCustomerId, selectedSupplierId])

  const q = query.trim().toLowerCase()
  const hasEnough = q.length >= minChars

  const matches = useCallback(
    (item: Counterparty) =>
      item.name.toLowerCase().includes(q) ||
      // Kullanıcı cariyi çoğu zaman ünvanıyla değil takma adıyla arar.
      (item.nickname ? item.nickname.toLowerCase().includes(q) : false) ||
      (item.taxNumber ? String(item.taxNumber).toLowerCase().includes(q) : false),
    [q],
  )

  const customerRows = useMemo<Row[]>(() => {
    if (!hasEnough) return []
    return customers
      .filter(matches)
      .slice(0, MAX_RESULTS)
      .map((c) => ({
        kind: "customer",
        id: c.id,
        name: c.name,
        nickname: c.nickname,
        taxNumber: c.taxNumber,
      }))
  }, [customers, matches, hasEnough])

  const supplierRows = useMemo<Row[]>(() => {
    if (!hasEnough) return []
    return suppliers
      .filter(matches)
      .slice(0, MAX_RESULTS)
      .map((s) => ({
        kind: "supplier",
        id: s.id,
        name: s.name,
        nickname: s.nickname,
        taxNumber: s.taxNumber,
      }))
  }, [suppliers, matches, hasEnough])

  // Klavye gezinmesi için düz liste (müşteriler + tedarikçiler).
  const flatRows = useMemo(() => [...customerRows, ...supplierRows], [customerRows, supplierRows])

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
    (row: Row) => {
      onSelect({ kind: row.kind, id: row.id })
      close()
      inputRef.current?.blur()
    },
    [onSelect, close],
  )

  // "+ Yeni cari ekle": o an yazılan metni isim olarak taşıyıp dialog'u aç,
  // dropdown'ı kapat (close query'i sıfırladığı için önce yakalıyoruz).
  const openCreate = useCallback(() => {
    setCreateName(query.trim())
    close()
    setCreateOpen(true)
  }, [query, close])

  const handleCreated = useCallback(
    (created: CreatedCari, kind: CariKind) => {
      onCreated?.(created, kind)
      setCreateOpen(false)
    },
    [onCreated],
  )

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true)
      return
    }
    if (!open) return

    const total = flatRows.length
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
      if (highlighted >= 0 && highlighted < total) {
        pick(flatRows[highlighted])
      } else if (total === 1) {
        pick(flatRows[0])
      }
    }
  }

  const inputValue = open ? query : selectedDisplay

  const renderRow = (row: Row, flatIndex: number) => (
    <button
      key={`${row.kind}-${row.id}`}
      type="button"
      role="option"
      aria-selected={highlighted === flatIndex}
      className={`flex w-full flex-col items-start rounded-sm px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground ${
        highlighted === flatIndex ? "bg-accent text-accent-foreground" : ""
      }`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => pick(row)}
    >
      <span className="font-medium">{row.name}</span>
      {/* Takma adla arayan kullanıcı hangi kaydın eşleştiğini görebilsin. */}
      {row.nickname || row.taxNumber ? (
        <span className="text-xs text-muted-foreground">
          {[row.nickname, row.taxNumber].filter(Boolean).join(" · ")}
        </span>
      ) : null}
    </button>
  )

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
        {(selectedCustomerId || selectedSupplierId) ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            title="Seçimi kaldır"
            onClick={() => {
              onSelect(null)
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
          className="absolute z-50 mt-1 max-h-64 w-full min-w-[260px] overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {!hasEnough ? (
            <div className="px-2 py-3 text-sm text-muted-foreground">
              Aramak için en az {minChars} karakter yazın
            </div>
          ) : flatRows.length === 0 ? (
            <div className="space-y-1">
              <div className="px-2 py-3 text-sm text-muted-foreground">Sonuç yok</div>
              {canCreate ? (
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-sm border border-dashed border-kobipo-blue/40 bg-kobipo-pale/30 px-2 py-2 text-left text-sm font-medium text-kobipo-navy hover:bg-kobipo-pale/60 dark:border-primary/40 dark:bg-primary/10 dark:text-primary"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={openCreate}
                >
                  <Plus className="h-4 w-4 shrink-0" />
                  <span className="truncate">
                    {q ? `“${query.trim()}” adıyla yeni cari ekle` : "Yeni cari ekle"}
                  </span>
                </button>
              ) : null}
            </div>
          ) : (
            <>
              {customerRows.length > 0 ? (
                <div className="px-2 pb-1 pt-2 text-xs font-semibold text-muted-foreground">
                  Müşteriler
                </div>
              ) : null}
              {customerRows.map((row, i) => renderRow(row, i))}
              {supplierRows.length > 0 ? (
                <div className="mt-1 px-2 pb-1 pt-2 text-xs font-semibold text-muted-foreground">
                  Tedarikçiler
                </div>
              ) : null}
              {supplierRows.map((row, i) => renderRow(row, customerRows.length + i))}
              {canCreate ? (
                <button
                  type="button"
                  className="mt-1 flex w-full items-center gap-2 rounded-sm border-t px-2 py-2 text-left text-sm font-medium text-kobipo-navy hover:bg-accent dark:text-primary"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={openCreate}
                >
                  <Plus className="h-4 w-4 shrink-0" />
                  Yeni cari ekle
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {canCreate && companyId ? (
        <QuickCariDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          companyId={companyId}
          defaultKind={defaultCreateKind}
          initialName={createName}
          onCreated={handleCreated}
        />
      ) : null}
    </div>
  )
}
