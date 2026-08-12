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
//
// Şıkkın REÇETE ETKİSİ (malzeme değişimi / ekleme / porsiyon çarpanı) burada
// tanımlanır ama satır satır açık DEĞİL: seçeneklerin çoğu yalnız fiyat farkıdır
// ve dört alanı hepsinde göstermek formu okunmaz yapardı (K8'in aynı mantığı).

import { useMemo, useState } from "react"
import { FlaskConical, Loader2, Plus, Trash2 } from "lucide-react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SearchSelect } from "@/components/ui/search-select"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/components/ui/use-toast"
import {
  defaultRecipeUnit,
  normalizeUnitCode,
  recipeUnitOptions,
  unitShortLabel,
} from "@/lib/data/units"
import type { OptionGroupView } from "@/lib/restoran/product-options"
import { money } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Reçete etkisinde seçilebilecek ürün (menü ekranından gelir). */
export type EffectProduct = { id: string; name: string; unit?: string | null }

type DraftOption = {
  name: string
  priceDelta: string
  isDefault: boolean
  // Reçete etkisi — SATIS-EKRANI.md K6. Boş mod = etkisiz (bugünkü davranış).
  effectMode: "" | "SWAP" | "ADD"
  fromProductId: string
  toProductId: string
  effectQuantity: string
  effectUnit: string
  recipeFactor: string
}
type Draft = {
  id: string | null
  name: string
  isRequired: boolean
  isMulti: boolean
  options: DraftOption[]
}

const emptyOption = (isDefault: boolean): DraftOption => ({
  name: "",
  priceDelta: "0",
  isDefault,
  effectMode: "",
  fromProductId: "",
  toProductId: "",
  effectQuantity: "",
  effectUnit: "",
  recipeFactor: "",
})

const emptyDraft = (): Draft => ({
  id: null,
  name: "",
  isRequired: false,
  isMulti: false,
  options: [emptyOption(true)],
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
    effectMode: o.effectMode === "SWAP" || o.effectMode === "ADD" ? o.effectMode : "",
    fromProductId: o.fromProductId ?? "",
    toProductId: o.toProductId ?? "",
    effectQuantity: o.effectQuantity != null ? String(o.effectQuantity) : "",
    effectUnit: o.effectUnit ?? "",
    recipeFactor: o.recipeFactor != null ? String(o.recipeFactor) : "",
  })),
})

/** Şıkkın stoğa dokunan bir tanımı var mı (satırdaki rozet buna bakar)? */
const hasEffect = (o: DraftOption) =>
  (o.effectMode === "SWAP" && !!o.fromProductId) ||
  (o.effectMode === "ADD" && !!o.toProductId) ||
  (!!o.recipeFactor.trim() && o.recipeFactor.trim() !== "1")

