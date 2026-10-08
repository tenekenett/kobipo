"use client"

/**
 * Ürün formundaki kategori / marka seçici: firma tanım listesinden seçilir, "+"
 * ile satır içinde yeni tanım açılıp forma seçilir.
 *
 * Stok ekranındaki ürün formu ve ürün detayındaki düzenleme penceresi AYNI
 * bileşeni kullanır — iki formda iki kopya, biri güncellenip öteki unutulunca
 * "burada var, orada yok" doğuruyordu. Listeyi çağıran tutar (filtre de aynı
 * listeyi kullanıyor); bileşen yalnız yeni tanımı yazıp `onCreated` ile bildirir.
 */

import { useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/use-toast"
import { PRODUCT_GROUP_TEXT, type ProductGroupKind } from "@/lib/stock/product-group"

export function ProductGroupSelect({
  id,
  kind,
  companyId,
  value,
  options,
  onChange,
  onCreated,
  disabled,
}: {
  id?: string
  kind: ProductGroupKind
  companyId: string
  value: string
  /** Seçilebilir etiketler (sıralı). Mevcut değer listede yoksa yine gösterilir. */
  options: string[]
  onChange: (value: string) => void
  /** Yeni tanım yazıldı — çağıran listesine eklesin; değer ayrıca `onChange` ile seçilir. */
  onCreated?: (label: string) => void
  disabled?: boolean
}) {
  const t = PRODUCT_GROUP_TEXT[kind]
  const { toast } = useToast()
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)

  // Kayıtlı değer tanım listesinde yoksa (elle yazılmış / içe aktarılmış eski
  // etiket) seçenek olarak yine durmalı; yoksa select boş görünür ve kaydetmek
  // değeri sessizce silerdi.
  const allOptions = value && !options.includes(value) ? [...options, value] : options

  const create = async () => {
    const label = draft.trim()
    if (!label || !companyId) return
    setSaving(true)
    try {
      const res = await fetch(`/api/company/definitions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, type: t.definitionType, label }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || `${t.Noun} eklenemedi`)
      onCreated?.(label)
      onChange(label)
      setAdding(false)
      setDraft("")
    } catch (e) {
      toast({
        title: "Hata",
        description: e instanceof Error ? e.message : `${t.Noun} eklenemedi`,
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  if (adding) {
    return (
      <div className="flex gap-2">
        <Input
          id={id}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Yeni ${t.noun} adı`}
          disabled={disabled || saving}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              void create()
            }
          }}
        />
        <Button
          type="button"
          onClick={() => void create()}
          disabled={saving || !draft.trim()}
          className="shrink-0"
        >
          Ekle
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setAdding(false)
            setDraft("")
          }}
          disabled={saving}
          className="shrink-0"
        >
          İptal
        </Button>
      </div>
    )
  }

  return (
    <div className="flex gap-2">
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
      >
        <option value="">— {t.Noun} yok —</option>
        {allOptions.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setDraft("")
          setAdding(true)
        }}
        disabled={disabled}
        className="shrink-0"
        title={`Yeni ${t.noun} ekle`}
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  )
}
