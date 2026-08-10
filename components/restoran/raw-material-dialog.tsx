"use client"

// Hammadde oluşturma diyaloğu — Menü & Reçeteler ekranından çağrılır.
//
// Neden ayrı bir diyalog: hammaddenin alanları menü ürününden farklı. Hammaddede
// SATIŞ fiyatı yok (menüde görünmez), buna karşılık ALIŞ fiyatı ve kritik stok
// seviyesi var — maliyet hesabı ve "kritik hammadde" paneli bunlara dayanıyor.
// Tek bir "ürün" formunda birleştirmek her iki tarafta da yarısı anlamsız alanlar
// bırakırdı.
//
// Oluşturulan ürün `isSellable: false` ile kaydedilir: menüde ve hızlı satış
// ızgarasında listelenmez, ama reçetelerde bileşen olarak kullanılabilir ve
// aramayla bulunur. Bkz. docs/restoran/PLAN.md "Adım 2".

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { UNIT_OPTIONS, defaultRecipeUnit, unitFamily, unitShortLabel } from "@/lib/data/units"
import { quickCreateProduct, type CreatedProduct } from "@/lib/stock/quick-create-product"

type RawDraft = {
  name: string
  unit: string
  purchasePrice: string
  minStockLevel: string
  stockQuantity: string
}

const emptyRaw = (): RawDraft => ({
  name: "",
  unit: "KG",
  purchasePrice: "",
  minStockLevel: "",
  stockQuantity: "",
})