export function ProductOptionsDialog({
  open,
  companyId,
  product,
  groups,
  products,
  recipeComponentIds,
  onClose,
  onSaved,
}: {
  open: boolean
  companyId: string
  /**
   * `basePrice`: ürünün KDV DAHİL satış fiyatı. Fiyat farkı tek başına
   * anlaşılmıyordu ("+20" neyin üstüne?); önizlemede şıkkın satıştaki NİHAİ
   * fiyatı gösteriliyor. null ise önizleme fiyatsız çizilir.
   */
  product: { id: string; name: string; basePrice?: number | null } | null
  groups: OptionGroupView[]
  /** Reçete etkisinde seçilebilecek ürünler (hammadde dahil tüm stok kartları). */
  products: EffectProduct[]
  /** Bu ürünün reçetesindeki bileşenler — "değişim" listesinde başa alınır. */
  recipeComponentIds: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const { toast } = useToast()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  /** Reçete etkisi editörü açık olan şık (aynı anda tek satır) — ekran sakin kalsın. */
  const [effectRow, setEffectRow] = useState<number | null>(null)

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products])

  /**
   * "Değişim" listesi: reçetedeki bileşenler üstte. Kullanıcı "sütü neyle
   * değiştireyim" derken önce reçetede ne olduğunu görmeli; alt reçetelerden
   * gelen bileşenler de değiştirilebildiği için liste TÜM ürünlerle devam eder.
   */
  const fromOptions = useMemo(() => {
    const inRecipe = new Set(recipeComponentIds)
    const label = (p: EffectProduct) => (inRecipe.has(p.id) ? `${p.name} · reçetede` : p.name)
    return [...products]
      .sort((a, b) => {
        const byRecipe = Number(inRecipe.has(b.id)) - Number(inRecipe.has(a.id))
        return byRecipe !== 0 ? byRecipe : a.name.localeCompare(b.name, "tr-TR")
      })
      .map((p) => ({ id: p.id, name: label(p) }))
  }, [products, recipeComponentIds])

  const toOptions = useMemo(
    () =>
      [...products]
        .sort((a, b) => a.name.localeCompare(b.name, "tr-TR"))
        .map((p) => ({ id: p.id, name: p.name })),
    [products],
  )

  const close = () => {
    setDraft(null)
    setEffectRow(null)
    onClose()
  }

  const save = async () => {
    if (!draft || !product) return
    const options = draft.options
      .map((o) => ({
        name: o.name.trim(),
        priceDelta: parseFloat(o.priceDelta.replace(",", ".")) || 0,
        isDefault: o.isDefault,
        // Yarım kalan etki sunucuda zaten eleniyor; burada da olduğu gibi
        // gönderiyoruz ki tek doğrulama yeri kalsın (istemci kopyası ayrışmasın).
        effectMode: o.effectMode || null,
        fromProductId: o.fromProductId || null,
        toProductId: o.toProductId || null,
        effectQuantity: o.effectQuantity.trim() ? o.effectQuantity.replace(",", ".") : null,
        effectUnit: o.effectUnit || null,
        recipeFactor: o.recipeFactor.trim() ? o.recipeFactor.replace(",", ".") : null,
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
      {/* max-w-xl (576px) idi: şık satırında beş sütun var (ad, fiyat, varsayılan,
          reçete, sil) ve başlıklar o genişlikte iki satıra kırılıyordu. */}
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Seçenekler — {product?.name}</DialogTitle>
          {/* Açıklama KISA tutuldu: eskiden burada dört cümlelik bir duvar vardı
              ve hiçbiri ilgili alanın yanında değildi. Detaylar artık ait
              oldukları yerde (grup anahtarlarının altında, şık başlıklarında,
              reçete etkisi editöründe). */}
          <DialogDescription>
            Satışta sorulacak seçimler: &quot;Boy&quot;, &quot;Süt&quot;, &quot;Ekstra&quot;.
            Her grup bir soru, içindeki şıklar cevaplardır.
          </DialogDescription>
        </DialogHeader>

        {draft ? (
          <div className="space-y-3">
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground">Grup adı</Label>
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Boy"
                  className="mt-1.5"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Kasiyere sorulacak soru. Örnek: Boy, Süt tercihi, Ekstralar
                </p>
              </div>
              {/* İki anahtar da tek kelimeyle duruyordu ("Zorunlu", "Çoklu") ve
                  ne yaptıkları ancak satışta deneyerek anlaşılıyordu. */}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex cursor-pointer items-start gap-2 rounded-lg border p-2.5">
                  <Switch
                    className="mt-0.5"
                    checked={draft.isRequired}
                    onCheckedChange={(v) => setDraft({ ...draft, isRequired: v })}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">Zorunlu</span>
                    <span className="block text-[11px] leading-snug text-muted-foreground">
                      {draft.isRequired
                        ? "Kasiyer seçim yapmadan ürünü ekleyemez"
                        : "Kasiyer atlayabilir; varsayılan şık kullanılır"}
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2 rounded-lg border p-2.5">
                  <Switch
                    className="mt-0.5"
                    checked={draft.isMulti}
                    onCheckedChange={(v) => setDraft({ ...draft, isMulti: v })}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">Çoklu seçim</span>
                    <span className="block text-[11px] leading-snug text-muted-foreground">
                      {draft.isMulti
                        ? "Birden çok şık seçilebilir — ekstralar gibi"
                        : "Tek şık seçilir — boy gibi"}
                    </span>
                  </span>
                </label>
              </div>
            </div>

            <div className="space-y-2">
              {/* SÜTUN BAŞLIKLARI: üç girdi etiketsiz yan yana duruyordu; dar
                  sayı kutusunun fiyat farkı olduğu yalnızca tooltip'te yazıyordu.
                  Satırla aynı grid kullanılıyor ki hizalama kaymasın. */}
              <div className="grid grid-cols-[minmax(0,1fr)_8.5rem_5rem_2.5rem_2.5rem] items-end gap-2 px-2 text-[11px] font-medium text-muted-foreground">
                <span>Şık adı</span>
                <span className="text-right">Fiyat farkı</span>
                <span className="text-center">Varsayılan</span>
                <span className="text-center" title="Reçete etkisi">
                  Reçete
                </span>
                <span />
              </div>
              {draft.options.map((option, index) => (
                // Şıklar eskiden dipdibe akıyordu; reçete etkisi açılınca hangi
                // satıra ait olduğu da karışıyordu. Her şık kendi kutusunda.
                <div
                  key={index}
                  className={cn(
                    "space-y-2 rounded-lg border p-2",
                    effectRow === index && "border-kobipo-blue/50 dark:border-primary/50"
                  )}
                >
                  <div className="grid grid-cols-[minmax(0,1fr)_8.5rem_5rem_2.5rem_2.5rem] items-center gap-2">
                    <Input
                      value={option.name}
                      onChange={(e) => patchOption(index, { name: e.target.value })}
                      placeholder="Küçük"
                    />
                    <div className="relative">
                      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        ₺
                      </span>
                      <Input
                        value={option.priceDelta}
                        onChange={(e) => patchOption(index, { priceDelta: e.target.value })}
                        inputMode="decimal"
                        placeholder="0"
                        className="pl-6 text-right tabular-nums"
                        title="Ürün fiyatına eklenecek fark (KDV dahil). Eksi yazılabilir: -10"
                      />
                    </div>
                    <label className="flex cursor-pointer items-center justify-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4 cursor-pointer"
                        checked={option.isDefault}
                        onChange={(e) => patchOption(index, { isDefault: e.target.checked })}
                        title="Satış ekranı açıldığında bu şık seçili gelir"
                      />
                    </label>
                    {/* Reçete etkisi ayrı bir düğmenin ARKASINDA: seçeneklerin
                        çoğu yalnız fiyat farkıdır, dört alanı hepsinde açık
                        tutmak formu okunmaz hale getirirdi. */}
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setEffectRow(effectRow === index ? null : index)}
                      title="Reçete etkisi (malzeme değişimi / ekleme / porsiyon)"
                    >
                      <FlaskConical
                        className={cn(
                          "h-4 w-4",
                          hasEffect(option)
                            ? "text-kobipo-blue dark:text-primary"
                            : "text-muted-foreground",
                        )}
                      />
                    </Button>
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

                  {effectRow === index && (
                    <EffectEditor
                      option={option}
                      fromOptions={fromOptions}
                      toOptions={toOptions}
                      productById={productById}
                      onChange={(patch) => patchOption(index, patch)}
                    />
                  )}
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setDraft({ ...draft, options: [...draft.options, emptyOption(false)] })
                }
              >
                <Plus className="mr-1.5 h-4 w-4" />
                Seçenek ekle
              </Button>

              {/* ÖNİZLEME: fiyat farkı tek başına soyut ("+20" neyin üstüne?).
                  Burada ürünün KDV dahil fiyatıyla toplanıp satıştaki NİHAİ
                  fiyat gösteriliyor — kullanıcı ne kurduğunu kaydetmeden görür. */}
              <OptionsPreview
                groupName={draft.name}
                options={draft.options}
                basePrice={product?.basePrice ?? null}
                isRequired={draft.isRequired}
                isMulti={draft.isMulti}
              />
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
                        {/* Stoğa dokunan grup listede işaretli: "soya sütü niye
                            stoktan düşmüyor" sorusunun cevabı burada görünür. */}
                        {group.options.some((o) => o.effectMode || o.recipeFactor) && (
                          <span
                            className="ml-1.5 inline-flex items-center gap-1 text-[10px] text-kobipo-blue dark:text-primary"
                            title="Bu grupta reçeteyi değiştiren şık var"
                          >
                            <FlaskConical className="h-3 w-3" />
                            reçete etkili
                          </span>
                        )}
                      </p>
                      {/* Özette de NİHAİ fiyat: ham fark ("+20") neyin üstüne
                          eklendiğini söylemiyordu, üstelik eksi farkta bile
                          "+" yazıyordu. Fiyat bilinmiyorsa işaretli farka düşer. */}
                      <p className="truncate text-xs text-muted-foreground">
                        {group.options
                          .map((o) => {
                            const delta = Number(o.priceDelta) || 0
                            if (product?.basePrice != null)
                              return `${o.name} ${money(product.basePrice + delta)}`
                            if (!delta) return o.name
                            return `${o.name} (${delta > 0 ? "+" : ""}${money(delta)})`
                          })
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

/**
 * "Satışta böyle görünecek" önizlemesi.
 *
 * Fiyat farkı alanı tek başına soyut: kullanıcı "+20" yazıyor ama neyin üstüne
 * eklendiğini görmüyor ve KDV dahil mi hariç mi diye tereddüt ediyordu. Burada
 * ürünün KDV dahil fiyatıyla toplanıp şıkkın satıştaki NİHAİ fiyatı yazılıyor.
 *
 * Ürünün fiyatı yoksa (basePrice null) yalnızca farklar gösterilir — uydurma bir
 * taban fiyat üzerinden yanlış rakam göstermektense eksik göstermek yeğdir.
 */
function OptionsPreview({
  groupName,
  options,
  basePrice,
  isRequired,
  isMulti,
}: {
  groupName: string
  options: DraftOption[]
  basePrice: number | null
  isRequired: boolean
  isMulti: boolean
}) {
  const named = options.filter((o) => o.name.trim())
  if (named.length === 0) return null

  const priceOf = (o: DraftOption) => {
    const delta = Number(String(o.priceDelta).replace(",", ".")) || 0
    if (basePrice == null) return delta === 0 ? "" : `${delta > 0 ? "+" : ""}${money(delta)}`
    return money(basePrice + delta)
  }

  return (
    <div className="rounded-lg border border-dashed bg-muted/30 p-3">
      <p className="text-[11px] font-medium text-muted-foreground">Satışta böyle görünecek</p>
      <p className="mt-1.5 text-sm font-semibold">
        {groupName.trim() || "Grup adı"}
        <span className="ml-2 text-[11px] font-normal text-muted-foreground">
          {isRequired ? "seçim zorunlu" : "atlanabilir"} ·{" "}
          {isMulti ? "birden çok seçilebilir" : "tek seçim"}
        </span>
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {named.map((o, i) => (
          <span
            key={i}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs",
              o.isDefault
                ? "border-kobipo-blue bg-kobipo-blue/10 font-medium text-kobipo-blue dark:border-primary dark:bg-primary/15 dark:text-primary"
                : "bg-background"
            )}
          >
            {o.name.trim()}
            {priceOf(o) && <span className="ml-1.5 tabular-nums">{priceOf(o)}</span>}
          </span>
        ))}
      </div>
      {basePrice == null && (
        <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
          Ürüne satış fiyatı girilmediği için yalnızca farklar gösteriliyor.
        </p>
      )}
    </div>
  )
}

/**
 * Bir şıkkın reçete etkisi. Üç iş de burada tanımlanır:
 *   Değişim → reçetedeki bileşenin yerine başkası düşer (hedefsiz = çıkar)
 *   Ekleme  → reçeteye ek malzeme düşer
 *   Çarpan  → reçetenin TAMAMI ölçeklenir; moddan bağımsız, tek başına da olur
 *
 * Miktar yalnız "ekleme"de sorulur: değişimde miktar REÇETEDEN gelir (süt kaç
 * litreyse soya sütü de o kadar) — ayrıca sormak iki yerde yaşayan bir sayı
 * yaratır ve reçete güncellenince sessizce yanlışa döner.
 */
function EffectEditor({
  option,
  fromOptions,
  toOptions,
  productById,
  onChange,
}: {
  option: DraftOption
  fromOptions: Array<{ id: string; name: string }>
  toOptions: Array<{ id: string; name: string }>
  productById: Map<string, EffectProduct>
  onChange: (patch: Partial<DraftOption>) => void
}) {
  const addProduct = option.toProductId ? productById.get(option.toProductId) : undefined
  const unitOptions = addProduct ? recipeUnitOptions(addProduct.unit, option.effectUnit) : []

  // Üç mod da yalnızca tek kelimeyle duruyordu; "Değişim" ile "Ekleme"nin stoğa
  // ne yaptığı ancak deneyerek anlaşılıyordu. Açıklama seçili moda göre altta.
  const modes: Array<{ value: DraftOption["effectMode"]; label: string; hint: string }> = [
    {
      value: "",
      label: "Yok",
      hint: "Bu şık yalnızca fiyatı değiştirir; stoktan reçetedeki malzemeler düşer.",
    },
    {
      value: "SWAP",
      label: "Değişim",
      hint: "Reçetedeki bir malzemenin yerine başkası düşer — inek sütü yerine soya sütü. Miktar reçeteden gelir, ayrıca sorulmaz.",
    },
    {
      value: "ADD",
      label: "Ekleme",
      hint: "Reçeteye ek malzeme düşer — ekstra shot, ekstra sos.",
    },
  ]
  const activeHint = modes.find((m) => m.value === option.effectMode)?.hint

  return (
    <div className="space-y-2.5 rounded-lg border border-dashed bg-muted/30 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Reçete etkisi</span>
        <div className="flex gap-1">
          {modes.map((mode) => (
            <button
              key={mode.value || "none"}
              type="button"
              onClick={() =>
                onChange({
                  effectMode: mode.value,
                  // Mod değişince eski taraf temizlenir: "değişim"den kalan
                  // kaynak ürün "ekleme"de anlamsızdır ve sunucuda elenirdi.
                  ...(mode.value === "SWAP" ? { effectQuantity: "", effectUnit: "" } : {}),
                  ...(mode.value === "ADD" ? { fromProductId: "" } : {}),
                  ...(mode.value === ""
                    ? { fromProductId: "", toProductId: "", effectQuantity: "", effectUnit: "" }
                    : {}),
                })
              }
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                option.effectMode === mode.value
                  ? "border-kobipo-blue bg-kobipo-blue/10 text-kobipo-blue dark:border-primary dark:bg-primary/15 dark:text-primary"
                  : "hover:bg-muted",
              )}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>
      {activeHint && (
        <p className="text-[11px] leading-snug text-muted-foreground">{activeHint}</p>
      )}

      {option.effectMode === "SWAP" && (
        <div className="grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr]">
          <SearchSelect
            options={fromOptions}
            value={option.fromProductId}
            onChange={(id) => onChange({ fromProductId: id })}
            placeholder="Reçetedeki bileşen"
            emptyText="Ürün bulunamadı"
          />
          <span className="text-center text-xs text-muted-foreground">yerine</span>
          <SearchSelect
            options={toOptions}
            value={option.toProductId}
            onChange={(id) => onChange({ toProductId: id })}
            placeholder="Yerine düşecek ürün"
            emptyText="Ürün bulunamadı"
            allowClear
            clearLabel="— hiçbiri (çıkar)"
          />
        </div>
      )}

      {option.effectMode === "ADD" && (
        <div className="grid items-center gap-2 sm:grid-cols-[1fr_5rem_7rem]">
          <SearchSelect
            options={toOptions}
            value={option.toProductId}
            onChange={(id) => {
              const picked = productById.get(id)
              onChange({
                toProductId: id,
                // Birim DAİMA seçilen üründen yeniden türetilir. Eskiden mevcut
                // değer korunuyordu (`option.effectUnit || …`) ve ürün süt→kahve
                // olarak değiştirildiğinde birim ML olarak kalıyordu: liste artık
                // ML içermediği için Select boş görünüyor ama kayıt ML gidiyor,
                // satışta ML→KG çevrilemediği için ekstra malzeme SESSİZCE
                // düşmüyordu.
                effectUnit:
                  defaultRecipeUnit(picked?.unit) || normalizeUnitCode(picked?.unit),
              })
            }}
            placeholder="Eklenecek ürün"
            emptyText="Ürün bulunamadı"
          />
          <Input
            value={option.effectQuantity}
            onChange={(e) => onChange({ effectQuantity: e.target.value })}
            inputMode="decimal"
            placeholder="1"
            className="text-right tabular-nums"
          />
          <Select
            value={option.effectUnit}
            onValueChange={(v) => onChange({ effectUnit: v })}
            disabled={!addProduct}
          >
            <SelectTrigger>
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {unitOptions.map((u) => (
                <SelectItem key={u} value={u}>
                  {unitShortLabel(u)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Porsiyon çarpanı</span>
        <Input
          value={option.recipeFactor}
          onChange={(e) => onChange({ recipeFactor: e.target.value })}
          inputMode="decimal"
          placeholder="1"
          className="w-20 text-right tabular-nums"
        />
        <span className="text-[11px] text-muted-foreground">
          1,5 → reçetenin tamamı 1,5 kat düşer (&quot;büyük boy&quot;)
        </span>
      </div>
    </div>
  )
}
