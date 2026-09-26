"use client"

// Hizmet kataloğu. Ayrı bir tablo YOK: hizmet, `Product.isService = true` olan
// karttır — faturalar, teklifler ve siparişler aynı Product kaydına bağlanır,
// stok hareketi hizmeti reddeder, satış ekranları hizmeti dışlar. Bu ekran yalnız
// hizmetleri listeler ve stok/depo/raf/barkod alanı olmayan bir formla yazar;
// kartlar Ürün Listesi'nde ("Hizmet" türü) de görünmeye devam eder.

import { useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Eye, Pencil, Plus, Search, Trash2, Wrench, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { UnitCombobox } from "@/components/ui/unit-combobox"
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table"
import {
  StyledTableContainer,
  StyledTableHeaderRow,
  StyledTableHead,
  StyledTableRow,
  EntityCell,
  MonoCell,
} from "@/components/ui/styled-table"
import { TablePagination, usePagedRows } from "@/components/ui/table-pagination"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"
import { useConfirm } from "@/components/ui/confirm-dialog-provider"
import { WriteAction } from "@/components/dashboard/write-guard"
import { CompanyLink } from "@/components/dashboard/company-link"
import { withCompanyHref } from "@/lib/company/href"
import { formatMoney } from "@/lib/format"
import { trMatcher } from "@/lib/text/tr-fold"

type Service = {
  id: string
  slug: string | null
  code: string | null
  name: string
  category: string | null
  unit: string
  vatRate: number | string
  purchasePrice: number | string | null
  salePrice: number | string | null
  currency: string | null
  purchasePriceVatIncluded: boolean
  salePriceVatIncluded: boolean
  isActive: boolean
}

type ServiceForm = {
  code: string
  name: string
  category: string
  unit: string
  vatRate: string
  purchasePrice: string
  salePrice: string
  currency: string
  purchasePriceVatIncluded: boolean
  salePriceVatIncluded: boolean
}

const emptyForm: ServiceForm = {
  code: "",
  name: "",
  category: "",
  unit: "ADET",
  vatRate: "20",
  purchasePrice: "",
  salePrice: "",
  currency: "TRY",
  purchasePriceVatIncluded: false,
  salePriceVatIncluded: false,
}

/** DB net saklar; kullanıcı KDV dahil girdiyse formda brüt gösterilir (Ürün Listesi ile aynı). */
function toDisplayPrice(net: number | string | null, included: boolean, vatRate: number): string {
  if (net == null || net === "") return ""
  const n = Number(net)
  const gross = included && vatRate > 0 ? n * (1 + vatRate / 100) : n
  return String(Math.round(gross * 100) / 100)
}

export default function HizmetListesiPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const { toast } = useToast()
  const { confirm } = useConfirm()

  const [services, setServices] = useState<Service[]>([])
  const [loaded, setLoaded] = useState(false)
  const [search, setSearch] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("ALL")
  const requestSeq = useRef(0)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<ServiceForm>({ ...emptyForm })
  const [saving, setSaving] = useState(false)

  const fetchServices = async () => {
    if (!companyId) return
    const seq = ++requestSeq.current
    try {
      const res = await fetch(`/api/stok/products?${new URLSearchParams({ companyId, isService: "true" })}`)
      if (seq !== requestSeq.current) return
      if (res.ok) setServices(await res.json())
    } catch (error) {
      console.error("Error fetching services:", error)
    } finally {
      if (seq === requestSeq.current) setLoaded(true)
    }
  }

  useEffect(() => {
    setLoaded(false)
    void fetchServices()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  const categories = useMemo(
    () =>
      [...new Set(services.map((s) => (s.category || "").trim()).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, "tr"),
      ),
    [services],
  )

  const visible = useMemo(() => {
    const matches = trMatcher(search)
    return services.filter(
      (s) =>
        (categoryFilter === "ALL" || (s.category || "") === categoryFilter) &&
        matches(s.name, s.code, s.category),
    )
  }, [services, search, categoryFilter])

  const paged = usePagedRows(visible, { resetKey: `${search}|${categoryFilter}` })
  const hasFilter = search.trim() !== "" || categoryFilter !== "ALL"

  const startCreate = () => {
    setEditingId(null)
    setForm({ ...emptyForm })
    setDialogOpen(true)
  }

  const startEdit = (s: Service) => {
    const vat = Number(s.vatRate)
    setEditingId(s.id)
    setForm({
      code: s.code || "",
      name: s.name,
      category: s.category || "",
      unit: s.unit,
      vatRate: String(vat),
      purchasePrice: toDisplayPrice(s.purchasePrice, s.purchasePriceVatIncluded, vat),
      salePrice: toDisplayPrice(s.salePrice, s.salePriceVatIncluded, vat),
      currency: s.currency || "TRY",
      purchasePriceVatIncluded: Boolean(s.purchasePriceVatIncluded),
      salePriceVatIncluded: Boolean(s.salePriceVatIncluded),
    })
    setDialogOpen(true)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!companyId) return
    setSaving(true)
    try {
      const res = await fetch(`/api/stok/products${editingId ? `/${editingId}` : ""}`, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          companyId,
          isService: true,
          isIngredient: false,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || "Kaydedilemedi")
      }
      toast({ title: "Başarılı", description: editingId ? "Hizmet güncellendi" : "Hizmet oluşturuldu" })
      setDialogOpen(false)
      setEditingId(null)
      setForm({ ...emptyForm })
      void fetchServices()
    } catch (error) {
      toast({
        title: "Hata",
        description: error instanceof Error ? error.message : "Bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  const deleteService = async (s: Service) => {
    const ok = await confirm({
      title: "Hizmeti sil",
      description: `"${s.name}" silinsin mi? Bu hizmetin geçtiği faturalar silinmez; kalemleri karttan kopar.`,
      confirmLabel: "Sil",
      variant: "destructive",
    })
    if (!ok) return
    const res = await fetch(`/api/stok/products/${s.id}?companyId=${encodeURIComponent(companyId || "")}`, {
      method: "DELETE",
    })
    if (res.ok) {
      toast({ title: "Başarılı", description: "Hizmet silindi" })
      void fetchServices()
    } else {
      toast({ title: "Hata", description: "Hizmet silinemedi", variant: "destructive" })
    }
  }

  const detailHref = (s: Service) => withCompanyHref(`/stok/${s.slug || s.id}`, companyId)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-kobipo-navy dark:text-foreground">Hizmet Listesi</h1>
          <p className="text-sm text-muted-foreground">
            Sattığınız veya satın aldığınız hizmetler — stok tutulmaz, faturada kalem olarak seçilir
          </p>
        </div>
        <WriteAction>
          <Button onClick={startCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Yeni Hizmet
          </Button>
        </WriteAction>
      </div>

      <Card>
        <CardHeader className="space-y-3">
          <div>
            <CardTitle>Hizmetler</CardTitle>
            <CardDescription>
              {loaded ? `${visible.length} hizmet${hasFilter ? ` (toplam ${services.length})` : ""}` : "Yükleniyor…"}
              {" · "}
              Hizmetler <CompanyLink href="/stok" className="underline underline-offset-2">Ürün Listesi</CompanyLink>
              {"'nde de \"Hizmet\" türüyle görünür."}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Hizmet adı, kodu veya kategorisi ara…"
                className="pl-9"
              />
            </div>
            {categories.length > 0 && (
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue placeholder="Kategori" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Tüm kategoriler</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {hasFilter && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 text-muted-foreground"
                onClick={() => {
                  setSearch("")
                  setCategoryFilter("ALL")
                }}
              >
                <X className="mr-1 h-4 w-4" />
                Temizle
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <StyledTableContainer>
            <Table>
              <TableHeader>
                <StyledTableHeaderRow>
                  <StyledTableHead>Kod</StyledTableHead>
                  <StyledTableHead>Ad</StyledTableHead>
                  <StyledTableHead>Kategori</StyledTableHead>
                  <StyledTableHead>Birim</StyledTableHead>
                  <StyledTableHead>KDV %</StyledTableHead>
                  <StyledTableHead className="text-right">Alış Fiyatı</StyledTableHead>
                  <StyledTableHead className="text-right">Satış Fiyatı</StyledTableHead>
                  <StyledTableHead>İşlem</StyledTableHead>
                </StyledTableHeaderRow>
              </TableHeader>
              <TableBody>
                {visible.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-10 text-center">
                      {!loaded ? (
                        <p className="text-sm text-muted-foreground">Yükleniyor…</p>
                      ) : hasFilter ? (
                        <p className="text-sm text-muted-foreground">Aramaya uyan hizmet yok.</p>
                      ) : (
                        <div className="flex flex-col items-center gap-3">
                          <Wrench className="h-8 w-8 text-muted-foreground/40" />
                          <p className="text-sm text-muted-foreground">Henüz hizmet eklenmemiş.</p>
                          <WriteAction>
                            <Button variant="outline" size="sm" onClick={startCreate}>
                              <Plus className="mr-1 h-4 w-4" />
                              İlk hizmeti ekle
                            </Button>
                          </WriteAction>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ) : (
                  paged.pageRows.map((s, idx) => (
                    <StyledTableRow
                      key={s.id}
                      index={idx}
                      className="cursor-pointer"
                      href={detailHref(s)}
                      hrefLabel={`${s.name} detayı`}
                    >
                      <TableCell><MonoCell value={s.code} /></TableCell>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-1.5">
                          <EntityCell name={s.name} />
                          {!s.isActive && (
                            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                              Pasif
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {s.category ? (
                          <span className="inline-block rounded-full bg-muted px-2 py-0.5 text-xs">{s.category}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>{s.unit}</TableCell>
                      <TableCell>{Number(s.vatRate)}%</TableCell>
                      <TableCell className="text-right whitespace-nowrap">
                        {s.purchasePrice != null ? formatMoney(Number(s.purchasePrice), s.currency) : "-"}
                      </TableCell>
                      <TableCell className="text-right whitespace-nowrap font-semibold">
                        {s.salePrice != null ? formatMoney(Number(s.salePrice), s.currency) : "-"}
                      </TableCell>
                      {/* Aksiyon hücresi bağlantı kaplamasının dışında kalmalı. */}
                      <TableCell data-row-link-skip onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1">
                          <CompanyLink href={`/stok/${s.slug || s.id}`}>
                            <Button variant="ghost" size="sm">
                              <Eye className="mr-1 h-4 w-4" />
                              Detay
                            </Button>
                          </CompanyLink>
                          <WriteAction>
                            <Button variant="ghost" size="sm" onClick={() => startEdit(s)}>
                              <Pencil className="mr-1 h-4 w-4" />
                              Düzenle
                            </Button>
                          </WriteAction>
                          <WriteAction>
                            <Button variant="ghost" size="sm" onClick={() => void deleteService(s)}>
                              <Trash2 className="mr-1 h-4 w-4 text-red-600" />
                              Sil
                            </Button>
                          </WriteAction>
                        </div>
                      </TableCell>
                    </StyledTableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </StyledTableContainer>
          <TablePagination {...paged} />
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Hizmeti Düzenle" : "Yeni Hizmet"}</DialogTitle>
            <DialogDescription>Hizmette stok, depo ve barkod tutulmaz.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="svc-name">Ad *</Label>
                <Input
                  id="svc-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="ör. Vinç çalışma bedeli, Aylık bakım"
                  required
                  disabled={saving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="svc-code">Hizmet Kodu</Label>
                <Input
                  id="svc-code"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  disabled={saving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="svc-category">Kategori</Label>
                <Input
                  id="svc-category"
                  list="svc-categories"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder="Seçin ya da yazın"
                  disabled={saving}
                />
                <datalist id="svc-categories">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <div className="space-y-2">
                <Label htmlFor="svc-unit">Birim</Label>
                <UnitCombobox
                  id="svc-unit"
                  value={form.unit}
                  onChange={(v) => setForm({ ...form, unit: v })}
                  disabled={saving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="svc-vat">KDV Oranı (%)</Label>
                <Input
                  id="svc-vat"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  value={form.vatRate}
                  onChange={(e) => setForm({ ...form, vatRate: e.target.value })}
                  disabled={saving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="svc-currency">Para Birimi</Label>
                <Select value={form.currency} onValueChange={(v) => setForm({ ...form, currency: v })} disabled={saving}>
                  <SelectTrigger id="svc-currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TRY">₺ TRY</SelectItem>
                    <SelectItem value="USD">$ USD</SelectItem>
                    <SelectItem value="EUR">€ EUR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="hidden md:block" />
              <div className="space-y-2">
                <Label htmlFor="svc-purchase">Alış Fiyatı</Label>
                <Input
                  id="svc-purchase"
                  type="number"
                  step="0.01"
                  value={form.purchasePrice}
                  onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })}
                  disabled={saving}
                />
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={form.purchasePriceVatIncluded}
                    onChange={(e) => setForm({ ...form, purchasePriceVatIncluded: e.target.checked })}
                    disabled={saving}
                  />
                  KDV dahil
                </label>
              </div>
              <div className="space-y-2">
                <Label htmlFor="svc-sale">Satış Fiyatı</Label>
                <Input
                  id="svc-sale"
                  type="number"
                  step="0.01"
                  value={form.salePrice}
                  onChange={(e) => setForm({ ...form, salePrice: e.target.value })}
                  disabled={saving}
                />
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={form.salePriceVatIncluded}
                    onChange={(e) => setForm({ ...form, salePriceVatIncluded: e.target.checked })}
                    disabled={saving}
                  />
                  KDV dahil
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
                İptal
              </Button>
              <Button type="submit" disabled={saving || !form.name.trim()}>
                {saving ? "Kaydediliyor…" : editingId ? "Güncelle" : "Oluştur"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
