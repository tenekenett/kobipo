"use client"

// Fatura → Etiket Yazdır paneli (sabit sayfa içeriği; pop-up değil).
// Faturadaki (kataloğa bağlı) ürünlerin etiketini, firmanın kayıtlı etiket
// şablonlarından biriyle basar. Tasarımcıdaki yazdırma akışıyla aynı PDF motorunu
// (lib/pdf/label-pdf) kullanır; farkı, ürün listesinin fatura kalemlerinden
// gelmesi ve tasarımın seçilen şablondan yüklenmesidir.

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import useSWR from "swr"
import { Loader2, Printer, Tag } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"
import { jsonFetcher } from "@/lib/swr/fetcher"
import { normalizeLabelDesign } from "@/lib/labels/types"
import type { InvoiceLabelItem } from "@/lib/labels/invoice-label-items"
import { generateLabelPdf } from "@/lib/pdf/label-pdf"

interface TemplateListItem {
  id: string
  name: string
  isDefault: boolean
}

interface InvoiceLabelPrintPanelProps {
  companyId: string | null
  companyName: string
  items: InvoiceLabelItem[]
}

export function InvoiceLabelPrintPanel({
  companyId,
  companyName,
  items,
}: InvoiceLabelPrintPanelProps) {
  const { toast } = useToast()
  const [templateId, setTemplateId] = useState<string | null>(null)
  // key → adet; haritada olmayan kalem seçili değildir.
  const [selected, setSelected] = useState<Map<string, number>>(
    () => new Map(items.map((it) => [it.key, it.quantity]))
  )
  const [generating, setGenerating] = useState(false)

  // Firma etiket şablonları.
  const listKey = companyId ? `/api/stok/etiket-sablonlari?companyId=${companyId}` : null
  const { data: templates, isLoading: templatesLoading } = useSWR<TemplateListItem[]>(
    listKey,
    jsonFetcher
  )

  // Seçili şablonun tam tasarımı (design dahil).
  const tplKey =
    companyId && templateId
      ? `/api/stok/etiket-sablonlari/${templateId}?companyId=${companyId}`
      : null
  const { data: fullTemplate, isLoading: designLoading } = useSWR<{ design: unknown }>(
    tplKey,
    jsonFetcher
  )

  const design = useMemo(
    () => (fullTemplate?.design ? normalizeLabelDesign(fullTemplate.design) : null),
    [fullTemplate]
  )

  // Kalemler değişince seçimi önerilen adetlerle yeniden kur.
  useEffect(() => {
    setSelected(new Map(items.map((it) => [it.key, it.quantity])))
  }, [items])

  // Şablon listesi gelince varsayılanı (yoksa ilkini) seç.
  useEffect(() => {
    if (!templates || templates.length === 0) return
    setTemplateId((prev) => {
      if (prev && templates.some((t) => t.id === prev)) return prev
      return (templates.find((t) => t.isDefault) ?? templates[0]).id
    })
  }, [templates])

  const totalLabels = useMemo(
    () => [...selected.values()].reduce((sum, q) => sum + q, 0),
    [selected]
  )

  const toggle = (key: string, suggested: number) => {
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(key)) next.delete(key)
      else next.set(key, suggested)
      return next
    })
  }

  const setQty = (key: string, qty: number) => {
    setSelected((prev) => {
      const next = new Map(prev)
      next.set(key, Math.min(1000, Math.max(1, Math.floor(qty) || 1)))
      return next
    })
  }

  const selectAll = () => setSelected(new Map(items.map((it) => [it.key, it.quantity])))
  const clearAll = () => setSelected(new Map())

  const handleGenerate = async () => {
    if (!design) return
    const chosen = items
      .filter((it) => selected.has(it.key))
      .map((it) => ({ product: it.product, quantity: selected.get(it.key) ?? 1 }))
    setGenerating(true)
    try {
      const blob = await generateLabelPdf(design, chosen, { name: companyName })
      const url = URL.createObjectURL(blob)
      window.open(url, "_blank")
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      toast({ title: "Etiket PDF'i oluşturuldu", description: "Yeni sekmede açıldı." })
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

  const noTemplates = !templatesLoading && (templates?.length ?? 0) === 0
  const designEmpty = Boolean(design && design.elements.length === 0)

  if (noTemplates) {
    return (
      <div className="space-y-3 rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
        <p>Bu firmaya ait kayıtlı etiket şablonu yok. Önce bir etiket tasarlayın.</p>
        <Button asChild variant="outline" size="sm">
          <Link href={`/stok/etiket?company=${companyId ?? ""}`}>
            <Tag className="mr-1.5 h-4 w-4" />
            Etiket Tasarımcısı&apos;na git
          </Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Şablon seçimi */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="shrink-0 text-sm font-medium text-muted-foreground">Şablon</span>
        <Select
          value={templateId ?? undefined}
          onValueChange={setTemplateId}
          disabled={templatesLoading || !templates}
        >
          <SelectTrigger className="h-9 w-[240px]">
            <SelectValue placeholder={templatesLoading ? "Yükleniyor..." : "Şablon seç..."} />
          </SelectTrigger>
          <SelectContent>
            {(templates ?? []).map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.isDefault ? "★ " : ""}
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
          <Link href={`/stok/etiket?company=${companyId ?? ""}`}>
            <Tag className="mr-1.5 h-4 w-4" />
            Tasarımcı
          </Link>
        </Button>
        {designEmpty && (
          <span className="text-xs font-medium text-amber-600 dark:text-amber-500">
            Seçili şablon boş — Tasarımcıdan öğe ekleyin.
          </span>
        )}
      </div>

      {/* Ürün / adet listesi */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Ürünler</p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={selectAll}>
            Tümünü Seç
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={clearAll}
            disabled={selected.size === 0}
          >
            Temizle
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border">
        {items.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
            Etiketlenebilir ürün yok
          </div>
        ) : (
          <div className="divide-y">
            {items.map((it) => {
              const checked = selected.has(it.key)
              return (
                <div
                  key={it.key}
                  className={`flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-accent/50 ${
                    checked ? "bg-accent/40" : ""
                  }`}
                  onClick={() => toggle(it.key, it.quantity)}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(it.key, it.quantity)}
                    onClick={(e) => e.stopPropagation()}
                    className="h-4 w-4 accent-primary"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{it.product.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {[it.product.code, it.product.barcode].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  {!it.product.barcode && (
                    <span className="shrink-0 text-xs font-medium text-amber-600 dark:text-amber-500">
                      Barkodsuz
                    </span>
                  )}
                  {checked && (
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <Input
                        type="number"
                        min={1}
                        max={1000}
                        value={selected.get(it.key) ?? 1}
                        onChange={(e) => setQty(it.key, Number(e.target.value))}
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

      {/* Aksiyon çubuğu */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <div className="text-sm text-muted-foreground">
          {selected.size} ürün · toplam {totalLabels} etiket
        </div>
        <Button
          type="button"
          size="lg"
          onClick={handleGenerate}
          disabled={generating || designLoading || !design || designEmpty || totalLabels === 0}
        >
          {generating || designLoading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Printer className="mr-2 h-4 w-4" />
          )}
          PDF Oluştur
        </Button>
      </div>
    </div>
  )
}
