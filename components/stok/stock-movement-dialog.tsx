"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/components/ui/use-toast"
import { useWarehouses } from "@/lib/swr/use-company-data"
import { toDateInputValue } from "@/lib/stock/movement-date"
import { cn } from "@/lib/utils"
import { ArrowDownToLine, ArrowUpFromLine, ClipboardCheck, Flag } from "lucide-react"

/**
 * MEVCUT bir ürünün stoğunu değiştiren tek pencere.
 *
 * Dört kip, çünkü kullanıcının sorduğu dört ayrı soru var ve üçü tek bir "miktar"
 * alanına sığmıyor:
 *
 *  • Giriş  — "50 adet mal geldi"        → bakiyeye EKLER (IN)
 *  • Çıkış  — "3 adet kırıldı/zayi"      → bakiyeden DÜŞER (OUT)
 *  • Sayım  — "rafta 47 adet var"        → seçili depoyu HEDEFE çeker (ADJUSTMENT)
 *  • Açılış — "başlangıç stoğu yanlıştı" → ilk hareketi düzeltir (yeni hareket YAZMAZ)
 *
 * Giriş/Çıkış ile Sayım'ı ayırmanın sebebi: "miktar" alanına 47 yazan kullanıcı
 * kimi zaman 47 EKLEMEK, kimi zaman 47 OLMASINI ister. Tek alanda sorulunca
 * yanlış anlaşılan tarafta stok iki katına çıkıyor ve hata ancak sayımda görülüyor.
 * Açılış ise hiç hareket değil: geçmişi düzeltir (bkz. lib/stock/opening-stock.ts).
 */

export type StockMovementMode = "IN" | "OUT" | "COUNT" | "OPENING"

export interface StockMovementProduct {
  id: string
  name: string
  unit: string
  stockQuantity: number | string
  /** Giriş fişinde birim maliyet önerisi için. */
  purchasePrice?: number | string | null
}

interface StockMovementDialogProps {
  companyId: string
  product: StockMovementProduct
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Kayıt sonrası çağrılır — çağıran ekran listesini/kartını tazeler. */
  onSaved?: () => void
  /** Pencere hangi sekmeyle açılsın. */
  initialMode?: StockMovementMode
}

type WarehouseRow = { warehouseId: string; warehouseName: string; quantity: number }

type OpeningInfo = {
  quantity: number
  unitPrice: number | null
  warehouseId: string | null
  date: string | null
  tracked: boolean
}

const fmtQty = (n: number) =>
  new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 4 }).format(
    Math.round(n * 10000) / 10000,
  )

const MODE_LABELS: Record<StockMovementMode, string> = {
  IN: "Giriş",
  OUT: "Çıkış",
  COUNT: "Sayım",
  OPENING: "Açılış",
}

