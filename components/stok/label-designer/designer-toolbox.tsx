"use client"

// Etiket Tasarımcısı — sol araç kutusu: öğe ekleme (ürün alanları, metin,
// barkod, QR, şekiller), boyut önayarları + hazır şablonlar ve görsel/emoji.
// Yeni öğeler etiket ortasına eklenir; hazır şablon mevcut tasarımın yerine
// geçer (REPLACE_DESIGN → geri alınabilir, şablon meta'sı korunur).

import { useRef } from "react"
import {
  Barcode,
  Circle,
  ImagePlus,
  Minus,
  QrCode,
  Square,
  Type,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import type {
  LabelElement,
  LabelPage,
  ProductFieldKey,
  ShapeKind,
} from "@/lib/labels/types"
import { DEFAULT_FONT, makeElementId } from "@/lib/labels/types"
import { PRODUCT_FIELDS } from "@/lib/labels/fields"
import { SIZE_PRESETS, STARTER_TEMPLATES } from "@/lib/labels/presets"
import { EMOJI_CHOICES, rasterizeEmoji } from "@/lib/labels/emoji"
import { downscaleImageToDataUrl } from "@/lib/labels/raster"
import type { DesignerApi } from "./use-label-designer-state"

/** Yeni öğeyi etiket ortasına oturtur (kenarlara 1mm pay, sayfaya sığdırılır). */
function centerRect(page: LabelPage, w: number, h: number) {
  const cw = Math.min(w, Math.max(1, page.widthMm - 2))
  const ch = Math.min(h, Math.max(1, page.heightMm - 2))
  return {
    x: Math.round(((page.widthMm - cw) / 2) * 2) / 2,
    y: Math.round(((page.heightMm - ch) / 2) * 2) / 2,
    w: cw,
    h: ch,
  }
}

const baseEl = { rotation: 0 as const, z: 0 }

export function DesignerToolbox({ api }: { api: DesignerApi }) {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const page = api.design.page

  const addField = (fieldKey: ProductFieldKey) => {
    const isPrice = fieldKey === "salePrice" || fieldKey === "salePriceWithVat"
    api.addElement({
      id: makeElementId(),
      type: "field",
      fieldKey,
      font: { ...DEFAULT_FONT, ...(isPrice ? { bold: true, sizePt: 10 } : {}) },
      fit: "shrink",
      price: isPrice ? { decimals: 2, showCurrency: true } : undefined,
      ...centerRect(page, 30, 5),
      ...baseEl,
    })
  }

  const addText = () =>
    api.addElement({
      id: makeElementId(),
      type: "text",
      text: "Metin",
      font: { ...DEFAULT_FONT },
      fit: "shrink",
      ...centerRect(page, 30, 5),
      ...baseEl,
    })

  const addBarcode = () =>
    api.addElement({
      id: makeElementId(),
      type: "barcode",
      source: "barcode",
      symbology: "auto",
      showText: true,
      ...centerRect(page, 30, 12),
      ...baseEl,
    })

  const addQr = () => {
    const side = Math.min(12, page.widthMm - 2, page.heightMm - 2)
    api.addElement({
      id: makeElementId(),
      type: "qr",
      source: "barcode",
      ...centerRect(page, side, side),
      ...baseEl,
    })
  }

  const addShape = (shape: ShapeKind) => {
    const rect =
      shape === "line" ? centerRect(page, 30, 2) : centerRect(page, 10, 10)
    api.addElement({
      id: makeElementId(),
      type: "shape",
      shape,
      strokeColor: "#000000",
      strokeWidthMm: 0.3,
      dashed: false,
      fillColor: null,
      ...rect,
      ...baseEl,
    })
  }

  const addEmoji = (char: string) => {
    const dataUrl = rasterizeEmoji(char)
    if (!dataUrl) {
      toast({ title: "Emoji eklenemedi", variant: "destructive" })
      return
    }
    api.addElement({
      id: makeElementId(),
      type: "image",
      dataUrl,
      ...centerRect(page, 8, 8),
      ...baseEl,
    })
  }

  const addImageFile = async (file: File) => {
    const dataUrl = await downscaleImageToDataUrl(file)
    if (!dataUrl) {
      toast({
        title: "Görsel yüklenemedi",
        description: "En fazla 2MB boyutunda bir görsel dosyası seçin.",
        variant: "destructive",
      })
      return
    }
    // En-boy oranını koru: uzun kenar 15mm (sayfaya sığdırılır).
    const dims = await new Promise<{ w: number; h: number }>((resolve) => {
      const img = new Image()
      img.onload = () => resolve({ w: img.width, h: img.height })
      img.onerror = () => resolve({ w: 1, h: 1 })
      img.src = dataUrl
    })
    const scale = 15 / Math.max(dims.w, dims.h)
    const el: LabelElement = {
      id: makeElementId(),
      type: "image",
      dataUrl,
      ...centerRect(page, Math.max(2, dims.w * scale), Math.max(2, dims.h * scale)),
      ...baseEl,
    }
    api.addElement(el)
  }

  const applyStarter = async (index: number) => {
    const starter = STARTER_TEMPLATES[index]
    if (
      api.design.elements.length > 0 &&
      !(await confirm({
        title: "Hazır şablonu uygula",
        description: `"${starter.name}" mevcut tasarımın yerine geçecek. Devam edilsin mi? (Geri alınabilir.)`,
        confirmLabel: "Uygula",
      }))
    ) {
      return
    }
    api.replaceDesign(starter.design)
  }

  return (
    <Tabs defaultValue="elements" className="flex h-full flex-col">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="elements">Öğeler</TabsTrigger>
        <TabsTrigger value="templates">Şablon</TabsTrigger>
        <TabsTrigger value="media">Görsel</TabsTrigger>
      </TabsList>

      <TabsContent value="elements" className="flex-1 overflow-y-auto">
        <div className="space-y-4 p-1">
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Ürün Alanları</div>
            <div className="grid grid-cols-1 gap-1">
              {PRODUCT_FIELDS.map((f) => (
                <Button
                  key={f.key}
                  variant="outline"
                  size="sm"
                  className="justify-start"
                  onClick={() => addField(f.key)}
                >
                  {f.label}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Temel Öğeler</div>
            <div className="grid grid-cols-2 gap-1">
              <Button variant="outline" size="sm" className="justify-start" onClick={addText}>
                <Type className="mr-1.5 h-3.5 w-3.5" /> Metin
              </Button>
              <Button variant="outline" size="sm" className="justify-start" onClick={addBarcode}>
                <Barcode className="mr-1.5 h-3.5 w-3.5" /> Barkod
              </Button>
              <Button variant="outline" size="sm" className="justify-start" onClick={addQr}>
                <QrCode className="mr-1.5 h-3.5 w-3.5" /> QR Kod
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="justify-start"
                onClick={() => addShape("line")}
              >
                <Minus className="mr-1.5 h-3.5 w-3.5" /> Çizgi
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="justify-start"
                onClick={() => addShape("rect")}
              >
                <Square className="mr-1.5 h-3.5 w-3.5" /> Kutu
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="justify-start"
                onClick={() => addShape("circle")}
              >
                <Circle className="mr-1.5 h-3.5 w-3.5" /> Daire
              </Button>
            </div>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="templates" className="flex-1 overflow-y-auto">
        <div className="space-y-4 p-1">
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Etiket Boyutu</div>
            <div className="grid grid-cols-1 gap-1">
              {SIZE_PRESETS.map((p) => {
                const active =
                  p.labelType === page.labelType &&
                  p.widthMm === page.widthMm &&
                  p.heightMm === page.heightMm
                return (
                  <Button
                    key={p.label}
                    variant={active ? "secondary" : "outline"}
                    size="sm"
                    className="justify-start"
                    onClick={() =>
                      api.setPage({
                        labelType: p.labelType,
                        widthMm: p.widthMm,
                        heightMm: p.heightMm,
                        gapXMm: p.gapXMm,
                        gapYMm: p.gapYMm,
                        a4: p.a4,
                        ...(p.labelType === "ROLL" ? { columns: 1 } : {}),
                      })
                    }
                  >
                    {p.label}
                  </Button>
                )
              })}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Hazır Şablonlar</div>
            <div className="space-y-1.5">
              {STARTER_TEMPLATES.map((t, i) => (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => applyStarter(i)}
                  className="w-full rounded-md border p-2 text-left transition-colors hover:bg-accent"
                >
                  <div className="text-sm font-medium">{t.name}</div>
                  <div className="text-xs text-muted-foreground">{t.description}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="media" className="flex-1 overflow-y-auto">
        <div className="space-y-4 p-1">
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Görsel / Logo</div>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus className="mr-1.5 h-3.5 w-3.5" /> Görsel Yükle
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void addImageFile(file)
                e.target.value = ""
              }}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              PNG/JPEG, en fazla 2MB. Görsel küçültülerek tasarıma gömülür.
            </p>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Emoji</div>
            <div className="grid grid-cols-6 gap-0.5">
              {EMOJI_CHOICES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => addEmoji(c)}
                  className="rounded p-1 text-lg leading-none transition-colors hover:bg-accent"
                  aria-label={`Emoji ekle: ${c}`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  )
}
