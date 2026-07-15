"use client"

// Etiket Tasarımcısı — yazdırma dialogu: ürün seç + adet gir → mevcut
// tasarımla PDF üret (lib/pdf/label-pdf.ts, client-side) ve yeni sekmede aç.

import { useMemo, useState } from "react"
import { Loader2, Printer, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/use-toast"
import { useProducts } from "@/lib/swr/use-company-data"
import type { LabelDesign } from "@/lib/labels/types"
import type { LabelProduct } from "@/lib/labels/fields"
import { generateLabelPdf } from "@/lib/pdf/label-pdf"

interface PrintDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  design: LabelDesign
  companyId: string | null
  companyName: string
}

export function PrintDialog({ open, onOpenChange, design, companyId, companyName }: PrintDialogProps) {
  const { toast } = useToast()
  const { products, isLoading } = useProducts(companyId, { isService: false })
  const [search, setSearch] = useState("")
  // productId → adet; haritada olmayan ürün seçili değildir.
  const [selected, setSelected] = useState<Map<string, number>>(new Map())
  const [generating, setGenerating] = useState(false)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return products
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.code ?? "").toLowerCase().includes(q) ||
        (p.barcode ?? "").toLowerCase().includes(q)
    )
  }, [products, search])

  const totalLabels = useMemo(
    () => [...selected.values()].reduce((sum, q) => sum + q, 0),
    [selected]
  )

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(id)) next.delete(id)
      else next.set(id, 1)
      return next
    })
  }

  const setQty = (id: string, qty: number) => {
    setSelected((prev) => {
      const next = new Map(prev)
      next.set(id, Math.min(1000, Math.max(1, Math.floor(qty) || 1)))
      return next
    })
  }

  const addAllFiltered = () => {
    setSelected((prev) => {
      const next = new Map(prev)
      for (const p of filtered) if (!next.has(p.id)) next.set(p.id, 1)
      return next
    })
  }

  const handleGenerate = async () => {
    const items = products
      .filter((p) => selected.has(p.id))
      .map((p) => ({ product: p as LabelProduct, quantity: selected.get(p.id) ?? 1 }))
    setGenerating(true)
    try {
      const blob = await generateLabelPdf(design, items, { name: companyName })
      const url = URL.createObjectURL(blob)
      window.open(url, "_blank")
      // Sekme PDF'i yükledikten sonra URL serbest bırakılabilir.
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      onOpenChange(false)
    } catch (err: any) {
      toast({
        title: "PDF oluşturulamadı",
        description: err?.message || "Bilinmeyen hata",
        variant: "destructive",
      })
    } finally {
      setGenerating(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) {
          setSelected(new Map())
          setSearch("")
        }
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Etiket Yazdır</DialogTitle>
          <DialogDescription>
            Etiket basılacak ürünleri seçin, her ürün için adet girin.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Ürün adı, kodu veya barkod ara..."
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button type="button" variant="outline" size="sm" onClick={addAllFiltered}>
            Listeyi Ekle
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setSelected(new Map())}
            disabled={selected.size === 0}
          >
            Temizle
          </Button>
        </div>

        <div className="max-h-[45vh] min-h-[200px] overflow-y-auto rounded-md border">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Ürünler yükleniyor...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              Ürün bulunamadı
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map((p) => {
                const checked = selected.has(p.id)
                return (
                  <div
                    key={p.id}
                    className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm transition-colors hover:bg-accent/50 ${
                      checked ? "bg-accent/40" : ""
                    }`}
                    onClick={() => toggle(p.id)}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(p.id)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-4 w-4 accent-primary"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{p.name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {[p.code, p.barcode].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>
                    {checked && (
                      <div
                        className="flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Input
                          type="number"
                          min={1}
                          max={1000}
                          value={selected.get(p.id) ?? 1}
                          onChange={(e) => setQty(p.id, Number(e.target.value))}
                          className="h-8 w-20 text-right"
                        />
                        <span className="text-xs text-muted-foreground">adet</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <div className="text-sm text-muted-foreground">
            {selected.size} ürün · toplam {totalLabels} etiket
          </div>
          <Button
            type="button"
            onClick={handleGenerate}
            disabled={generating || totalLabels === 0 || design.elements.length === 0}
          >
            {generating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Printer className="mr-2 h-4 w-4" />
            )}
            PDF Oluştur
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
