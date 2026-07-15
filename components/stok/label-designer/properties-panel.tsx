"use client"

// Etiket Tasarımcısı — sağ özellik paneli. Öğe seçiliyken öğe özellikleri,
// değilse sayfa (etiket boyutu/düzen) ayarları gösterilir.
// Sayı girişleri yerel state tutar ve blur/Enter'da COMMIT eder — her tuş
// vuruşunun ayrı undo adımı olmasını önler.

import { useEffect, useState } from "react"
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  Bold,
  Copy,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type {
  BarcodeElement,
  FieldElement,
  FontSpec,
  LabelElement,
  LabelRotation,
  QrElement,
  ShapeElement,
  TextAlign,
  TextElement,
  TextFit,
} from "@/lib/labels/types"
import { a4GridCapacity } from "@/lib/labels/geometry"
import { PRODUCT_FIELDS } from "@/lib/labels/fields"
import type { DesignerApi } from "./use-label-designer-state"

/** Blur/Enter'da işleyen sayı girişi (mm/pt). */
function NumField({
  label,
  value,
  onCommit,
  min,
  max,
  step = 0.5,
}: {
  label: string
  value: number
  onCommit: (v: number) => void
  min: number
  max: number
  step?: number
}) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])

  const commit = () => {
    const n = Number(text.replace(",", "."))
    if (!Number.isFinite(n)) {
      setText(String(value))
      return
    }
    const clamped = Math.min(max, Math.max(min, n))
    setText(String(clamped))
    if (clamped !== value) onCommit(clamped)
  }

  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        inputMode="decimal"
        className="h-8"
        value={text}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur()
        }}
      />
    </div>
  )
}

