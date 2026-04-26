"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/components/ui/use-toast"
import { Plus, Trash2, X } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ProductCombobox } from "@/components/e-donusum/product-combobox"

type LineExtraKey = "description" | "discountRate" | "withholdingRate" | "exciseRate"

const LINE_EXTRA_LABEL: Record<LineExtraKey, string> = {
  description: "Satır açıklaması",
  discountRate: "Satır iskontosu (%)",
  withholdingRate: "Satır tevkifatı (%)",
  exciseRate: "Satır ÖTV (%)",
}

const LINE_EXTRA_ORDER: LineExtraKey[] = [
  "description",
  "discountRate",
  "withholdingRate",
  "exciseRate",
]

const INVOICE_UNIT_OPTIONS = ["ADET", "KG", "MT", "M2", "M3", "LT", "SA", "GUN", "PAKET"] as const
const E_DOC_TYPES = new Set(["E_INVOICE", "E_ARCHIVE"])

interface Customer {
  id: string
  name: string
  taxNumber?: string | null
  taxOffice?: string | null
  address?: string | null
}

interface Supplier {
  id: string
  name: string
  taxNumber?: string | null
  taxOffice?: string | null
  address?: string | null
}

interface Product {
  id: string
  name: string
  code?: string
  salePrice?: number
  vatRate: number
  unit?: string
}

export interface InvoiceItem {
  productId?: string
  description: string
  unit?: string
  quantity: number
  unitPrice: number
  discountRate?: number
  vatRate: number
  withholdingRate?: number
  exciseRate?: number
}

interface CompanySettings {
  id: string
  name?: string
  taxNumber?: string | null
  taxOffice?: string | null
  address?: string | null
  isEDonusumEnabled?: boolean
}

export type InvoiceEditorMode = "create" | "edit"

export type InvoiceEditorProps = {
  companyId: string
  mode: InvoiceEditorMode
  /** Düzenleme modunda fatura id */
  invoiceId?: string
  /** Faturalar / eski URL: manuel fatura türü ile aç */
  defaultManual?: boolean
  /** Listeye dön / İptal hedefi (başında / olmalı). Sağlanmazsa /e-donusum */
  backHref?: string
}

