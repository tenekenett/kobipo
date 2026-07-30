"use client"

// Ürün seçeneklerinin (porsiyon / modifier) TANIMLANDIĞI yer — Menü ekranından
// satır bazında açılır. Kararlar: docs/restoran/SATIS-EKRANI.md K6
//
// Kurulum menüde duruyor çünkü seçenek menünün parçası: "Latte'nin boyları"
// sorusunun cevabı ürün kartında değil, menüyü kuran kişinin kafasındadır ve o
// kişi bu ekranda çalışıyor (SADELESTIRME.md "İş 7" ile aynı gerekçe).
//
// Grup bir bütün olarak kaydedilir (şıklar dahil): tek tek şık uçları açmak üç
// uç daha demekti ve kullanıcı zaten grubu bir form olarak dolduruyor.

import { useState } from "react"
import { Loader2, Plus, Trash2 } from "lucide-react"
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
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/use-toast"
import type { OptionGroupView } from "@/lib/restoran/product-options"

type DraftOption = { name: string; priceDelta: string; isDefault: boolean }
type Draft = {
  id: string | null
  name: string
  isRequired: boolean
  isMulti: boolean
  options: DraftOption[]
}

const emptyDraft = (): Draft => ({
  id: null,
  name: "",
  isRequired: false,
  isMulti: false,
  options: [{ name: "", priceDelta: "0", isDefault: true }],
})

const toDraft = (group: OptionGroupView): Draft => ({
  id: group.id,
  name: group.name,
  isRequired: group.isRequired,
  isMulti: group.isMulti,
  options: group.options.map((o) => ({
    name: o.name,
    priceDelta: String(o.priceDelta),
    isDefault: o.isDefault,
  })),
})

export function ProductOptionsDialog({
  open,
  companyId,
  product,
  groups,
  onClose,
  onSaved,
}: {
  open: boolean
  companyId: string
  product: { id: string; name: string } | null
  groups: OptionGroupView[]
  onClose: () => void
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)

  const close = () => {
    setDraft(null)
    onClose()
  }

  const save = async () => {
    if (!draft || !product) return
    const options = draft.options
      .map((o) => ({
        name: o.name.trim(),
        priceDelta: parseFloat(o.priceDelta.replace(",", ".")) || 0,
        isDefault: o.isDefault,
      }))
      .filter((o) => o.name)
    if (!draft.name.trim() || options.length === 0) {
      toast({
        title: "Eksik bilgi",
        description: "Grup adı ve en az bir seçenek gerekli",
        variant: "destructive",
      })
      return
    }
    setSaving(true)
    try {
      const res = await fetch(
        draft.id ? `/api/restoran/urun-secenekleri/${draft.id}` : "/api/restoran/urun-secenekleri",
        {
          method: draft.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId,
            productId: product.id,
            name: draft.name.trim(),
            isRequired: draft.isRequired,
            isMulti: draft.isMulti,
            options,
          }),
        },
      )
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body?.error || "Kaydedilemedi")
      toast({ title: draft.id ? "Seçenek grubu güncellendi" : "Seçenek grubu eklendi" })
      setDraft(null)
      onSaved()
    } catch (e: any) {
      toast({ title: "Kaydedilemedi", description: e.message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const remove = async (groupId: string) => {
    setSaving(true)
    try {
      const res = await fetch(
        `/api/restoran/urun-secenekleri/${groupId}?companyId=${companyId}`,
        { method: "DELETE" },
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.error || "Silinemedi")
      }
      toast({ title: "Seçenek grubu silindi" })
      onSaved()
    } catch (e: any) {
      toast({ title: "Silinemedi", description: e.message, variant: "destructive" })
    } finally {
      setSaving(false)
    }
  }

  const patchOption = (index: number, patch: Partial<DraftOption>) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            options: d.options.map((o, i) =>
              i === index
                ? { ...o, ...patch }
                : // Tek seçimli grupta tek varsayılan olur.
                  patch.isDefault && !d.isMulti
                  ? { ...o, isDefault: false }
                  : o,
            ),
          }
        : d,
    )

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Seçenekler — {product?.name}</DialogTitle>
          <DialogDescription>
            &quot;Boy&quot;, &quot;Süt&quot;, &quot;Ekstra&quot; gibi gruplar. Fiyat farkı KDV
            DAHİL girilir. Seçeneği olmayan ürün satış ekranında tek dokunuşta sepete girer.
          </DialogDescription>
        </DialogHeader>

        {draft ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
              <div>
                <Label className="text-xs text-muted-foreground">Grup adı</Label>
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Boy"
                  className="mt-1.5"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={draft.isRequired}
                  onCheckedChange={(v) => setDraft({ ...draft, isRequired: v })}
                />
                Zorunlu
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={draft.isMulti}
                  onCheckedChange={(v) => setDraft({ ...draft, isMulti: v })}
                />
                Çoklu
              </label>
            </div>

            <div className="space-y-2">
              {draft.options.map((option, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={option.name}
                    onChange={(e) => patchOption(index, { name: e.target.value })}
                    placeholder="Küçük"
                    className="flex-1"
                  />
                  <Input
                    value={option.priceDelta}
                    onChange={(e) => patchOption(index, { priceDelta: e.target.value })}
                    inputMode="decimal"
                    placeholder="0"
                    className="w-24 text-right tabular-nums"
                    title="Fiyat farkı (KDV dahil)"
                  />
                  <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={option.isDefault}
                      onChange={(e) => patchOption(index, { isDefault: e.target.checked })}
                    />
                    varsayılan
                  </label>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setDraft({ ...draft, options: draft.options.filter((_, i) => i !== index) })
                    }
                    title="Seçeneği kaldır"
                  >
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setDraft({
                    ...draft,
                    options: [...draft.options, { name: "", priceDelta: "0", isDefault: false }],
                  })
                }
              >
                <Plus className="mr-1.5 h-4 w-4" />
                Seçenek ekle
              </Button>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setDraft(null)} disabled={saving}>
                Vazgeç
              </Button>
              <Button onClick={() => void save()} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Kaydet
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-2">
            {groups.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Bu üründe seçenek yok.
              </p>
            ) : (
              groups.map((group) => (
                <div key={group.id} className="rounded-lg border p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">
                        {group.name}
                        {group.isRequired && (
                          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                            ZORUNLU
                          </span>
                        )}
                        {group.isMulti && (
                          <span className="ml-1.5 text-[10px] text-muted-foreground">çoklu</span>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {group.options
                          .map((o) => (o.priceDelta ? `${o.name} (+${o.priceDelta})` : o.name))
                          .join(" · ")}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setDraft(toDraft(group))}>
                        Düzenle
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => void remove(group.id)}
                        disabled={saving}
                        title="Grubu sil"
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}

            <DialogFooter className="sm:justify-between">
              <Button variant="outline" onClick={() => setDraft(emptyDraft())}>
                <Plus className="mr-1.5 h-4 w-4" />
                Grup ekle
              </Button>
              <Button onClick={close}>Kapat</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