function ColorField({
  label,
  value,
  onCommit,
}: {
  label: string
  value: string
  onCommit: (v: string) => void
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="color"
        className="h-8 w-full cursor-pointer p-1"
        value={value}
        onChange={(e) => onCommit(e.target.value)}
      />
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-medium text-muted-foreground">{children}</div>
}

// ---------------------------------------------------------------------------
// Font ayarları (text + field ortak)
// ---------------------------------------------------------------------------

function FontControls({
  font,
  fit,
  onFont,
  onFit,
}: {
  font: FontSpec
  fit: TextFit
  onFont: (patch: Partial<FontSpec>) => void
  onFit: (fit: TextFit) => void
}) {
  return (
    <div className="space-y-2">
      <SectionTitle>Yazı</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        <NumField
          label="Punto"
          value={font.sizePt}
          min={4}
          max={72}
          onCommit={(v) => onFont({ sizePt: v })}
        />
        <ColorField label="Renk" value={font.color} onCommit={(v) => onFont({ color: v })} />
      </div>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant={font.bold ? "secondary" : "outline"}
          size="icon"
          className="h-8 w-8"
          onClick={() => onFont({ bold: !font.bold })}
          aria-label="Kalın"
        >
          <Bold className="h-3.5 w-3.5" />
        </Button>
        {(
          [
            ["left", AlignLeft],
            ["center", AlignCenter],
            ["right", AlignRight],
          ] as const
        ).map(([align, Icon]) => (
          <Button
            key={align}
            type="button"
            variant={font.align === align ? "secondary" : "outline"}
            size="icon"
            className="h-8 w-8"
            onClick={() => onFont({ align: align as TextAlign })}
            aria-label={`Hizala: ${align}`}
          >
            <Icon className="h-3.5 w-3.5" />
          </Button>
        ))}
        <Select value={fit} onValueChange={(v) => onFit(v as TextFit)}>
          <SelectTrigger className="ml-auto h-8 w-[104px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="shrink">Sığdır</SelectItem>
            <SelectItem value="wrap">Satır Kaydır</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tip-özel bölümler
// ---------------------------------------------------------------------------

function TextProps({ el, patch }: { el: TextElement; patch: (p: Partial<LabelElement>) => void }) {
  const [text, setText] = useState(el.text)
  useEffect(() => setText(el.text), [el.id, el.text])
  return (
    <div className="space-y-2">
      <SectionTitle>Metin</SectionTitle>
      <Textarea
        value={text}
        rows={2}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== el.text && patch({ text })}
      />
      <FontControls
        font={el.font}
        fit={el.fit}
        onFont={(p) => patch({ font: { ...el.font, ...p } })}
        onFit={(fit) => patch({ fit })}
      />
    </div>
  )
}

function FieldProps({ el, patch }: { el: FieldElement; patch: (p: Partial<LabelElement>) => void }) {
  const isPrice = el.fieldKey === "salePrice" || el.fieldKey === "salePriceWithVat"
  const [prefix, setPrefix] = useState(el.prefix ?? "")
  const [suffix, setSuffix] = useState(el.suffix ?? "")
  useEffect(() => {
    setPrefix(el.prefix ?? "")
    setSuffix(el.suffix ?? "")
  }, [el.id, el.prefix, el.suffix])

  return (
    <div className="space-y-2">
      <SectionTitle>Ürün Alanı</SectionTitle>
      <Select
        value={el.fieldKey}
        onValueChange={(v) => {
          const nextIsPrice = v === "salePrice" || v === "salePriceWithVat"
          patch({
            fieldKey: v as FieldElement["fieldKey"],
            price: nextIsPrice ? el.price ?? { decimals: 2, showCurrency: true } : undefined,
          })
        }}
      >
        <SelectTrigger className="h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PRODUCT_FIELDS.map((f) => (
            <SelectItem key={f.key} value={f.key}>
              {f.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Önek</Label>
          <Input
            className="h-8"
            value={prefix}
            maxLength={50}
            onChange={(e) => setPrefix(e.target.value)}
            onBlur={() => (prefix || undefined) !== el.prefix && patch({ prefix: prefix || undefined })}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Sonek</Label>
          <Input
            className="h-8"
            value={suffix}
            maxLength={50}
            onChange={(e) => setSuffix(e.target.value)}
            onBlur={() => (suffix || undefined) !== el.suffix && patch({ suffix: suffix || undefined })}
          />
        </div>
      </div>
      {isPrice && (
        <div className="grid grid-cols-2 items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Ondalık</Label>
            <Select
              value={String(el.price?.decimals ?? 2)}
              onValueChange={(v) =>
                patch({ price: { decimals: Number(v), showCurrency: el.price?.showCurrency ?? true } })
              }
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[0, 1, 2, 3, 4].map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {d} hane
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex h-8 items-center gap-2 text-xs">
            <Switch
              checked={el.price?.showCurrency ?? true}
              onCheckedChange={(v) =>
                patch({ price: { decimals: el.price?.decimals ?? 2, showCurrency: v } })
              }
            />
            Para birimi (₺)
          </label>
        </div>
      )}
      <FontControls
        font={el.font}
        fit={el.fit}
        onFont={(p) => patch({ font: { ...el.font, ...p } })}
        onFit={(fit) => patch({ fit })}
      />
    </div>
  )
}

function CustomValueField({
  value,
  onCommit,
  maxLength,
}: {
  value: string
  onCommit: (v: string) => void
  maxLength: number
}) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <div className="space-y-1">
      <Label className="text-xs">Özel değer</Label>
      <Input
        className="h-8"
        value={text}
        maxLength={maxLength}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => text !== value && onCommit(text)}
      />
    </div>
  )
}

function BarcodeProps({
  el,
  patch,
}: {
  el: BarcodeElement
  patch: (p: Partial<LabelElement>) => void
}) {
  return (
    <div className="space-y-2">
      <SectionTitle>Barkod</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Kaynak</Label>
          <Select
            value={el.source}
            onValueChange={(v) => patch({ source: v as BarcodeElement["source"] })}
          >
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="barcode">Ürün barkodu</SelectItem>
              <SelectItem value="code">Ürün kodu</SelectItem>
              <SelectItem value="custom">Özel değer</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Tip</Label>
          <Select
            value={el.symbology}
            onValueChange={(v) => patch({ symbology: v as BarcodeElement["symbology"] })}
          >
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Otomatik</SelectItem>
              <SelectItem value="ean13">EAN-13</SelectItem>
              <SelectItem value="code128">Code 128</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {el.source === "custom" && (
        <CustomValueField
          value={el.customValue ?? ""}
          maxLength={80}
          onCommit={(v) => patch({ customValue: v || undefined })}
        />
      )}
      <label className="flex items-center gap-2 text-xs">
        <Switch checked={el.showText} onCheckedChange={(v) => patch({ showText: v })} />
        Rakamları altına yaz
      </label>
    </div>
  )
}

