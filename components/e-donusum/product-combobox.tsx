"use client"

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"
import { Loader2, X } from "lucide-react"

const UNIT_OPTIONS = ["ADET", "KG", "MT", "M2", "M3", "LT", "SA", "GUN", "PAKET"] as const

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
  defaults: { unit?: string; vatRate?: number; salePrice?: number; purchasePrice?: number }
  /**
   * Yeni ürün popup'ında satır birim fiyatının hangi alana pre-fill edileceğini belirler.
   * Satış faturası bağlamında "sale" (default), alış faturasında "purchase".
   */
  priceContext?: "sale" | "purchase"
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
  priceContext = "sale",
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

  // Yeni ürün popup state'i
  const [dialogOpen, setDialogOpen] = useState(false)
  const [draftProduct, setDraftProduct] = useState({
    name: "",
    code: "",
    barcode: "",
    unit: "ADET" as string,
    vatRate: "20",
    purchasePrice: "",
    salePrice: "",
    stockQuantity: "",
    isService: false,
  })

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

  // Eski davranış (inline create) yerine popup açıyoruz. Kullanıcı popup'ta
  // opsiyonel alanları (kod, barkod, alış fiyatı, başlangıç stoğu) doldurabilir.
  // priceContext'e göre birim fiyat doğru alana pre-fill olur — alış faturasında
  // satır fiyatı "Alış Fiyatı", satışta "Satış Fiyatı" alanına gider.
  const openCreateDialog = useCallback(() => {
    const name = query.trim()
    if (!name || exactMatch) return
    const lineUnitPrice =
      priceContext === "purchase"
        ? defaults.purchasePrice
        : defaults.salePrice
    const lineUnitPriceStr =
      lineUnitPrice != null && lineUnitPrice > 0 ? String(lineUnitPrice) : ""
    setDraftProduct({
      name,
      code: "",
      barcode: "",
      unit: defaults.unit || "ADET",
      vatRate: String(defaults.vatRate ?? 20),
      purchasePrice:
        priceContext === "purchase"
          ? lineUnitPriceStr
          : defaults.purchasePrice != null && defaults.purchasePrice > 0
            ? String(defaults.purchasePrice)
            : "",
      salePrice:
        priceContext === "sale"
          ? lineUnitPriceStr
          : defaults.salePrice != null && defaults.salePrice > 0
            ? String(defaults.salePrice)
            : "",
      stockQuantity: "",
      isService: false,
    })
    setDialogOpen(true)
  }, [query, exactMatch, defaults, priceContext])

  const submitCreateDialog = useCallback(async () => {
    const name = draftProduct.name.trim()
    if (!name || creating) return
    setCreating(true)
    try {
      const res = await fetch("/api/stok/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          name,
          code: draftProduct.code.trim() || undefined,
          barcode: draftProduct.barcode.trim() || undefined,
          unit: draftProduct.unit || "ADET",
          vatRate: draftProduct.vatRate || "20",
          purchasePrice: draftProduct.purchasePrice || undefined,
          salePrice: draftProduct.salePrice || undefined,
          stockQuantity: draftProduct.stockQuantity || undefined,
          isService: draftProduct.isService,
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
      setDialogOpen(false)
      close()
      toast({ title: "Ürün eklendi", description: created.name })
    } catch (e: any) {
      toast({
        title: "Hata",
        description: e.message || "Ürün oluşturulamadı",
        variant: "destructive",
      })
    } finally {
      setCreating(false)
    }
  }, [draftProduct, creating, companyId, onSelect, close, toast])

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
        openCreateDialog()
        return
      }
      if (filtered.length === 1 && !canCreate) {
        pick(filtered[0])
        return
      }
      if (canCreate && filtered.length === 0) {
        openCreateDialog()
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
              onClick={() => openCreateDialog()}
            >
              {creating ? "Kaydediliyor…" : `+ "${query.trim()}" adıyla yeni ürün ekle`}
            </button>
          ) : null}
        </div>
      ) : null}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Yeni ürün ekle</DialogTitle>
            <DialogDescription>
              Sadece ad zorunlu — diğer alanları daha sonra da güncelleyebilirsin.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2 space-y-1">
              <Label>Ad *</Label>
              <Input
                value={draftProduct.name}
                onChange={(e) => setDraftProduct((p) => ({ ...p, name: e.target.value }))}
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label>Kod</Label>
              <Input
                value={draftProduct.code}
                onChange={(e) => setDraftProduct((p) => ({ ...p, code: e.target.value }))}
                placeholder="Opsiyonel"
              />
            </div>
            <div className="space-y-1">
              <Label>Barkod</Label>
              <Input
                value={draftProduct.barcode}
                onChange={(e) => setDraftProduct((p) => ({ ...p, barcode: e.target.value }))}
                placeholder="Opsiyonel"
              />
            </div>
            <div className="space-y-1">
              <Label>Birim</Label>
              <Select
                value={draftProduct.unit}
                onValueChange={(v) => setDraftProduct((p) => ({ ...p, unit: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNIT_OPTIONS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>KDV %</Label>
              <Select
                value={draftProduct.vatRate}
                onValueChange={(v) => setDraftProduct((p) => ({ ...p, vatRate: v }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">%0</SelectItem>
                  <SelectItem value="1">%1</SelectItem>
                  <SelectItem value="8">%8</SelectItem>
                  <SelectItem value="10">%10</SelectItem>
                  <SelectItem value="18">%18</SelectItem>
                  <SelectItem value="20">%20</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Alış Fiyatı</Label>
              <Input
                type="number"
                step="0.01"
                value={draftProduct.purchasePrice}
                onChange={(e) =>
                  setDraftProduct((p) => ({ ...p, purchasePrice: e.target.value }))
                }
                placeholder="Opsiyonel"
              />
            </div>
            <div className="space-y-1">
              <Label>Satış Fiyatı</Label>
              <Input
                type="number"
                step="0.01"
                value={draftProduct.salePrice}
                onChange={(e) => setDraftProduct((p) => ({ ...p, salePrice: e.target.value }))}
                placeholder="Opsiyonel"
              />
            </div>
            <div className="sm:col-span-2 space-y-1">
              <Label>Başlangıç Stoğu</Label>
              <Input
                type="number"
                step="0.01"
                value={draftProduct.stockQuantity}
                onChange={(e) =>
                  setDraftProduct((p) => ({ ...p, stockQuantity: e.target.value }))
                }
                placeholder="Faturayla artacak miktarın haricindeki başlangıç stoğu (opsiyonel)"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={creating}>
              İptal
            </Button>
            <Button onClick={submitCreateDialog} disabled={creating || !draftProduct.name.trim()}>
              {creating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Kaydediliyor
                </>
              ) : (
                "Kaydet"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