export function InvoiceEditor({ companyId, mode, invoiceId, defaultManual, backHref }: InvoiceEditorProps) {
  const router = useRouter()
  const { toast } = useToast()

  const [customers, setCustomers] = useState<Customer[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [bootstrappingEdit, setBootstrappingEdit] = useState(mode === "edit")
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null)
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null)

  const [formData, setFormData] = useState({
    type: "SALES",
    invoiceType: "E_ARCHIVE",
    customerId: "",
    supplierId: "",
    date: new Date().toISOString().split("T")[0],
    dueDate: "",
    currency: "TRY",
    exchangeRate: "",
    exchangeRateDate: "",
    notes: "",
  })
  const [items, setItems] = useState<InvoiceItem[]>([
    {
      description: "",
      unit: "ADET",
      quantity: 1,
      unitPrice: 0,
      discountRate: 0,
      vatRate: 20,
      withholdingRate: 0,
      exciseRate: 0,
    },
  ])
  const [lineExtras, setLineExtras] = useState<LineExtraKey[][]>([["description"]])

  const listHref = backHref || `/e-donusum?company=${encodeURIComponent(companyId)}`

  const goBack = () => {
    router.push(listHref)
  }

  useEffect(() => {
    if (!companyId) return
    fetchCustomers()
    fetchSuppliers()
    fetchProducts()
    fetchCompanySettings()
  }, [companyId])

  useEffect(() => {
    if (defaultManual) {
      setFormData((prev) => ({ ...prev, invoiceType: "MANUAL" }))
    }
  }, [defaultManual])

  useEffect(() => {
    if (mode !== "edit" || !companyId || !invoiceId) return
    fetchInvoiceForEdit(invoiceId)
  }, [mode, companyId, invoiceId])

  useEffect(() => {
    if (companySettings && !companySettings.isEDonusumEnabled) {
      setFormData((prev) => {
        const t = String(prev.invoiceType || "").toUpperCase()
        if (t === "E_INVOICE" || t === "E_ARCHIVE") {
          return { ...prev, invoiceType: "MANUAL" }
        }
        return prev
      })
    }
  }, [companySettings])

  const fetchCustomers = async () => {
    if (!companyId) return
    try {
      const response = await fetch(`/api/cari/customers?companyId=${companyId}`)
      if (response.ok) {
        const data = await response.json()
        setCustomers(data)
      }
    } catch (error) {
      console.error("Error fetching customers:", error)
    }
  }

  const fetchSuppliers = async () => {
    if (!companyId) return
    try {
      const response = await fetch(`/api/cari/suppliers?companyId=${companyId}`)
      if (response.ok) {
        const data = await response.json()
        setSuppliers(data)
      }
    } catch (error) {
      console.error("Error fetching suppliers:", error)
    }
  }

  const fetchProducts = async () => {
    if (!companyId) return
    try {
      const response = await fetch(`/api/stok/products?companyId=${companyId}`)
      if (response.ok) {
        const data = await response.json()
        setProducts(data)
      }
    } catch (error) {
      console.error("Error fetching products:", error)
    }
  }

  const fetchCompanySettings = async () => {
    if (!companyId) return
    try {
      const response = await fetch("/api/companies")
      if (!response.ok) return
      const companies = (await response.json()) as CompanySettings[]
      const currentCompany = companies.find((company) => company.id === companyId) || null
      setCompanySettings(currentCompany)
      if (currentCompany && !currentCompany.isEDonusumEnabled) {
        setFormData((prev) => ({ ...prev, invoiceType: "MANUAL" }))
      }
    } catch (error) {
      console.error("Error fetching company settings:", error)
    }
  }

  const fetchInvoiceForEdit = async (id: string) => {
    try {
      setIsLoading(true)
      const response = await fetch(`/api/e-donusum/invoices/${id}?companyId=${companyId || ""}`)
      if (!response.ok) throw new Error("Fatura bilgisi alınamadı")

      const data = await response.json()
      if (data.status !== "DRAFT") {
        throw new Error("Sadece taslak faturalar düzenlenebilir")
      }

      setEditingInvoiceId(id)
      setFormData({
        type: data.type || "SALES",
        invoiceType: data.invoiceType || "MANUAL",
        customerId: data.customerId || "",
        supplierId: data.supplierId || "",
        date: data.date ? new Date(data.date).toISOString().split("T")[0] : new Date().toISOString().split("T")[0],
        dueDate: data.dueDate ? new Date(data.dueDate).toISOString().split("T")[0] : "",
        currency: data.currency || "TRY",
        exchangeRate: data.exchangeRate ? String(data.exchangeRate) : "",
        exchangeRateDate: data.exchangeRateDate ? new Date(data.exchangeRateDate).toISOString().split("T")[0] : "",
        notes: data.notes || "",
      })

      const editItems = Array.isArray(data.items)
        ? data.items.map((item: any) => ({
            productId: item.productId || undefined,
            description: item.description || "",
            unit: (item.unit as string) || item.product?.unit || "ADET",
            quantity: Number(item.quantity) || 1,
            unitPrice: Number(item.unitPrice) || 0,
            discountRate: Number(item.discountRate) || 0,
            vatRate: Number(item.vatRate) || 20,
            withholdingRate: Number(item.withholdingRate) || 0,
            exciseRate: Number(item.exciseRate) || 0,
          }))
        : []

      const finalItems: InvoiceItem[] =
        editItems.length > 0
          ? editItems
          : [
              {
                description: "",
                unit: "ADET",
                quantity: 1,
                unitPrice: 0,
                discountRate: 0,
                vatRate: 20,
                withholdingRate: 0,
                exciseRate: 0,
              },
            ]
      setItems(finalItems)
      setLineExtras(
        finalItems.map((it) => {
          const extras: LineExtraKey[] = []
          if (it.description) extras.push("description")
          if ((it.discountRate || 0) > 0) extras.push("discountRate")
          if ((it.withholdingRate || 0) > 0) extras.push("withholdingRate")
          if ((it.exciseRate || 0) > 0) extras.push("exciseRate")
          if (extras.length === 0) extras.push("description")
          return extras
        })
      )
    } catch (error: any) {
      toast({
        title: "Hata",
        description: error.message || "Fatura düzenleme verisi yüklenemedi",
        variant: "destructive",
      })
      goBack()
    } finally {
      setIsLoading(false)
      setBootstrappingEdit(false)
    }
  }

  const addItem = () => {
    setItems([
      ...items,
      {
        description: "",
        unit: "ADET",
        quantity: 1,
        unitPrice: 0,
        discountRate: 0,
        vatRate: 20,
        withholdingRate: 0,
        exciseRate: 0,
      },
    ])
    setLineExtras((prev) => [...prev, ["description"]])
  }

  const removeItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index))
      setLineExtras((prev) => prev.filter((_, i) => i !== index))
    }
  }

  const updateItem = (index: number, field: keyof InvoiceItem, value: any) => {
    const newItems = [...items]
    newItems[index] = { ...newItems[index], [field]: value }
    setItems(newItems)
  }

  const getLineExtras = (index: number): LineExtraKey[] => lineExtras[index] || []

  const addLineExtra = (index: number, key: LineExtraKey) => {
    setLineExtras((prev) => {
      const next = prev.map((arr, i) => (i === index ? [...arr, key] : arr))
      while (next.length < items.length) next.push(["description"])
      return next
    })
  }

  const removeLineExtra = (index: number, key: LineExtraKey) => {
    setLineExtras((prev) => prev.map((arr, i) => (i === index ? arr.filter((k) => k !== key) : arr)))
    if (key === "description") updateItem(index, "description", "")
    if (key === "discountRate") updateItem(index, "discountRate", 0)
    if (key === "withholdingRate") updateItem(index, "withholdingRate", 0)
    if (key === "exciseRate") updateItem(index, "exciseRate", 0)
  }

  const applyProductToLine = (index: number, product: Product) => {
    const newItems = [...items]
    newItems[index] = {
      ...newItems[index],
      productId: product.id,
      description: product.name,
      unit: (product.unit || "ADET").toUpperCase(),
      unitPrice: Number(product.salePrice) || 0,
      discountRate: 0,
      vatRate: Number(product.vatRate) || 20,
      withholdingRate: 0,
      exciseRate: 0,
    }
    setItems(newItems)
    setLineExtras((prev) =>
      prev.map((arr, i) => (i === index && !arr.includes("description") ? [...arr, "description"] : arr))
    )
  }

  const mergeProductIntoList = (product: Product) => {
    setProducts((prev) => (prev.some((p) => p.id === product.id) ? prev : [product, ...prev]))
  }

  const calculateTotals = () => {
    let netAmount = 0
    let discountAmount = 0
    let vatAmount = 0
    let withholdingAmount = 0
    let exciseAmount = 0

    items.forEach((item) => {
      const itemGross = item.quantity * item.unitPrice
      const itemDiscount = itemGross * ((item.discountRate || 0) / 100)
      const itemNet = itemGross - itemDiscount
      const itemVat = itemNet * (item.vatRate / 100)
      const itemWithholding = itemNet * ((item.withholdingRate || 0) / 100)
      const itemExcise = itemNet * ((item.exciseRate || 0) / 100)
      netAmount += itemNet
      discountAmount += itemDiscount
      vatAmount += itemVat
      withholdingAmount += itemWithholding
      exciseAmount += itemExcise
    })

    return {
      netAmount,
      discountAmount,
      vatAmount,
      withholdingAmount,
      exciseAmount,
      totalAmount: netAmount + vatAmount + exciseAmount - withholdingAmount,
    }
  }

  const resetForm = () => {
    setEditingInvoiceId(null)
    setFormData({
      type: "SALES",
      invoiceType: companySettings?.isEDonusumEnabled ? "E_ARCHIVE" : "MANUAL",
      customerId: "",
      supplierId: "",
      date: new Date().toISOString().split("T")[0],
      dueDate: "",
      currency: "TRY",
      exchangeRate: "",
      exchangeRateDate: "",
      notes: "",
    })
    setItems([
      {
        description: "",
        unit: "ADET",
        quantity: 1,
        unitPrice: 0,
        discountRate: 0,
        vatRate: 20,
        withholdingRate: 0,
        exciseRate: 0,
      },
    ])
    setLineExtras([["description"]])
  }

  const isEDonusumActive = Boolean(companySettings?.isEDonusumEnabled)
  const effectiveInvoiceType = useMemo(() => {
    const t = String(formData.invoiceType || "").toUpperCase()
    if (E_DOC_TYPES.has(t) && !isEDonusumActive) return "MANUAL"
    return t || "MANUAL"
  }, [formData.invoiceType, isEDonusumActive])

  const eInvoiceMissingMessages = useMemo(() => {
    if (!isEDonusumActive) return [] as string[]
    if (!E_DOC_TYPES.has(effectiveInvoiceType)) return [] as string[]
    const messages: string[] = []
    const co = companySettings
    if (!co?.taxNumber?.trim()) messages.push("Firma VKN/TCKN eksik")
    if (!co?.taxOffice?.trim()) messages.push("Firma vergi dairesi eksik")
    if (!co?.address?.trim()) messages.push("Firma adresi eksik")

    if (formData.customerId) {
      const cu = customers.find((c) => c.id === formData.customerId)
      if (cu) {
        if (!cu.taxNumber?.trim()) messages.push("Müşteri vergi numarası eksik")
        if (!cu.taxOffice?.trim()) messages.push("Müşteri vergi dairesi eksik")
        if (!cu.address?.trim()) messages.push("Müşteri adresi eksik")
      }
    } else if (formData.supplierId) {
      const su = suppliers.find((s) => s.id === formData.supplierId)
      if (su) {
        if (!su.taxNumber?.trim()) messages.push("Tedarikçi vergi numarası eksik")
        if (!su.taxOffice?.trim()) messages.push("Tedarikçi vergi dairesi eksik")
        if (!su.address?.trim()) messages.push("Tedarikçi adresi eksik")
      }
    }
    return Array.from(new Set(messages))
  }, [
    isEDonusumActive,
    effectiveInvoiceType,
    formData.customerId,
    formData.supplierId,
    companySettings,
    customers,
    suppliers,
  ])

  const handleSubmit = async () => {
    if (items.length === 0 || items.every((item) => !item.description)) {
      toast({
        title: "Hata",
        description: "En az bir kalem ekleyin",
        variant: "destructive",
      })
      return
    }

    if (!formData.customerId && !formData.supplierId) {
      toast({
        title: "Hata",
        description: "Müşteri veya tedarikçi seçin",
        variant: "destructive",
      })
      return
    }

    if (isEDonusumActive && E_DOC_TYPES.has(effectiveInvoiceType) && eInvoiceMissingMessages.length > 0) {
      toast({
        title: "E-fatura için eksik bilgi",
        description: eInvoiceMissingMessages.join(" · "),
        variant: "destructive",
      })
      return
    }

    setIsLoading(true)
    try {
      const isEditing = Boolean(editingInvoiceId)
      const response = await fetch(
        isEditing ? `/api/e-donusum/invoices/${editingInvoiceId}` : "/api/e-donusum/invoices",
        {
          method: isEditing ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId,
            ...formData,
            invoiceType: effectiveInvoiceType,
            items: items.filter((item) => item.description),
          }),
        }
      )

      if (response.ok) {
        toast({
          title: "Başarılı",
          description: isEditing ? "Fatura güncellendi" : "Fatura oluşturuldu",
        })
        resetForm()
        router.push(listHref)
      } else {
        const data = await response.json()
        throw new Error(data.error || "Oluşturulamadı")
      }
    } catch (error: any) {
      toast({
        title: "Hata",
        description: error.message || "Bir hata oluştu",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }

  const totals = calculateTotals()
  const isEditMode = mode === "edit" && editingInvoiceId

  if (bootstrappingEdit) {
    return (
      <div className="flex items-center justify-center p-12 text-muted-foreground">
        Fatura yükleniyor…
      </div>
    )
  }

  return (
    <Card className="w-full min-w-0">
      <CardHeader>
        <CardTitle>{isEditMode ? "Fatura Düzenle" : "Yeni Fatura Oluştur"}</CardTitle>
        <CardDescription>
          {isEditMode ? "Fatura bilgilerini güncelleyin ve kalemlerini düzenleyin" : "Fatura bilgilerini girin ve kalemlerini ekleyin"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isEDonusumActive && E_DOC_TYPES.has(effectiveInvoiceType) && eInvoiceMissingMessages.length > 0 && (
          <div
            role="alert"
            className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
          >
            <p className="font-semibold">E-fatura / E-arşiv için eksik alanlar</p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              {eInvoiceMissingMessages.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href={`/ayarlar/firma?company=${encodeURIComponent(companyId)}`}>Firma ayarları</Link>
              </Button>
              {formData.type === "SALES" && formData.customerId ? (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/cari/customers/${formData.customerId}?company=${encodeURIComponent(companyId)}`}>
                    Müşteriyi düzenle
                  </Link>
                </Button>
              ) : null}
              {formData.type === "PURCHASE" && formData.supplierId ? (
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/cari/suppliers/${formData.supplierId}?company=${encodeURIComponent(companyId)}`}>
                    Tedarikçiyi düzenle
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="space-y-2">
            <Label>Fatura Tipi</Label>
            <Select
              value={formData.type}
              onValueChange={(value) => setFormData({ ...formData, type: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="SALES">Satış Faturası</SelectItem>
                <SelectItem value="PURCHASE">Alış Faturası</SelectItem>
                <SelectItem value="RETURN">İade Faturası</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Fatura Türü</Label>
            <Select
              value={effectiveInvoiceType}
              onValueChange={(value) => setFormData({ ...formData, invoiceType: value })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MANUAL">Manuel</SelectItem>
                {isEDonusumActive && <SelectItem value="E_ARCHIVE">E-Arşiv</SelectItem>}
                {isEDonusumActive && <SelectItem value="E_INVOICE">E-Fatura</SelectItem>}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Fatura Tarihi</Label>
            <Input type="date" value={formData.date} onChange={(e) => setFormData({ ...formData, date: e.target.value })} />
          </div>

          <div className="space-y-2">
            <Label>Vade Tarihi</Label>
            <Input type="date" value={formData.dueDate} onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })} />
          </div>
          <div className="space-y-2">
            <Label>Para Birimi</Label>
            <Input value={(formData as any).currency} disabled readOnly />
          </div>
          <div className="space-y-2">
            <Label>Döviz Kuru</Label>
            <Input type="number" step="0.0001" value={(formData as any).exchangeRate} disabled readOnly />
          </div>
          <div className="space-y-2">
            <Label>Kur Tarihi</Label>
            <Input type="date" value={(formData as any).exchangeRateDate} disabled readOnly />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Müşteri / Tedarikçi</Label>
          <Select
            value={formData.customerId ? `c:${formData.customerId}` : formData.supplierId ? `s:${formData.supplierId}` : ""}
            onValueChange={(value) => {
              if (value.startsWith("c:")) {
                setFormData({ ...formData, customerId: value.slice(2), supplierId: "" })
              } else if (value.startsWith("s:")) {
                setFormData({ ...formData, customerId: "", supplierId: value.slice(2) })
              } else {
                setFormData({ ...formData, customerId: "", supplierId: "" })
              }
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Müşteri veya tedarikçi seçin" />
            </SelectTrigger>
            <SelectContent>
              {customers.length > 0 ? (
                <div className="px-2 pb-1 pt-2 text-xs font-semibold text-muted-foreground">Müşteriler</div>
              ) : null}
              {customers.map((customer) => (
                <SelectItem key={`c-${customer.id}`} value={`c:${customer.id}`}>
                  {customer.name} {customer.taxNumber && `(${customer.taxNumber})`}
                </SelectItem>
              ))}
              {suppliers.length > 0 ? (
                <div className="mt-1 px-2 pb-1 pt-2 text-xs font-semibold text-muted-foreground">Tedarikçiler</div>
              ) : null}
              {suppliers.map((supplier) => (
                <SelectItem key={`s-${supplier.id}`} value={`s:${supplier.id}`}>
                  {supplier.name} {supplier.taxNumber && `(${supplier.taxNumber})`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-base font-semibold">Fatura Kalemleri</Label>
            <Button type="button" variant="outline" size="sm" onClick={addItem}>
              <Plus className="mr-1 h-4 w-4" />
              Kalem Ekle
            </Button>
          </div>

          <div className="w-full min-w-0 space-y-3 rounded-lg border p-3">
            {items.map((item, index) => {
              const extras = getLineExtras(index)
              const available = LINE_EXTRA_ORDER.filter((k) => !extras.includes(k))
              return (
                <div key={index} className="space-y-2 rounded-md border bg-card p-3 shadow-sm">
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-12 md:items-end">
                    <div className="col-span-2 md:col-span-4">
                      <Label className="text-xs text-muted-foreground">Ürün / Hizmet</Label>
                      <ProductCombobox
                        companyId={companyId}
                        products={products}
                        selectedProductId={item.productId}
                        selectedLabel={item.description}
                        defaults={{
                          unit: item.unit,
                          vatRate: item.vatRate,
                          salePrice: item.unitPrice,
                        }}
                        onSelect={(p) => {
                          mergeProductIntoList(p as Product)
                          applyProductToLine(index, p as Product)
                        }}
                        onClearBinding={() => updateItem(index, "productId", undefined)}
                      />
                    </div>
                    <div className="col-span-1 md:col-span-1">
                      <Label className="text-xs text-muted-foreground">Birim</Label>
                      <Select
                        value={(item.unit || "ADET").toUpperCase()}
                        onValueChange={(value) => updateItem(index, "unit", value)}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {INVOICE_UNIT_OPTIONS.map((u) => (
                            <SelectItem key={u} value={u}>
                              {u}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-1 md:col-span-1">
                      <Label className="text-xs text-muted-foreground">Miktar</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.quantity || ""}
                        onChange={(e) =>
                          updateItem(index, "quantity", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)
                        }
                        onFocus={(e) => (e.target as HTMLInputElement).select()}
                      />
                    </div>
                    <div className="col-span-1 md:col-span-2">
                      <Label className="text-xs text-muted-foreground">Birim fiyat</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.unitPrice || ""}
                        onChange={(e) =>
                          updateItem(index, "unitPrice", e.target.value === "" ? 0 : parseFloat(e.target.value) || 0)
                        }
                        onFocus={(e) => (e.target as HTMLInputElement).select()}
                      />
                    </div>
                    <div className="col-span-1 md:col-span-1">
                      <Label className="text-xs text-muted-foreground">KDV %</Label>
                      <Select value={String(item.vatRate)} onValueChange={(value) => updateItem(index, "vatRate", parseFloat(value))}>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0">%0</SelectItem>
                          <SelectItem value="1">%1</SelectItem>
                          <SelectItem value="8">%8</SelectItem>
                          <SelectItem value="10">%10</SelectItem>
                          <SelectItem value="18">%18</SelectItem>
                          <SelectItem value="20">%20</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="col-span-1 text-right md:col-span-2">
                      <Label className="text-xs text-muted-foreground">Tutar</Label>
                      <div className="flex h-9 items-center justify-end font-medium tabular-nums">
                        ₺
                        {(
                          item.quantity *
                          item.unitPrice *
                          (1 - (item.discountRate || 0) / 100) *
                          (1 + item.vatRate / 100 + (item.exciseRate || 0) / 100 - (item.withholdingRate || 0) / 100)
                        ).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}
                      </div>
                    </div>
                    <div className="col-span-2 flex items-center justify-end gap-1 md:col-span-1 md:justify-center">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={available.length === 0}
                            title="Alan ekle"
                          >
                            <Plus className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {available.map((key) => (
                            <DropdownMenuItem
                              key={key}
                              onSelect={(e) => {
                                e.preventDefault()
                                addLineExtra(index, key)
                              }}
                            >
                              {LINE_EXTRA_LABEL[key]}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeItem(index)}
                        disabled={items.length === 1}
                        title="Satırı sil"
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </div>
                  {extras.length > 0 ? (
                    <div className="grid grid-cols-1 gap-2 border-t pt-2 sm:grid-cols-2 md:grid-cols-12 md:items-end">
                      {LINE_EXTRA_ORDER.filter((k) => extras.includes(k)).map((key) => {
                        const removable = (
                          <button
                            type="button"
                            className="ml-1 inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                            onClick={() => removeLineExtra(index, key)}
                            title="Alanı kaldır"
                            aria-label="Alanı kaldır"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )
                        if (key === "description") {
                          return (
                            <div key={key} className="md:col-span-12">
                              <div className="mb-1 flex items-center">
                                <Label className="text-xs text-muted-foreground">Satır açıklaması (zorunlu)</Label>
                                {removable}
                              </div>
                              <Input
                                value={item.description}
                                onChange={(e) => updateItem(index, "description", e.target.value)}
                                placeholder="Bu satır için açıklama"
                                required
                              />
                            </div>
                          )
                        }
                        const numericProps =
                          key === "discountRate"
                            ? {
                                label: "Satır iskontosu (%)",
                                value: item.discountRate || "",
                                onChange: (v: string) =>
                                  updateItem(index, "discountRate", v === "" ? 0 : parseFloat(v) || 0),
                              }
                            : key === "withholdingRate"
                              ? {
                                  label: "Satır tevkifatı (%)",
                                  value: item.withholdingRate || "",
                                  onChange: (v: string) =>
                                    updateItem(index, "withholdingRate", v === "" ? 0 : parseFloat(v) || 0),
                                }
                              : {
                                  label: "Satır ÖTV (%)",
                                  value: item.exciseRate || "",
                                  onChange: (v: string) =>
                                    updateItem(index, "exciseRate", v === "" ? 0 : parseFloat(v) || 0),
                                }
                        return (
                          <div key={key} className="md:col-span-4">
                            <div className="mb-1 flex items-center">
                              <Label className="text-xs text-muted-foreground">{numericProps.label}</Label>
                              {removable}
                            </div>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={numericProps.value}
                              onChange={(e) => numericProps.onChange(e.target.value)}
                              onFocus={(e) => (e.target as HTMLInputElement).select()}
                            />
                          </div>
                        )
                      })}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>

          <div className="flex justify-end">
            <div className="w-64 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Ara Toplam:</span>
                <span>₺{totals.netAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">KDV Toplam:</span>
                <span>₺{totals.vatAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Iskonto:</span>
                <span>- ₺{totals.discountAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between border-t pt-2 text-lg font-bold">
                <span>Genel Toplam:</span>
                <span className="text-green-600">₺{totals.totalAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tevkifat:</span>
                <span>- ₺{totals.withholdingAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">OTV:</span>
                <span>+ ₺{totals.exciseAmount.toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Notlar</Label>
          <Textarea
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            placeholder="Fatura ile ilgili notlar..."
            rows={3}
          />
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          <Button
            variant="outline"
            onClick={() => {
              resetForm()
              goBack()
            }}
          >
            İptal
          </Button>
          <Button onClick={handleSubmit} disabled={isLoading}>
            {isLoading
              ? editingInvoiceId
                ? "Güncelleniyor..."
                : "Oluşturuluyor..."
              : editingInvoiceId
                ? "Faturayı Güncelle"
                : "Fatura Oluştur"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
