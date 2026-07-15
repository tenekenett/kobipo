"use client"

// Etiket Tasarımcısı — ana ekran: şablon yönetimi (listele/yükle/kaydet/
// farklı kaydet/sil/varsayılan/şubeye kopyala), undo-redo, zoom ve yazdırma.
// Düzen: sol araç kutusu · orta tuval · sağ özellik paneli.

import { useCallback, useEffect, useRef, useState } from "react"
import useSWR from "swr"
import {
  ChevronDown,
  FilePlus2,
  Loader2,
  Printer,
  Redo2,
  Save,
  Star,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { useDashboardCompany } from "@/components/dashboard/dashboard-company-provider"
import { jsonFetcher } from "@/lib/swr/fetcher"
import { type RefProduct, useProducts } from "@/lib/swr/use-company-data"
import { createDefaultDesign } from "@/lib/labels/types"
import { SAMPLE_COMPANY, SAMPLE_PRODUCT } from "@/lib/labels/fields"
import { useLabelDesignerState } from "./use-label-designer-state"
import { DesignerToolbox } from "./designer-toolbox"
import { DesignerCanvas } from "./designer-canvas"
import { PropertiesPanel } from "./properties-panel"
import { PreviewProductPicker } from "./preview-product-picker"
import { PrintDialog } from "./print-dialog"

interface TemplateListItem {
  id: string
  name: string
  slug: string
  labelType: string
  isDefault: boolean
  updatedAt: string
}

const ZOOM_STEPS = [1, 1.5, 2, 3, 4, 5, 6, 8]
const EMPTY_META = { id: null, name: "", isDefault: false }

export function LabelDesignerScreen() {
  const { selectedCompanyId: companyId, selectedCompany, companies } = useDashboardCompany()
  const api = useLabelDesignerState()
  const { toast } = useToast()
  const { confirm, prompt } = useConfirm()

  const [zoom, setZoom] = useState(4)
  const [name, setName] = useState("")
  const [printOpen, setPrintOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loadingTpl, setLoadingTpl] = useState(false)
  // Önizleme ürünü: tuval bu ürünün verisiyle çizilir (null → örnek ürün).
  // Yalnız önizlemedir; şablona kaydedilmez, yazdırma seçiminden bağımsızdır.
  const [previewProduct, setPreviewProduct] = useState<RefProduct | null>(null)

  const listKey = companyId ? `/api/stok/etiket-sablonlari?companyId=${companyId}` : null
  const { data: templates, mutate: mutateList } = useSWR<TemplateListItem[]>(listKey, jsonFetcher)
  const { products } = useProducts(companyId, { isService: false })

  const company = { name: selectedCompany?.name || SAMPLE_COMPANY.name }
  const otherCompanies = companies.filter((c) => c.id !== companyId)

  // Kaydedilmemiş değişiklik varken sekme kapatma/yenileme uyarısı.
  useEffect(() => {
    if (!api.dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ""
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [api.dirty])

  const confirmDiscard = useCallback(async () => {
    if (!api.dirty) return true
    return confirm({
      title: "Kaydedilmemiş değişiklikler",
      description: "Mevcut tasarımdaki kaydedilmemiş değişiklikler kaybolacak. Devam edilsin mi?",
      confirmLabel: "Devam",
      variant: "destructive",
    })
  }, [api.dirty, confirm])

  const loadTemplate = useCallback(
    async (id: string, opts?: { skipDirtyCheck?: boolean }) => {
      if (!companyId) return
      if (!opts?.skipDirtyCheck && !(await confirmDiscard())) return
      setLoadingTpl(true)
      try {
        const res = await fetch(`/api/stok/etiket-sablonlari/${id}?companyId=${companyId}`)
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Şablon yüklenemedi")
        const tpl = await res.json()
        api.loadDesign(tpl.design, { id: tpl.id, name: tpl.name, isDefault: tpl.isDefault })
        setName(tpl.name)
      } catch (err: any) {
        toast({ title: "Şablon yüklenemedi", description: err?.message, variant: "destructive" })
      } finally {
        setLoadingTpl(false)
      }
    },
    [api, companyId, confirmDiscard, toast]
  )

  // Firma değişince temiz tasarıma dön; varsayılan şablonu (varsa) bir kez yükle.
  const autoLoadedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!companyId || !templates || autoLoadedRef.current === companyId) return
    autoLoadedRef.current = companyId
    api.loadDesign(createDefaultDesign(), EMPTY_META)
    setName("")
    setPreviewProduct(null)
    const def = templates.find((t) => t.isDefault)
    if (def) void loadTemplate(def.id, { skipDirtyCheck: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, templates])

  const newTemplate = async () => {
    if (!(await confirmDiscard())) return
    api.loadDesign(createDefaultDesign(), EMPTY_META)
    setName("")
  }

  const saveTemplate = async (opts?: { asNew?: boolean; forcedName?: string }) => {
    if (!companyId) return
    const trimmed = (opts?.forcedName ?? name).trim()
    if (!trimmed) {
      toast({ title: "Şablona bir ad verin", variant: "destructive" })
      return
    }
    const isUpdate = !opts?.asNew && api.template.id
    setSaving(true)
    try {
      const res = await fetch(
        isUpdate ? `/api/stok/etiket-sablonlari/${api.template.id}` : "/api/stok/etiket-sablonlari",
        {
          method: isUpdate ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, name: trimmed, design: api.design }),
        }
      )
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Kaydedilemedi")
      const saved = await res.json()
      api.markSaved({ id: saved.id, name: saved.name, isDefault: saved.isDefault })
      setName(saved.name)
      void mutateList()
      toast({ title: isUpdate ? "Şablon güncellendi" : "Şablon kaydedildi" })
    } catch (err: any) {
      toast({ title: "Kaydedilemedi", description: err?.message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const saveAs = async () => {
    const suggested = name.trim() ? `${name.trim()} (kopya)` : ""
    const newName = await prompt({
      title: "Farklı kaydet",
      label: "Yeni şablon adı",
      defaultValue: suggested,
      minLength: 1,
      confirmLabel: "Kaydet",
    })
    if (newName === null) return
    await saveTemplate({ asNew: true, forcedName: newName })
  }

  const deleteTemplate = async () => {
    if (!companyId || !api.template.id) return
    if (
      !(await confirm({
        title: "Şablonu sil",
        description: `"${api.template.name}" kalıcı olarak silinecek. Emin misiniz?`,
        confirmLabel: "Sil",
        variant: "destructive",
      }))
    ) {
      return
    }
    try {
      const res = await fetch(
        `/api/stok/etiket-sablonlari/${api.template.id}?companyId=${companyId}`,
        { method: "DELETE" }
      )
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Silinemedi")
      api.loadDesign(createDefaultDesign(), EMPTY_META)
      setName("")
      void mutateList()
      toast({ title: "Şablon silindi" })
    } catch (err: any) {
      toast({ title: "Silinemedi", description: err?.message, variant: "destructive" })
    }
  }

  const toggleDefault = async (value: boolean) => {
    if (!companyId || !api.template.id) return
    try {
      const res = await fetch(`/api/stok/etiket-sablonlari/${api.template.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, isDefault: value }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Güncellenemedi")
      const saved = await res.json()
      api.markSaved({ id: saved.id, name: saved.name, isDefault: saved.isDefault })
      void mutateList()
    } catch (err: any) {
      toast({ title: "Güncellenemedi", description: err?.message, variant: "destructive" })
    }
  }

  const copyToBranch = async (targetCompanyId: string, targetName: string) => {
    if (!companyId || !api.template.id) return
    try {
      const res = await fetch(`/api/stok/etiket-sablonlari/${api.template.id}/kopyala`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, targetCompanyId }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || "Kopyalanamadı")
      toast({ title: "Şablon kopyalandı", description: `"${targetName}" şubesine kopyalandı.` })
    } catch (err: any) {
      toast({ title: "Kopyalanamadı", description: err?.message, variant: "destructive" })
    }
  }

  const zoomBy = (dir: 1 | -1) => {
    setZoom((z) => {
      const idx = ZOOM_STEPS.indexOf(z)
      const next = idx < 0 ? 4 : ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, idx + dir))]
      return next
    })
  }

  if (!companyId) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Lütfen bir firma seçin</p>
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100dvh-12rem)] min-h-[540px] flex-col gap-3">
      {/* Üst bar: şablon yönetimi + düzenleme araçları */}
      <Card className="p-2">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={api.template.id ?? undefined}
            onValueChange={(id) => id !== api.template.id && void loadTemplate(id)}
            disabled={loadingTpl}
          >
            <SelectTrigger className="h-9 w-[200px]">
              <SelectValue placeholder="Şablon seç..." />
            </SelectTrigger>
            <SelectContent>
              {(templates ?? []).map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.isDefault ? "★ " : ""}
                  {t.name}
                </SelectItem>
              ))}
              {(templates ?? []).length === 0 && (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">Kayıtlı şablon yok</div>
              )}
            </SelectContent>
          </Select>
          <Button type="button" variant="outline" size="sm" onClick={newTemplate} title="Yeni şablon">
            <FilePlus2 className="mr-1.5 h-4 w-4" /> Yeni
          </Button>
          <Input
            placeholder="Şablon adı"
            className="h-9 w-[180px]"
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="button" size="sm" onClick={() => void saveTemplate()} disabled={saving}>
            {saving ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-4 w-4" />
            )}
            Kaydet
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                Diğer <ChevronDown className="ml-1 h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => void saveAs()}>Farklı kaydet...</DropdownMenuItem>
              {api.template.id && otherCompanies.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Şubeye kopyala</DropdownMenuLabel>
                  {otherCompanies.map((c) => (
                    <DropdownMenuItem key={c.id} onClick={() => void copyToBranch(c.id, c.name)}>
                      {c.name}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
              {api.template.id && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => void deleteTemplate()}
                  >
                    <Trash2 className="mr-1.5 h-4 w-4" /> Şablonu sil
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {api.template.id && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Switch checked={api.template.isDefault} onCheckedChange={(v) => void toggleDefault(v)} />
              <Star className="h-3.5 w-3.5" /> Varsayılan
            </label>
          )}
          {api.dirty && (
            <span className="text-xs font-medium text-amber-600 dark:text-amber-500">
              • Kaydedilmemiş değişiklik
            </span>
          )}

          <div className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9"
              onClick={api.undo}
              disabled={!api.canUndo}
              title="Geri al (Ctrl+Z)"
            >
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9"
              onClick={api.redo}
              disabled={!api.canRedo}
              title="Yinele (Ctrl+Y)"
            >
              <Redo2 className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9"
              onClick={() => zoomBy(-1)}
              disabled={zoom <= ZOOM_STEPS[0]}
              title="Uzaklaş"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">
              {Math.round(zoom * 100)}%
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-9 w-9"
              onClick={() => zoomBy(1)}
              disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
              title="Yakınlaş"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="sm"
              className="ml-1"
              onClick={() => setPrintOpen(true)}
              disabled={api.design.elements.length === 0}
              title={api.design.elements.length === 0 ? "Önce tasarıma öğe ekleyin" : undefined}
            >
              <Printer className="mr-1.5 h-4 w-4" /> Yazdır
            </Button>
          </div>
        </div>
      </Card>

      {/* Gövde: toolbox · tuval · özellikler */}
      <div className="flex min-h-0 flex-1 gap-3">
        <Card className="hidden w-60 shrink-0 overflow-hidden p-2 md:block">
          <DesignerToolbox api={api} />
        </Card>
        <Card className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex items-center gap-2 border-b px-2 py-1.5">
            <span className="shrink-0 text-xs font-medium text-muted-foreground">
              Önizleme ürünü
            </span>
            <div className="min-w-0 max-w-md flex-1">
              <PreviewProductPicker
                products={products}
                value={previewProduct}
                onChange={setPreviewProduct}
              />
            </div>
            {previewProduct && !previewProduct.barcode && (
              <span className="shrink-0 text-xs font-medium text-amber-600 dark:text-amber-500">
                Bu ürünün barkodu yok
              </span>
            )}
          </div>
          <div className="min-h-0 flex-1">
            <DesignerCanvas
              api={api}
              zoom={zoom}
              product={previewProduct ?? SAMPLE_PRODUCT}
              company={company}
            />
          </div>
        </Card>
        <Card className="hidden w-72 shrink-0 overflow-hidden lg:block">
          <PropertiesPanel api={api} />
        </Card>
      </div>

      <PrintDialog
        open={printOpen}
        onOpenChange={setPrintOpen}
        design={api.design}
        companyId={companyId}
        companyName={company.name}
      />
    </div>
  )
}