function QrProps({ el, patch }: { el: QrElement; patch: (p: Partial<LabelElement>) => void }) {
  return (
    <div className="space-y-2">
      <SectionTitle>QR Kod</SectionTitle>
      <div className="space-y-1">
        <Label className="text-xs">Kaynak</Label>
        <Select value={el.source} onValueChange={(v) => patch({ source: v as QrElement["source"] })}>
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="barcode">Ürün barkodu</SelectItem>
            <SelectItem value="code">Ürün kodu</SelectItem>
            <SelectItem value="name">Ürün adı</SelectItem>
            <SelectItem value="custom">Özel değer</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {el.source === "custom" && (
        <CustomValueField
          value={el.customValue ?? ""}
          maxLength={500}
          onCommit={(v) => patch({ customValue: v || undefined })}
        />
      )}
    </div>
  )
}

function ShapeProps({ el, patch }: { el: ShapeElement; patch: (p: Partial<LabelElement>) => void }) {
  return (
    <div className="space-y-2">
      <SectionTitle>
        {el.shape === "line" ? "Çizgi" : el.shape === "rect" ? "Kutu" : "Daire"}
      </SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        <ColorField
          label="Çizgi rengi"
          value={el.strokeColor}
          onCommit={(v) => patch({ strokeColor: v })}
        />
        <NumField
          label="Kalınlık (mm)"
          value={el.strokeWidthMm}
          min={0.1}
          max={5}
          step={0.1}
          onCommit={(v) => patch({ strokeWidthMm: v })}
        />
      </div>
      <label className="flex items-center gap-2 text-xs">
        <Switch checked={el.dashed} onCheckedChange={(v) => patch({ dashed: v })} />
        Kesik çizgi
      </label>
      {el.shape !== "line" && (
        <div className="grid grid-cols-2 items-end gap-2">
          <label className="flex h-8 items-center gap-2 text-xs">
            <Switch
              checked={el.fillColor != null}
              onCheckedChange={(v) => patch({ fillColor: v ? "#ffff00" : null })}
            />
            Dolgu
          </label>
          {el.fillColor != null && (
            <ColorField
              label="Dolgu rengi"
              value={el.fillColor}
              onCommit={(v) => patch({ fillColor: v })}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sayfa ayarları
// ---------------------------------------------------------------------------

function PageProps({ api }: { api: DesignerApi }) {
  const page = api.design.page
  const cap = page.labelType === "A4" ? a4GridCapacity(page) : null
  return (
    <div className="space-y-3">
      <SectionTitle>Sayfa Ayarları</SectionTitle>
      <div className="space-y-1">
        <Label className="text-xs">Etiket tipi</Label>
        <Select
          value={page.labelType}
          onValueChange={(v) => api.setPage({ labelType: v as "ROLL" | "A4" })}
        >
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ROLL">Rulo (termal yazıcı)</SelectItem>
            <SelectItem value="A4">A4 yapışkanlı yaprak</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumField
          label="Genişlik (mm)"
          value={page.widthMm}
          min={5}
          max={210}
          onCommit={(v) => api.setPage({ widthMm: v })}
        />
        <NumField
          label="Yükseklik (mm)"
          value={page.heightMm}
          min={5}
          max={297}
          onCommit={(v) => api.setPage({ heightMm: v })}
        />
      </div>
      {page.labelType === "ROLL" ? (
        <div className="grid grid-cols-2 gap-2">
          <NumField
            label="Yanyana etiket"
            value={page.columns}
            min={1}
            max={12}
            step={1}
            onCommit={(v) => api.setPage({ columns: Math.round(v) })}
          />
          <NumField
            label="Ara boşluk (mm)"
            value={page.gapXMm}
            min={0}
            max={50}
            onCommit={(v) => api.setPage({ gapXMm: v })}
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <NumField
              label="Yatay boşluk (mm)"
              value={page.gapXMm}
              min={0}
              max={50}
              onCommit={(v) => api.setPage({ gapXMm: v })}
            />
            <NumField
              label="Dikey boşluk (mm)"
              value={page.gapYMm}
              min={0}
              max={50}
              onCommit={(v) => api.setPage({ gapYMm: v })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumField
              label="Üst kenar (mm)"
              value={page.a4?.marginTopMm ?? 10}
              min={0}
              max={50}
              onCommit={(v) =>
                api.setPage({ a4: { marginTopMm: v, marginLeftMm: page.a4?.marginLeftMm ?? 5 } })
              }
            />
            <NumField
              label="Sol kenar (mm)"
              value={page.a4?.marginLeftMm ?? 5}
              min={0}
              max={50}
              onCommit={(v) =>
                api.setPage({ a4: { marginTopMm: page.a4?.marginTopMm ?? 10, marginLeftMm: v } })
              }
            />
          </div>
          {cap && (
            <p className="text-xs text-muted-foreground">
              Sayfa düzeni: {cap.cols} × {cap.rows} = {cap.cols * cap.rows} etiket/sayfa
            </p>
          )}
        </>
      )}
      <p className="text-xs text-muted-foreground">
        Bir öğeyi seçince burada öğe özellikleri gösterilir.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function PropertiesPanel({ api }: { api: DesignerApi }) {
  const el = api.selectedElement

  if (!el) {
    return (
      <div className="h-full overflow-y-auto p-3">
        <PageProps api={api} />
      </div>
    )
  }

  const patch = (p: Partial<LabelElement>) => api.patchElement(el.id, p)

  return (
    <div className="h-full space-y-4 overflow-y-auto p-3">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => api.reorderZ(el.id, "up")}
          aria-label="Öne getir"
          title="Öne getir"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => api.reorderZ(el.id, "down")}
          aria-label="Arkaya gönder"
          title="Arkaya gönder"
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8"
          onClick={() => api.duplicateElement(el.id)}
          aria-label="Çoğalt"
          title="Çoğalt (Ctrl+D)"
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="ml-auto h-8 w-8 text-destructive"
          onClick={() => api.deleteElement(el.id)}
          aria-label="Sil"
          title="Sil (Delete)"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="space-y-2">
        <SectionTitle>Konum ve Boyut (mm)</SectionTitle>
        <div className="grid grid-cols-2 gap-2">
          <NumField label="X" value={el.x} min={-el.w + 1} max={api.design.page.widthMm - 1} onCommit={(v) => patch({ x: v })} />
          <NumField label="Y" value={el.y} min={-el.h + 1} max={api.design.page.heightMm - 1} onCommit={(v) => patch({ y: v })} />
          <NumField label="Genişlik" value={el.w} min={1} max={210} onCommit={(v) => patch({ w: v })} />
          <NumField label="Yükseklik" value={el.h} min={1} max={297} onCommit={(v) => patch({ h: v })} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Döndürme</Label>
          <Select
            value={String(el.rotation)}
            onValueChange={(v) => patch({ rotation: Number(v) as LabelRotation })}
          >
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[0, 90, 180, 270].map((r) => (
                <SelectItem key={r} value={String(r)}>
                  {r}°
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {el.type === "text" && <TextProps el={el} patch={patch} />}
      {el.type === "field" && <FieldProps el={el} patch={patch} />}
      {el.type === "barcode" && <BarcodeProps el={el} patch={patch} />}
      {el.type === "qr" && <QrProps el={el} patch={patch} />}
      {el.type === "shape" && <ShapeProps el={el} patch={patch} />}
      {el.type === "image" && (
        <p className="text-xs text-muted-foreground">
          Görsel öğesi — boyutunu tutamaçlarla ya da yukarıdaki alanlarla ayarlayın.
        </p>
      )}
    </div>
  )
}
