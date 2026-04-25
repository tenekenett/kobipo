"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useToast } from "@/components/ui/use-toast"
import { Plus, Send, Trash2, FileText, Eye } from "lucide-react"
import Link from "next/link"

interface Invoice {
  id: string
  invoiceNo: string
  type: string
  invoiceType: string
  status: string
  date: string
  totalAmount: number
  customer?: { name: string }
  supplier?: { name: string }
  uuid?: string
}

interface Customer {
  id: string
  name: string
  taxNumber?: string
}

interface Supplier {
  id: string
  name: string
  taxNumber?: string
}

interface Product {
  id: string
  name: string
  code?: string
  salePrice?: number
  vatRate: number
}

interface InvoiceItem {
  productId?: string
  description: string
  quantity: number
  unitPrice: number
  vatRate: number
  withholdingRate?: number
  exciseRate?: number
}

interface CompanySettings {
  id: string
  isEDonusumEnabled?: boolean
}

export default function EDönüşümPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const manualMode = searchParams.get("manual") === "1"
  const { toast } = useToast()
  
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [companySettings, setCompanySettings] = useState<CompanySettings | null>(null)
  
  // Form state
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
    { description: "", quantity: 1, unitPrice: 0, vatRate: 20, withholdingRate: 0, exciseRate: 0 }
  ])

  useEffect(() => {
    if (companyId) {
      fetchInvoices()
      fetchCustomers()
      fetchSuppliers()
      fetchProducts()
      fetchCompanySettings()
    }
  }, [companyId])

  useEffect(() => {
    if (manualMode) {
      setFormData((prev) => ({ ...prev, invoiceType: "MANUAL" }))
      setIsModalOpen(true)
    }
  }, [manualMode])

  const fetchInvoices = async () => {
    if (!companyId) return
    try {
      const response = await fetch(`/api/e-donusum/invoices?companyId=${companyId}`)
      if (response.ok) {
        const data = await response.json()
        setInvoices(data)
      }
    } catch (error) {
      console.error("Error fetching invoices:", error)
    }
  }

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

  const handleSendInvoice = async (invoiceId: string) => {
    if (!confirm("Faturayı göndermek istediğinize emin misiniz?")) {
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch(`/api/e-donusum/invoices/${invoiceId}`, {
        method: "POST",
      })

      if (response.ok) {
        toast({
          title: "Başarılı",
          description: "Fatura gönderildi",
        })
        fetchInvoices()
      } else {
        const data = await response.json()
        throw new Error(data.error || "Gönderilemedi")
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

  const addItem = () => {
    setItems([...items, { description: "", quantity: 1, unitPrice: 0, vatRate: 20, withholdingRate: 0, exciseRate: 0 }])
  }

  const removeItem = (index: number) => {
    if (items.length > 1) {
      setItems(items.filter((_, i) => i !== index))
    }
  }

  const updateItem = (index: number, field: keyof InvoiceItem, value: any) => {
    const newItems = [...items]
    newItems[index] = { ...newItems[index], [field]: value }
    setItems(newItems)
  }

  const selectProduct = (index: number, productId: string) => {
    const product = products.find(p => p.id === productId)
    if (product) {
      const newItems = [...items]
      newItems[index] = {
        ...newItems[index],
        productId: product.id,
        description: product.name,
        unitPrice: Number(product.salePrice) || 0,
        vatRate: Number(product.vatRate) || 20,
        withholdingRate: 0,
        exciseRate: 0,
      }
      setItems(newItems)
    }
  }

  const calculateTotals = () => {
    let netAmount = 0
    let vatAmount = 0
    let withholdingAmount = 0
    let exciseAmount = 0
    
    items.forEach(item => {
      const itemNet = item.quantity * item.unitPrice
      const itemVat = itemNet * (item.vatRate / 100)
      const itemWithholding = itemNet * ((item.withholdingRate || 0) / 100)
      const itemExcise = itemNet * ((item.exciseRate || 0) / 100)
      netAmount += itemNet
      vatAmount += itemVat
      withholdingAmount += itemWithholding
      exciseAmount += itemExcise
    })
    
    return {
      netAmount,
      vatAmount,
      withholdingAmount,
      exciseAmount,
      totalAmount: netAmount + vatAmount + exciseAmount - withholdingAmount,
    }
  }

  const handleSubmit = async () => {
    if (items.length === 0 || items.every(item => !item.description)) {
      toast({
        title: "Hata",
        description: "En az bir kalem ekleyin",
        variant: "destructive",
      })
      return
    }

    if (formData.type === "SALES" && !formData.customerId) {
      toast({
        title: "Hata",
        description: "Müşteri seçin",
        variant: "destructive",
      })
      return
    }

    if (formData.type === "PURCHASE" && !formData.supplierId) {
      toast({
        title: "Hata",
        description: "Tedarikçi seçin",
        variant: "destructive",
      })
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch("/api/e-donusum/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          ...formData,
          items: items.filter(item => item.description),
        }),
      })

      if (response.ok) {
        toast({
          title: "Başarılı",
          description: "Fatura oluşturuldu",
        })
        setIsModalOpen(false)
        resetForm()
        fetchInvoices()
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

  const resetForm = () => {
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
    setItems([{ description: "", quantity: 1, unitPrice: 0, vatRate: 20, withholdingRate: 0, exciseRate: 0 }])
  }

  const totals = calculateTotals()

  if (!companyId) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-muted-foreground">Lütfen bir firma seçin</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">E-Dönüşüm</h1>
          <p className="text-muted-foreground">
            E-Fatura ve E-Arşiv fatura yönetimi
          </p>
        </div>
        <Button onClick={() => setIsModalOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Yeni Fatura
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Faturalar</CardTitle>
          <CardDescription>
            Toplam {invoices.length} fatura
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fatura No</TableHead>
                <TableHead>Tip</TableHead>
                <TableHead>Tür</TableHead>
                <TableHead>Tarih</TableHead>
                <TableHead>Müşteri/Tedarikçi</TableHead>
                <TableHead className="text-right">Tutar</TableHead>
                <TableHead>Durum</TableHead>
                <TableHead>İşlemler</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">
                    <FileText className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
                    <p className="text-muted-foreground">Henüz fatura oluşturulmamış</p>
                    <Button variant="link" onClick={() => setIsModalOpen(true)}>
                      İlk faturanızı oluşturun
                    </Button>
                  </TableCell>
                </TableRow>
              ) : (
                invoices.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-medium">{invoice.invoiceNo}</TableCell>
                    <TableCell>
                      {invoice.type === "SALES" ? "Satış" : "Alış"}
                    </TableCell>
                    <TableCell>
                      {invoice.invoiceType === "E_INVOICE" ? "E-Fatura" : "E-Arşiv"}
                    </TableCell>
                    <TableCell>
                      {new Date(invoice.date).toLocaleDateString("tr-TR")}
                    </TableCell>
                    <TableCell>
                      {invoice.customer?.name || invoice.supplier?.name || "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      {new Intl.NumberFormat("tr-TR", {
                        style: "currency",
                        currency: "TRY",
                      }).format(Number(invoice.totalAmount))}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`px-2 py-1 rounded text-xs ${
                          invoice.status === "SENT"
                            ? "bg-green-100 text-green-800"
                            : invoice.status === "DRAFT"
                            ? "bg-yellow-100 text-yellow-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {invoice.status === "SENT"
                          ? "Gönderildi"
                          : invoice.status === "DRAFT"
                          ? "Taslak"
                          : invoice.status}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center space-x-2">
                        <Link href={`/e-donusum/${invoice.id}?company=${companyId}`}>
                          <Button variant="outline" size="sm">
                            <Eye className="mr-1 h-3 w-3" />
                            Önizle
                          </Button>
                        </Link>
                        {invoice.status === "DRAFT" &&
                          invoice.type === "SALES" &&
                          (invoice.invoiceType === "E_INVOICE" ||
                            invoice.invoiceType === "E_ARCHIVE") && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleSendInvoice(invoice.id)}
                              disabled={isLoading}
                            >
                              <Send className="mr-1 h-3 w-3" />
                              Gönder
                            </Button>
                          )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Fatura Oluşturma Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Yeni Fatura Oluştur</DialogTitle>
            <DialogDescription>
              Fatura bilgilerini girin ve kalemlerini ekleyin
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* Fatura Bilgileri */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-2">
                <Label>Fatura Tipi</Label>
                <Select
                  value={formData.type}
                  onValueChange={(value) => setFormData({ ...formData, type: value, customerId: "", supplierId: "" })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SALES">Satış Faturası</SelectItem>
                    <SelectItem value="PURCHASE">Alış Faturası</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Fatura Türü</Label>
                <Select
                  value={formData.invoiceType}
                  onValueChange={(value) => setFormData({ ...formData, invoiceType: value })}
                  disabled={companySettings ? !companySettings.isEDonusumEnabled : false}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MANUAL">Manuel</SelectItem>
                    <SelectItem value="E_ARCHIVE">E-Arşiv</SelectItem>
                    <SelectItem value="E_INVOICE">E-Fatura</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Fatura Tarihi</Label>
                <Input
                  type="date"
                  value={formData.date}
                  onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label>Vade Tarihi</Label>
                <Input
                  type="date"
                  value={formData.dueDate}
                  onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Para Birimi</Label>
                <Input value={(formData as any).currency} onChange={(e) => setFormData({ ...(formData as any), currency: e.target.value.toUpperCase() })} />
              </div>
              <div className="space-y-2">
                <Label>Döviz Kuru</Label>
                <Input type="number" step="0.0001" value={(formData as any).exchangeRate} onChange={(e) => setFormData({ ...(formData as any), exchangeRate: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Kur Tarihi</Label>
                <Input type="date" value={(formData as any).exchangeRateDate} onChange={(e) => setFormData({ ...(formData as any), exchangeRateDate: e.target.value })} />
              </div>
            </div>

            {/* Müşteri/Tedarikçi Seçimi */}
            <div className="space-y-2">
              <Label>{formData.type === "SALES" ? "Müşteri" : "Tedarikçi"}</Label>
              {formData.type === "SALES" ? (
                <Select
                  value={formData.customerId}
                  onValueChange={(value) => setFormData({ ...formData, customerId: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Müşteri seçin" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((customer) => (
                      <SelectItem key={customer.id} value={customer.id}>
                        {customer.name} {customer.taxNumber && `(${customer.taxNumber})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Select
                  value={formData.supplierId}
                  onValueChange={(value) => setFormData({ ...formData, supplierId: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Tedarikçi seçin" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((supplier) => (
                      <SelectItem key={supplier.id} value={supplier.id}>
                        {supplier.name} {supplier.taxNumber && `(${supplier.taxNumber})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Fatura Kalemleri */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-base font-semibold">Fatura Kalemleri</Label>
                <Button type="button" variant="outline" size="sm" onClick={addItem}>
                  <Plus className="mr-1 h-4 w-4" />
                  Kalem Ekle
                </Button>
              </div>

              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/50">
                      <TableHead className="w-[200px]">Ürün/Hizmet</TableHead>
                      <TableHead>Açıklama</TableHead>
                      <TableHead className="w-[100px]">Miktar</TableHead>
                      <TableHead className="w-[120px]">Birim Fiyat</TableHead>
                      <TableHead className="w-[100px]">KDV %</TableHead>
                      <TableHead className="w-[110px]">Tevkifat %</TableHead>
                      <TableHead className="w-[90px]">OTV %</TableHead>
                      <TableHead className="w-[120px] text-right">Tutar</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          <div className="flex gap-2">
                            <Select
                              value={item.productId || "manual"}
                              onValueChange={(value) => {
                                if (value === "manual") {
                                  // Manuel giriş modu
                                  const newItems = [...items]
                                  newItems[index] = {
                                    ...newItems[index],
                                    productId: undefined,
                                    description: "",
                                  }
                                  setItems(newItems)
                                } else {
                                  selectProduct(index, value)
                                }
                              }}
                            >
                              <SelectTrigger className="w-[150px]">
                                <SelectValue placeholder="Ürün seç" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="manual">Manuel Giriş</SelectItem>
                                {products.map((product) => (
                                  <SelectItem key={product.id} value={product.id}>
                                    {product.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Input
                            value={item.description}
                            onChange={(e) => updateItem(index, "description", e.target.value)}
                            placeholder="Açıklama (zorunlu)"
                            required
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.quantity}
                            onChange={(e) => updateItem(index, "quantity", parseFloat(e.target.value) || 0)}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.unitPrice}
                            onChange={(e) => updateItem(index, "unitPrice", parseFloat(e.target.value) || 0)}
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={String(item.vatRate)}
                            onValueChange={(value) => updateItem(index, "vatRate", parseFloat(value))}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0">%0</SelectItem>
                              <SelectItem value="1">%1</SelectItem>
                              <SelectItem value="10">%10</SelectItem>
                              <SelectItem value="20">%20</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.withholdingRate || 0}
                            onChange={(e) => updateItem(index, "withholdingRate", parseFloat(e.target.value) || 0)}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.exciseRate || 0}
                            onChange={(e) => updateItem(index, "exciseRate", parseFloat(e.target.value) || 0)}
                          />
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          ₺{(item.quantity * item.unitPrice * (1 + item.vatRate / 100 + (item.exciseRate || 0) / 100 - (item.withholdingRate || 0) / 100)).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeItem(index)}
                            disabled={items.length === 1}
                          >
                            <Trash2 className="h-4 w-4 text-red-500" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Toplamlar */}
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
                  <div className="flex justify-between font-bold text-lg border-t pt-2">
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

            {/* Notlar */}
            <div className="space-y-2">
              <Label>Notlar</Label>
              <Textarea
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Fatura ile ilgili notlar..."
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsModalOpen(false)}>
              İptal
            </Button>
            <Button onClick={handleSubmit} disabled={isLoading}>
              {isLoading ? "Oluşturuluyor..." : "Fatura Oluştur"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
