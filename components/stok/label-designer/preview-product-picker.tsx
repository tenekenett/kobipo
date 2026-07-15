"use client"

// Etiket Tasarımcısı — önizleme ürünü seçici. Seçilen GERÇEK ürünün verisi
// (ad, kod, barkod, fiyat...) tuvaldeki alan/barkod/QR öğelerine yansır;
// seçim yokken örnek ürün kullanılır. Bu seçim yalnız önizlemedir, şablona
// KAYDEDİLMEZ — yazdırmada ürünler ayrıca seçilir (print-dialog).

import { useEffect, useMemo, useRef, useState } from "react"
import { Package, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { RefProduct } from "@/lib/swr/use-company-data"

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

interface PreviewProductPickerProps {
  products: RefProduct[]
  value: RefProduct | null
  onChange: (product: RefProduct | null) => void
}

export function PreviewProductPicker({ products, value, onChange }: PreviewProductPickerProps) {
  const [text, setText] = useState(value?.name ?? "")
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)

  // Dış değişimlerde (firma değişimi, temizleme) görünen metni eşitle.
  useEffect(() => setText(value?.name ?? ""), [value])

  const matches = useMemo(() => {
    const q = norm(text)
    // Seçiliyken metin ürün adına eşittir; filtrelemeden tüm listeyi göster ki
    // açılır liste "sadece seçili ürün" olarak daralmasın.
    if (!q || (value && text === value.name)) return products.slice(0, 50)
    return products
      .filter(
        (p) =>
          norm(p.name).includes(q) ||
          norm(p.code ?? "").includes(q) ||
          (p.barcode ?? "").toLowerCase().includes(q)
      )
      .slice(0, 50)
  }, [products, text, value])

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setHighlight(-1)
        // Seçim yapmadan kapandı: metni mevcut seçime geri döndür.
        setText(value?.name ?? "")
      }
    }
    document.addEventListener("mousedown", onDocMouseDown)
    return () => document.removeEventListener("mousedown", onDocMouseDown)
  }, [value])

  function select(product: RefProduct) {
    onChange(product)
    setText(product.name)
    setOpen(false)
    setHighlight(-1)
  }

  return (
    <div ref={containerRef} className="relative flex min-w-0 flex-1 items-center gap-1">
      <div className="relative min-w-0 flex-1">
        <Input
          value={text}
          placeholder="Örnek ürün — gerçek ürünle önizlemek için seçin…"
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          className="h-8 pr-7 text-sm"
          onChange={(e) => {
            setText(e.target.value)
            setOpen(true)
            setHighlight(-1)
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
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
            } else if (e.key === "Escape") {
              setOpen(false)
              setText(value?.name ?? "")
            }
          }}
        />
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-0.5 top-1/2 h-6 w-6 -translate-y-1/2 text-muted-foreground"
            title="Örnek ürüne dön"
            aria-label="Örnek ürüne dön"
            onClick={() => {
              onChange(null)
              setText("")
              setOpen(false)
            }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {open && matches.length > 0 && (
        <ul className="absolute left-0 top-full z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
          {matches.map((p, i) => (
            <li key={p.id}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  select(p)
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors ${
                  i === highlight ? "bg-accent text-accent-foreground" : "hover:bg-accent"
                }`}
              >
                <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{p.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {[p.code, p.barcode].filter(Boolean).join(" · ") || "kod/barkod yok"}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