export function RawMaterialDialog({
  open,
  onOpenChange,
  companyId,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string | null
  /** Oluşturulan ürün — çağıran listeyi tazeler ve gerekirse satıra yazar. */
  onCreated: (product: CreatedProduct) => void | Promise<void>
}) {
  const [draft, setDraft] = useState<RawDraft>(emptyRaw)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Her açılışta temiz form — önceki hammaddenin adı yeni kayda sızmasın.
  useEffect(() => {
    if (open) {
      setDraft(emptyRaw())
      setError(null)
    }
  }, [open])

  const canSave = Boolean(companyId) && draft.name.trim().length > 0 && !saving
  /** Sayı alanlarının etiketlerinde geçen birim ("lt", "kg", "Adet"). */
  const unitLabel = unitShortLabel(draft.unit)

  async function handleSave() {
    if (!companyId || !canSave) return
    setSaving(true)
    setError(null)
    try {
      const created = await quickCreateProduct({
        companyId,
        name: draft.name,
        unit: draft.unit,
        // Hammadde: reçetede bileşen olarak yaşar, menüde görünmez.
        // İkisi ayrı bayrak — sonradan "Menüde göster"i de açıp aynı kartı hem
        // satabilir hem reçetede kullanabilirsiniz (paket kahve çekirdeği).
        isIngredient: true,
        isSellable: false,
        purchasePrice: draft.purchasePrice.trim() ? draft.purchasePrice.replace(",", ".") : null,
        minStockLevel: draft.minStockLevel.trim() ? draft.minStockLevel.replace(",", ".") : null,
        stockQuantity: draft.stockQuantity.trim() ? draft.stockQuantity.replace(",", ".") : null,
      })
      await onCreated(created)
      onOpenChange(false)
    } catch (e: any) {
      setError(e?.message || "Hammadde eklenemedi")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* max-w-xl: üç sayı alanının altındaki açıklamalar lg genişlikte
          sütun başına 6 satıra sarıyordu. */}
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Yeni Hammadde</DialogTitle>
          {/* Alanların ne işe yaradığı artık kendi altlarında yazıyor; burada
              tekrar etmek başlığı uzatıp asıl ayrımı (menüde görünmez) gölgeliyordu. */}
          <DialogDescription>
            Menüde ve satış ızgarasında görünmez; yalnızca reçetelerde bileşen olarak kullanılır.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="raw-name">Ad</Label>
              <Input
                id="raw-name"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Süt, Kahve Çekirdeği, Vanilya Şurubu…"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="raw-unit">Stok Birimi</Label>
              <Select
                value={draft.unit}
                onValueChange={(v) => setDraft((d) => ({ ...d, unit: v }))}
              >
                <SelectTrigger id="raw-unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNIT_OPTIONS.map((u) => (
                    <SelectItem key={u.value} value={u.value}>
                      {u.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Stok birimi ile reçete birimi farklı olabilir (süt LT stoklanır,
              reçetede 200 ml geçer) — dönüşüm aynı ölçü ailesi içinde yapılır.
              Aile DIŞI birimlerde (ADET/PAKET/KUTU…) böyle bir dönüşüm yok ve bu,
              kullanıcının ancak reçeteyi yazarken fark ettiği bir kısıttı: birim
              listesi tek seçenekle açılıyor, nedeni hiçbir yerde yazmıyordu. */}
          {unitFamily(draft.unit) ? (
            <p className="rounded-lg bg-muted/60 p-2.5 text-xs text-muted-foreground">
              Stok birimini <strong>aldığınız birimde</strong> seçin (süt için litre, kahve için
              kilogram). Reçetede{" "}
              <strong>{unitShortLabel(defaultRecipeUnit(draft.unit))}</strong> cinsinden
              yazabilirsiniz — aynı ölçü ailesi içinde otomatik çevrilir.
            </p>
          ) : (
            <p className="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
              <strong>{unitShortLabel(draft.unit)}</strong> birimi ölçü ailesine girmez: reçetede de
              yalnızca {unitShortLabel(draft.unit)} (gerekirse ondalık, ör. 0,5) yazabilirsiniz.
              Gramaj/mililitre ile çalışacaksanız stok birimini kilogram veya litre seçin.
            </p>
          )}

          {/* Üç sayı alanı da SEÇİLİ BİRİM cinsindendir; birimi etikete yazmak
              tek başına yetmiyordu — "kritik seviye" ve "açılış stoğu" ilk kez
              hammadde tanımlayan için terim. Her birinin ne işe yaradığı altında
              tek cümleyle duruyor. */}
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="raw-purchase">Alış Fiyatı ({unitLabel} başına)</Label>
              <Input
                id="raw-purchase"
                value={draft.purchasePrice}
                onChange={(e) => setDraft((d) => ({ ...d, purchasePrice: e.target.value }))}
                inputMode="decimal"
                placeholder="0,00"
              />
              <p className="text-xs leading-snug text-muted-foreground">
                1 {unitLabel} için ödediğiniz tutar. Reçete maliyeti ve kâr marjı bundan hesaplanır.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="raw-min">Kritik Seviye ({unitLabel})</Label>
              <Input
                id="raw-min"
                value={draft.minStockLevel}
                onChange={(e) => setDraft((d) => ({ ...d, minStockLevel: e.target.value }))}
                inputMode="decimal"
                placeholder="opsiyonel"
              />
              <p className="text-xs leading-snug text-muted-foreground">
                &quot;Bu kadar kalınca haber ver&quot; sınırı. Altına düşünce satış ekranında uyarı
                çıkar, satış engellenmez. Boş bırakabilirsiniz.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="raw-stock">Açılış Stoğu ({unitLabel})</Label>
              <Input
                id="raw-stock"
                value={draft.stockQuantity}
                onChange={(e) => setDraft((d) => ({ ...d, stockQuantity: e.target.value }))}
                inputMode="decimal"
                placeholder="0"
              />
              <p className="text-xs leading-snug text-muted-foreground">
                Şu anda elinizde olan miktar (sayım sonucu). Sonrası alış ve satışlarla
                kendiliğinden işler.
              </p>
            </div>
          </div>

          {error && (
            <p className="rounded-lg border border-red-300 bg-red-50 p-2.5 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Vazgeç
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Hammaddeyi Ekle
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
