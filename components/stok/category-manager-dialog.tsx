"use client"

/**
 * Ürün kategorisi yönetimi — Stok ve Menü & Reçeteler ekranlarının ORTAK parçası.
 *
 * Ayrı bir bileşen olmasının sebebi tekrar değil, AYRIŞMA riski: kategori iki
 * yerde yaşıyor (firma tanımı = öneri listesi + ürünün kendi `category` metni)
 * ve "sil" ikisine birden dokunmak zorunda. İki ekranda iki kopya olsaydı biri
 * ürün tarafını unuttuğu anda kullanıcı yine "sildim ama satış ekranında duruyor"
 * derdi — bu hatanın ta kendisi zaten yaşandı.
 *
 * Bileşen kendi verisini çeker; çağıran yalnızca `onChanged` ile kendi ürün
 * listesini tazeler.
 */

import { useCallback, useEffect, useState } from "react"
import { Check, Plus, Trash2, Pencil, X } from "lucide-react"
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
import { TextCombobox } from "@/components/ui/text-combobox"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"

type CategoryRow = {
  label: string
  /** Firma tanımı id'si; null ise kategori yalnızca ürünlerin üzerinde yazıyor. */
  id: string | null
  count: number
}

export function CategoryManagerDialog({
  open,
  onOpenChange,
  companyId,
  onChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  companyId: string
  /** Kategori eklendi/silindi/taşındı — çağıran ürün listesini tazelesin. */
  onChanged?: () => void
}) {
  const { toast } = useToast()
  const { confirm } = useConfirm()

  const [rows, setRows] = useState<CategoryRow[]>([])
  const [newLabel, setNewLabel] = useState("")
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<CategoryRow | null>(null)
  const [editTarget, setEditTarget] = useState("")

  /**
   * İki kaynak birleştirilir: öneri listesi (firma tanımı) ve ürünlerin üzerindeki
   * kategori metni. İkincisi olmadan, ürüne elle yazılmış (ya da içe aktarımdan
   * gelmiş) kategoriler bu pencerede HİÇ görünmüyordu — ama satış ekranında
   * sekme olarak duruyorlardı, yani silinemiyorlardı.
   *
   * Sayım sunucudan gelir: ekranlardaki ürün listeleri arama/sekme filtresine
   * bağlı, onlardan saymak yanlış rakam gösterirdi.
   */
  const load = useCallback(async () => {
    if (!companyId) return
    try {
      const [defRes, countRes] = await Promise.all([
        fetch(`/api/company/definitions?companyId=${companyId}&type=PRODUCT_CATEGORY`, {
          cache: "no-store",
        }),
        fetch(`/api/stok/products/category?companyId=${companyId}`, { cache: "no-store" }),
      ])
      const defs: Array<{ id: string; label: string }> = defRes.ok ? await defRes.json() : []
      const counts: Array<{ category: string; count: number }> = countRes.ok
        ? await countRes.json()
        : []

      const map = new Map<string, CategoryRow>()
      for (const d of defs) map.set(d.label, { label: d.label, id: d.id, count: 0 })
      for (const c of counts) {
        const row = map.get(c.category)
        if (row) row.count = Number(c.count) || 0
        else map.set(c.category, { label: c.category, id: null, count: Number(c.count) || 0 })
      }
      setRows(
        Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, "tr-TR"))
      )
    } catch {
      /* sessizce geç — pencere boş açılır */
    }
  }, [companyId])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const finish = async () => {
    await load()
    onChanged?.()
  }

  const addCategory = async () => {
    const label = newLabel.trim()
    if (!label || !companyId) return
    setSaving(true)
    try {
      const res = await fetch(`/api/company/definitions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, type: "PRODUCT_CATEGORY", label }),
      })
      const data = await res.json().catch(() => ({}) as any)
      if (!res.ok) throw new Error(data?.error || "Kategori eklenemedi")
      setNewLabel("")
      await finish()
    } catch (e) {
      toast({
        title: "Hata",
        description: e instanceof Error ? e.message : "Kategori eklenemedi",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  /**
   * Yeniden adlandırma ve birleştirme AYNI işlem; tek fark hedefin zaten var
   * olup olmaması. Ürün tarafında ikisi de tek `updateMany`.
   */
  const applyRename = async () => {
    if (!editing) return
    const from = editing.label
    const to = editTarget.trim()
    if (!to || to === from) {
      setEditing(null)
      return
    }
    const merging = rows.some((r) => r.label === to)
    const ok = await confirm({
      title: merging ? "Kategorileri birleştir" : "Kategoriyi yeniden adlandır",
      description: merging
        ? `"${from}" kategorisindeki ${editing.count} ürün "${to}" kategorisine taşınacak ve "${from}" kalkacak. Ürünler silinmez.`
        : `"${from}" kategorisi "${to}" olarak değiştirilecek. ${editing.count} ürün etkilenecek.`,
      confirmLabel: merging ? "Birleştir" : "Değiştir",
    })
    if (!ok) return
    setSaving(true)
    try {
      if (editing.count > 0) {
        const res = await fetch(`/api/stok/products/category`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, from, to }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data?.error || "Ürünler taşınamadı")
        }
      }
      if (editing.id) {
        // Birleştirmede kaynak tanım silinir (hedef zaten listede),
        // adlandırmada etiketi güncellenir.
        const res = merging
          ? await fetch(`/api/company/definitions/${editing.id}`, { method: "DELETE" })
          : await fetch(`/api/company/definitions/${editing.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ label: to }),
            })
        if (!res.ok) throw new Error("Kategori listesi güncellenemedi")
      }
      setEditing(null)
      setEditTarget("")
      await finish()
      toast({
        title: merging ? "Kategoriler birleştirildi" : "Kategori yeniden adlandırıldı",
        description: `${from} → ${to}${editing.count > 0 ? ` (${editing.count} ürün)` : ""}`,
      })
    } catch (e) {
      toast({
        title: "Hata",
        description: e instanceof Error ? e.message : "İşlem tamamlanamadı",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  /**
   * Hem öneri listesinden hem ÜRÜNLERİN üzerinden siler. Yalnızca tanımı silmek
   * yetmiyor: satış/adisyon ekranındaki kategori sekmeleri ürünlerden üretiliyor,
   * etiket üründe kalırsa sekme de kalıyordu.
   */
  const deleteCategory = async (row: CategoryRow) => {
    const ok = await confirm({
      title: "Kategoriyi sil",
      description:
        row.count > 0
          ? `"${row.label}" kategorisi ${row.count} üründe kullanılıyor. Silinirse bu ürünlerin kategorisi boşaltılacak ve satış ekranındaki "${row.label}" sekmesi kaybolacak. Ürünler silinmez.`
          : `"${row.label}" kategorisini silmek istediğinize emin misiniz?`,
      confirmLabel: "Sil",
      variant: "destructive",
    })
    if (!ok) return
    setSaving(true)
    try {
      if (row.count > 0) {
        const res = await fetch(`/api/stok/products/category`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId, from: row.label, to: null }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data?.error || "Ürünlerin kategorisi boşaltılamadı")
        }
      }
      if (row.id) {
        const res = await fetch(`/api/company/definitions/${row.id}`, { method: "DELETE" })
        if (!res.ok) throw new Error("Kategori listeden silinemedi")
      }
      await finish()
      toast({
        title: "Kategori silindi",
        description:
          row.count > 0 ? `${row.label} — ${row.count} ürün kategorisiz kaldı` : row.label,
      })
    } catch (e) {
      toast({
        title: "Hata",
        description: e instanceof Error ? e.message : "Kategori silinemedi",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Kategoriler</DialogTitle>
          <DialogDescription>
            Ürün eklerken bu listeden seçilir. Silmek, kategoriyi kullanan ürünlerin
            kategorisini de boşaltır — satış ekranındaki sekme böyle kalkar.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Yeni kategori adı"
            disabled={saving}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                void addCategory()
              }
            }}
          />
          <Button
            type="button"
            onClick={() => void addCategory()}
            disabled={saving || !newLabel.trim()}
            className="shrink-0"
          >
            <Plus className="mr-1 h-4 w-4" />
            Ekle
          </Button>
        </div>

        {/* Düzenleme paneli kaydırılan listenin DIŞINDA: combobox'ın açılır
            listesi `absolute` ve liste kutusunun `overflow-y-auto`su onu
            kırpardı. Düzenlenen satır listede vurgulanıyor. */}
        {editing && (
          <div className="space-y-2 rounded-md border border-kobipo-blue bg-kobipo-blue/5 p-3 dark:border-primary dark:bg-primary/10">
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{editing.label}</span>
              {editing.count > 0 ? ` (${editing.count} ürün)` : ""} → yeni ad yazın ya da
              birleştirmek için mevcut bir kategori seçin
            </p>
            <div className="flex items-center gap-2">
              <TextCombobox
                value={editTarget}
                onChange={setEditTarget}
                options={rows.filter((r) => r.label !== editing.label).map((r) => r.label)}
                placeholder="Kategori adı"
                emptyText="Başka kategori yok — yazdığınız yeni ad olur"
              />
              <Button
                type="button"
                size="icon"
                className="shrink-0"
                onClick={() => void applyRename()}
                disabled={saving || !editTarget.trim() || editTarget.trim() === editing.label}
                title="Uygula"
              >
                <Check className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="shrink-0"
                onClick={() => {
                  setEditing(null)
                  setEditTarget("")
                }}
                title="Vazgeç"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        <div className="max-h-72 space-y-1 overflow-y-auto">
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Henüz kategori yok</p>
          ) : (
            rows.map((c) => (
              <div
                key={c.label}
                className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ${
                  editing?.label === c.label
                    ? "border-kobipo-blue bg-kobipo-blue/5 dark:border-primary dark:bg-primary/10"
                    : ""
                }`}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">
                    {c.label}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {c.count > 0 ? `${c.count} ürün` : "kullanılmıyor"}
                    </span>
                  </span>
                  {!c.id && (
                    <span className="text-[11px] text-amber-600 dark:text-amber-400">
                      listede tanımlı değil — yalnızca ürünlerde yazıyor
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={saving}
                    onClick={() => {
                      setEditing(c)
                      setEditTarget(c.label)
                    }}
                    title="Yeniden adlandır / birleştir"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={saving}
                    onClick={() => void deleteCategory(c)}
                    title="Kategoriyi sil"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </span>
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Kapat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