export function StockMovementDialog({
  companyId,
  product,
  open,
  onOpenChange,
  onSaved,
  initialMode = "IN",
}: StockMovementDialogProps) {
  const { toast } = useToast()
  const { warehouses } = useWarehouses(open ? companyId : null)

  const [mode, setMode] = useState<StockMovementMode>(initialMode)
  const [warehouseId, setWarehouseId] = useState("")
  const [quantity, setQuantity] = useState("")
  const [unitPrice, setUnitPrice] = useState("")
  const [date, setDate] = useState("")
  const [description, setDescription] = useState("")
  const [isLoading, setIsLoading] = useState(false)

  const [rows, setRows] = useState<WarehouseRow[]>([])
  /**
   * Depo bakiyesi OKUNDU mu? Pencere açık kaldığı için (detay sayfasında bileşen
   * mount'ta duruyor) bir önceki açılıştan kalan sayı, yenisi gelene kadar ekranda
   * duruyordu: 150'ye çıkmış bir ürün "100" gösteriyordu. Sayım hedefi bu sayıdan
   * okunduğu için ÖNİZLEME yanlış çıkıyordu (kayıt doğruydu — farkı sunucu kendi
   * bakiyesinden hesaplıyor), yine de kullanıcıya yanlış sayı göstermemek gerek.
   */
  const [rowsLoaded, setRowsLoaded] = useState(false)
  const [opening, setOpening] = useState<OpeningInfo | null>(null)

  const cardQuantity = Number(product.stockQuantity) || 0

  /** Ürünün depo bazlı bakiyesi — sayım hedefi ve çıkış denetimi buna dayanır. */
  const loadRows = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/depolar/stok?companyId=${companyId}&productId=${product.id}`,
        { cache: "no-store" },
      )
      if (!res.ok) return
      const data = await res.json()
      setRows(
        (Array.isArray(data?.stocks) ? data.stocks : []).map((s: any) => ({
          warehouseId: s.warehouseId,
          warehouseName: s.warehouseName,
          quantity: Number(s.quantity) || 0,
        })),
      )
    } catch {
      /* bakiye dökümü gösterilemezse pencere yine çalışır */
    } finally {
      setRowsLoaded(true)
    }
  }, [companyId, product.id])

  const loadOpening = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/stok/products/${product.id}/opening-stock?companyId=${companyId}`,
        { cache: "no-store" },
      )
      if (!res.ok) return
      const data = await res.json()
      setOpening({
        quantity: Number(data.quantity) || 0,
        unitPrice: data.unitPrice == null ? null : Number(data.unitPrice),
        warehouseId: data.warehouseId ?? null,
        date: data.date ?? null,
        tracked: Boolean(data.tracked),
      })
    } catch {
      /* açılış okunamazsa sekme "bilinmiyor" hâlinde kalır */
    }
  }, [companyId, product.id])

  // Pencere her açıldığında formu ve okunan verileri sıfırla: kapatılıp başka bir
  // ürün için açıldığında önceki üründen kalan miktar/depo görünüyordu.
  useEffect(() => {
    if (!open) return
    setMode(initialMode)
    setQuantity("")
    setUnitPrice("")
    setDescription("")
    setDate("")
    setOpening(null)
    setRows([])
    setRowsLoaded(false)
    loadRows()
    loadOpening()
  }, [open, initialMode, loadRows, loadOpening])

  // Varsayılan depo: ürünün stoğunun DURDUĞU depo (en çok bakiye), yoksa firmanın
  // ana deposu. "İlk depo" seçmek, malın olmadığı depoya çıkış yazdırırdı.
  useEffect(() => {
    if (!open || warehouses.length === 0) return
    setWarehouseId((current) => {
      if (current && warehouses.some((w) => w.id === current)) return current
      const withStock = rows.filter((r) => r.quantity !== 0)
      if (withStock.length > 0) {
        return withStock.reduce((a, b) => (b.quantity > a.quantity ? b : a)).warehouseId
      }
      return warehouses.find((w) => w.isDefault)?.id ?? warehouses[0].id
    })
  }, [open, warehouses, rows])

  // Sekme değişince alanlar sıfırlanır: Açılış sekmesindeki 120, Giriş sekmesine
  // geçildiğinde "120 adet daha ekle" anlamına gelirdi.
  useEffect(() => {
    if (!open) return
    setQuantity("")
    setUnitPrice("")
    setDate("")
  }, [open, mode])

  // Açılış sekmesi kendi kayıtlı değerleriyle dolar (miktar HEDEF olduğu için
  // boş bırakılamaz: boş alan "0 yap" demekle karışırdı).
  useEffect(() => {
    if (!open || mode !== "OPENING" || !opening) return
    setQuantity(String(opening.quantity))
    setUnitPrice(opening.unitPrice == null ? "" : String(opening.unitPrice))
    setDate(toDateInputValue(opening.date))
    if (opening.warehouseId) setWarehouseId(opening.warehouseId)
  }, [open, mode, opening])

  const warehouseQuantity = useMemo(() => {
    const row = rows.find((r) => r.warehouseId === warehouseId)
    if (row) return row.quantity
    // Hiç depo satırı yoksa bakiye kartta duruyordur ve ilk işlemde ANA depoya
    // taşınır (sunucu tarafı: materializeLegacyStock). Kuralı burada birebir
    // tekrarlıyoruz; yoksa önizleme ile sunucunun bulduğu fark ayrışır.
    if (rows.length === 0) {
      const defaultId = warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]?.id
      return warehouseId === defaultId ? cardQuantity : 0
    }
    return 0
  }, [rows, warehouseId, cardQuantity, warehouses])

  const typed = quantity === "" ? null : Number(quantity)
  const typedValid = typed != null && Number.isFinite(typed) && typed >= 0

  /** Kaydedilirse kartın yeni bakiyesi — kullanıcı basmadan önce görsün. */
  const projected = useMemo(() => {
    if (!typedValid || typed == null) return null
    if (mode === "IN") return cardQuantity + typed
    if (mode === "OUT") return cardQuantity - typed
    if (mode === "COUNT") return rowsLoaded ? cardQuantity + (typed - warehouseQuantity) : null
    if (mode === "OPENING" && opening) return cardQuantity + (typed - opening.quantity)
    return null
  }, [mode, typed, typedValid, cardQuantity, warehouseQuantity, opening, rowsLoaded])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!typedValid || typed == null) {
      toast({ title: "Miktar girin", variant: "destructive" })
      return
    }
    if (mode !== "OPENING" && !warehouseId) {
      toast({ title: "Depo seçin", variant: "destructive" })
      return
    }
    if (mode === "COUNT" && !rowsLoaded) {
      toast({ title: "Depo bakiyesi henüz okunmadı", description: "Bir saniye bekleyin." })
      return
    }
    if ((mode === "IN" || mode === "OUT") && typed === 0) {
      toast({ title: "Miktar sıfır olamaz", variant: "destructive" })
      return
    }

    setIsLoading(true)
    try {
      const res =
        mode === "OPENING"
          ? await fetch(`/api/stok/products/${product.id}/opening-stock`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                companyId,
                quantity: typed,
                unitPrice: unitPrice === "" ? null : unitPrice,
                warehouseId: warehouseId || undefined,
                // Tarih DOKUNULMADIYSA gönderilmez: gövdede tarih varsa sunucu
                // hareketi yeniden damgalar ve açılış, aynı gün yapılmış işlemlerin
                // arkasına düşerdi (miktarı düzeltmek isteyen kullanıcı defterin
                // sırasını bozuyordu).
                date: date && date !== toDateInputValue(opening?.date ?? null) ? date : undefined,
              }),
            })
          : await fetch("/api/stok/movements", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                companyId,
                productId: product.id,
                type: mode === "COUNT" ? "ADJUSTMENT" : mode,
                // Sayımda hedef SEÇİLİ DEPONUN bakiyesidir; sunucu farkı kendisi bulur.
                scope: mode === "COUNT" ? "WAREHOUSE" : undefined,
                quantity: typed,
                unitPrice: mode === "IN" && unitPrice !== "" ? unitPrice : undefined,
                warehouseId,
                date: date || undefined,
                description: description.trim() || defaultDescription(mode),
              }),
            })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || "İşlem kaydedilemedi")

      toast({
        title: "Stok güncellendi",
        description: `${product.name}: ${fmtQty(Number(data?.stockQuantity ?? projected ?? cardQuantity))} ${product.unit}`,
      })
      onOpenChange(false)
      onSaved?.()
    } catch (error) {
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : "Bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const quantityLabel =
    mode === "COUNT"
      ? "Sayılan miktar (depoda kaç var?)"
      : mode === "OPENING"
        ? "Açılış miktarı"
        : "Miktar"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Stok Hareketi</DialogTitle>
          <DialogDescription>
            {product.name} — mevcut stok{" "}
            <span className="font-semibold text-foreground">
              {fmtQty(cardQuantity)} {product.unit}
            </span>
          </DialogDescription>
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => setMode(v as StockMovementMode)}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="IN" disabled={isLoading}>
              <ArrowDownToLine className="mr-1 h-3.5 w-3.5" /> Giriş
            </TabsTrigger>
            <TabsTrigger value="OUT" disabled={isLoading}>
              <ArrowUpFromLine className="mr-1 h-3.5 w-3.5" /> Çıkış
            </TabsTrigger>
            <TabsTrigger value="COUNT" disabled={isLoading}>
              <ClipboardCheck className="mr-1 h-3.5 w-3.5" /> Sayım
            </TabsTrigger>
            <TabsTrigger value="OPENING" disabled={isLoading}>
              <Flag className="mr-1 h-3.5 w-3.5" /> Açılış
            </TabsTrigger>
          </TabsList>

        </Tabs>

        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          {modeHint(mode, opening)}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sm-warehouse">Depo</Label>
              <select
                id="sm-warehouse"
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                disabled={isLoading || warehouses.length === 0}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                    {w.isDefault ? " (Ana)" : ""}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                Bu depodaki bakiye:{" "}
                {rowsLoaded ? `${fmtQty(warehouseQuantity)} ${product.unit}` : "…"}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="sm-quantity">{quantityLabel}</Label>
              <Input
                id="sm-quantity"
                type="number"
                step="any"
                min="0"
                autoFocus
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                disabled={isLoading}
              />
              {projected != null && (
                <p
                  className={cn(
                    "text-xs",
                    projected < 0 ? "font-medium text-red-600" : "text-muted-foreground",
                  )}
                >
                  Yeni toplam stok: {fmtQty(projected)} {product.unit}
                  {projected < 0 && " — negatif bakiye kaydedilemez"}
                </p>
              )}
            </div>

            {(mode === "IN" || mode === "OPENING") && (
              <div className="space-y-2">
                <Label htmlFor="sm-price">Birim maliyet</Label>
                <Input
                  id="sm-price"
                  type="number"
                  step="any"
                  min="0"
                  placeholder={
                    product.purchasePrice ? String(Number(product.purchasePrice)) : "0,00"
                  }
                  value={unitPrice}
                  onChange={(e) => setUnitPrice(e.target.value)}
                  disabled={isLoading}
                />
                <p className="text-xs text-muted-foreground">
                  Girilirse ortalama maliyete (AVCO) katılır; boş bırakılabilir.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="sm-date">
                {mode === "OPENING" ? "Açılış tarihi" : "Hareket tarihi"}
              </Label>
              <Input
                id="sm-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                max={toDateInputValue(new Date())}
                disabled={isLoading}
              />
              <p className="text-xs text-muted-foreground">
                Boş bırakılırsa {mode === "OPENING" ? "mevcut tarih korunur" : "bugün yazılır"}.
              </p>
            </div>
          </div>

          {mode !== "OPENING" && (
            <div className="space-y-2">
              <Label htmlFor="sm-description">Açıklama</Label>
              <Textarea
                id="sm-description"
                rows={2}
                placeholder={defaultDescription(mode)}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={isLoading}
              />
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
            >
              İptal
            </Button>
            <Button type="submit" disabled={isLoading || !typedValid}>
              {isLoading ? "Kaydediliyor..." : `${MODE_LABELS[mode]} kaydet`}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function defaultDescription(mode: StockMovementMode): string {
  if (mode === "IN") return "Stok girişi"
  if (mode === "OUT") return "Stok çıkışı"
  return "Sayım düzeltmesi"
}

function modeHint(mode: StockMovementMode, opening: OpeningInfo | null): string {
  if (mode === "IN") return "Girilen miktar mevcut stoğa EKLENİR."
  if (mode === "OUT") return "Girilen miktar mevcut stoktan DÜŞÜLÜR (fire, zayi, numune)."
  if (mode === "COUNT") {
    return "Seçili depoda sayılan miktarı yazın; aradaki fark düzeltme hareketi olarak işlenir."
  }
  if (!opening) return "Açılış bilgisi okunuyor…"
  if (!opening.tracked && opening.quantity === 0) {
    return "Bu üründe açılış stoğu yok. Girerseniz ürünün başlangıç hareketi oluşturulur."
  }
  if (!opening.tracked) {
    return (
      `Bu ürünün açılışı (${fmtQty(opening.quantity)}) defterde hareket olarak durmuyor — ` +
      "eski kayıt. Kaydedince açılış hareketi oluşturulur, bakiye yalnız FARK kadar değişir."
    )
  }
  return (
    `Kayıtlı açılış: ${fmtQty(opening.quantity)}. Yeni hareket yazılmaz; ilk hareket düzeltilir ` +
    "ve fark güncel bakiyeye yansır."
  )
}
