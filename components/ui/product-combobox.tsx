"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Input } from "@/components/ui/input"
import { useAnchoredMenu } from "@/components/ui/use-anchored-menu"
import { Loader2, Package, Plus, Type } from "lucide-react"

export type ProductOption = {
  id: string
  name: string
  salePrice?: number | null
}

type ProductComboboxProps = {
  id?: string
  /** Satırın açıklaması (= kalem adı). Combobox metni budur. */
  value: string
  /** Serbest metin değişti: açıklamayı güncelle, productId'yi temizle. */
  onTextChange: (text: string) => void
  /** Listeden ürün seçildi: productId + ad + fiyat uygula. */
  onSelectProduct: (product: ProductOption) => void
  /**
   * Sağlanırsa "yeni ürün olarak ekle" seçeneği gösterilir; yazılan ad ile yeni
   * ürün oluşturup satıra uygulamak çağıranın sorumluluğundadır. true → başarılı
   * (combobox kapanır), false → başarısız (açık kalır).
   */
  onCreateProduct?: (name: string) => Promise<boolean>
  products: ProductOption[]
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
 * Kalem ürün/açıklama girişi: mevcut ürünler içinde aratılır (yazdıkça filtreler)
 * ve listeden seçilebilir. Listede yoksa yazılan metin, kalem açıklaması olarak
 * doğrudan kullanılır (serbest metin) — ayrı bir "ürün ekle" adımı gerekmez.
 *
 * Liste `document.body`'ye PORTAL ile basılır (`useAnchoredMenu`): `absolute` +
 * `w-full` haliyle girdi kadar dar kalıyor ve `overflow` sınırlayan bir kabın
 * içinde kırpılıyordu. Fatura ekranındaki kardeş bileşen
 * (`components/e-donusum/product-combobox.tsx`) düzeltilirken bu kopya atlanmıştı;
 * artık konumlandırma ikisinde de ortak.
 */
export function ProductCombobox({
  id,
  value,
  onTextChange,
  onSelectProduct,
  onCreateProduct,
  products,
  disabled,
  placeholder,
}: ProductComboboxProps) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const [creating, setCreating] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)

  const matches = useMemo(() => {
    const q = norm(value.trim())
    if (!q) return products
    return products.filter((p) => norm(p.name).includes(q))
  }, [value, products])

  const hasExact = useMemo(
    () => products.some((p) => norm(p.name) === norm(value.trim())),
    [products, value],
  )
  const typed = value.trim().length > 0

  function select(product: ProductOption) {
    onSelectProduct(product)
    setOpen(false)
    setHighlight(-1)
  }

  async function createNew() {
    if (!onCreateProduct || creating) return
    setCreating(true)
    try {
      const ok = await onCreateProduct(value.trim())
      if (ok) {
        setOpen(false)
        setHighlight(-1)
      }
    } finally {
      setCreating(false)
    }
  }

  function applyFreeText() {
    // Metin zaten satıra yazılı (onTextChange); sadece listeyi kapat.
    setOpen(false)
    setHighlight(-1)
  }

  // Listede ürün varsa ya da serbest metin ipucu gösterilecekse aç.
  const showList = open && (matches.length > 0 || (typed && !hasExact))

  const closeList = useCallback(() => setOpen(false), [])
  const rect = useAnchoredMenu({
    open: showList,
    anchorRef: inputRef,
    menuRef,
    containerRef,
    onOutsideClick: closeList,
  })

  return (
    <div ref={containerRef} className="relative">
      <Input
        ref={inputRef}
        id={id}
        value={value}
        disabled={disabled}
        placeholder={placeholder || "Ürün seçin veya yazın…"}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        onChange={(e) => {
          onTextChange(e.target.value)
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
      {showList && rect && typeof document !== "undefined" &&
        createPortal(
        <ul
          ref={menuRef}
          style={{
            position: "fixed",
            top: rect.top,
            left: rect.left,
            width: rect.width,
            maxHeight: rect.maxHeight,
          }}
          // z-60: "yeni ürün" gibi diyalog kaplamalarının (z-50) üstünde kalsın.
          className="z-[60] overflow-auto rounded-md border bg-popover p-1 shadow-md">
          {matches.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  select(p)
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors ${
                  i === highlight ? "bg-accent text-accent-foreground" : "hover:bg-accent"
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{p.name}</span>
                </span>
                {p.salePrice != null && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {Number(p.salePrice).toLocaleString("tr-TR")}
                  </span>
                )}
              </button>
            </li>
          ))}
          {typed && !hasExact && (
            <li className={matches.length > 0 ? "mt-1 border-t pt-1" : ""}>
              {onCreateProduct ? (
                <>
                  <button
                    type="button"
                    disabled={creating}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      createNew()
                    }}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm font-medium text-kobipo-blue transition-colors hover:bg-accent disabled:opacity-60 dark:text-primary"
                  >
                    {creating ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                    ) : (
                      <Plus className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="truncate">“{value.trim()}” yeni ürün olarak ekle</span>
                  </button>
                  <button
                    type="button"
                    disabled={creating}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      applyFreeText()
                    }}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent disabled:opacity-60"
                  >
                    <Type className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">Serbest kalem olarak kullan</span>
                  </button>
                </>
              ) : (
                <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
                  <Plus className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    “{value.trim()}” serbest kalem olarak eklenecek
                  </span>
                </div>
              )}
            </li>
          )}
        </ul>,
        document.body
      )}
    </div>
  )
}
