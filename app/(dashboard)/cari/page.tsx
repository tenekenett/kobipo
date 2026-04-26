"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"
import { Plus, Search, Eye, AlertCircle, Pencil, Trash2 } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import Link from "next/link"

interface Customer {
  id: string
  code?: string
  name: string
  taxNumber?: string
  email?: string
  phone?: string
  balance?: number
  paymentDueDays?: number
  isAlsoSupplier?: boolean
  isAlsoCustomer?: boolean
}

export default function CariPage() {
  const searchParams = useSearchParams()
  const companyId = searchParams.get("company")
  const editId = searchParams.get("edit")
  const tabQuery = searchParams.get("tab")
  const { toast } = useToast()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [suppliers, setSuppliers] = useState<Customer[]>([])
  const [activeTab, setActiveTab] = useState<"customers" | "suppliers">(
    tabQuery === "suppliers" ? "suppliers" : "customers"
  )
  const [search, setSearch] = useState("")
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [formData, setFormData] = useState({
    code: "",
    name: "",
    taxNumber: "",
    taxOffice: "",
    address: "",
    city: "",
    phone: "",
    email: "",
    contactPerson: "",
    paymentDueDays: "",
    isAlsoSupplier: false,
    isAlsoCustomer: false,
  })

  useEffect(() => {
    if (companyId) {
      fetchData()
    }
  }, [companyId, activeTab, search])

  const fetchData = async () => {
    if (!companyId) return

    try {
      const endpoint = activeTab === "customers" ? "customers" : "suppliers"
      const response = await fetch(
        `/api/cari/${endpoint}?companyId=${companyId}&search=${search}`
      )
      if (response.ok) {
        const data = await response.json()
        if (activeTab === "customers") {
          setCustomers(data)
        } else {
          setSuppliers(data)
        }
      }
    } catch (error) {
      console.error("Error fetching data:", error)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!companyId) return

    setIsLoading(true)
    try {
      const endpoint = activeTab === "customers" ? "customers" : "suppliers"
      const response = await fetch(`/api/cari/${endpoint}${editingId ? `/${editingId}` : ""}`, {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formData, companyId }),
      })

      if (response.ok) {
        toast({
          title: "Başarılı",
          description: `${activeTab === "customers" ? "Müşteri" : "Tedarikçi"} ${editingId ? "güncellendi" : "oluşturuldu"}`,
        })
        setIsDialogOpen(false)
        setEditingId(null)
        setFormData({
          code: "",
          name: "",
          taxNumber: "",
          taxOffice: "",
          address: "",
          city: "",
          phone: "",
          email: "",
          contactPerson: "",
          paymentDueDays: "",
          isAlsoSupplier: false,
          isAlsoCustomer: false,
        })
        fetchData()
      } else {
        let message = "İşlem tamamlanamadı"
        try {
          const data = await response.json()
          if (typeof data?.error === "string") message = data.error
        } catch {
          /* ignore */
        }
        toast({
          title: "Hata",
          description: message,
          variant: "destructive",
        })
      }
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

  const startEdit = (item: Customer) => {
    setEditingId(item.id)
    setFormData({
      code: item.code || "",
      name: item.name || "",
      taxNumber: item.taxNumber || "",
      taxOffice: "",
      address: "",
      city: "",
      phone: item.phone || "",
      email: item.email || "",
      contactPerson: "",
      paymentDueDays: String(item.paymentDueDays || ""),
      isAlsoSupplier: Boolean(item.isAlsoSupplier),
      isAlsoCustomer: Boolean(item.isAlsoCustomer),
    })
    setIsDialogOpen(true)
  }

  useEffect(() => {
    if (!editId) return
    const list = activeTab === "customers" ? customers : suppliers
    const item = list.find((entry) => entry.id === editId)
    if (item) {
      startEdit(item)
    }
  }, [editId, activeTab, customers, suppliers])

  const deleteItem = async (id: string) => {
    if (!confirm("Bu kaydı silmek istediğinize emin misiniz?")) return
    const endpoint = activeTab === "customers" ? "customers" : "suppliers"
    const response = await fetch(`/api/cari/${endpoint}/${id}`, { method: "DELETE" })
    if (response.ok) {
      toast({ title: "Başarılı", description: "Kayıt silindi" })
      fetchData()
    } else {
      let message = "Kayıt silinemedi"
      try {
        const data = await response.json()
        if (typeof data?.error === "string") message = data.error
      } catch {
        /* ignore */
      }
      toast({ title: "Hata", description: message, variant: "destructive" })
    }
  }

  const currentData = activeTab === "customers" ? customers : suppliers
  const agingRows = currentData
    .filter((item) => Number(item.balance || 0) !== 0)
    .map((item) => {
      const dueDays = Number(item.paymentDueDays || 0)
      const bucket = dueDays <= 30 ? "0-30" : dueDays <= 60 ? "31-60" : dueDays <= 90 ? "61-90" : "90+"
      return { ...item, dueDays, bucket }
    })

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
          <h1 className="text-3xl font-bold">Cari Hesaplar</h1>
          <p className="text-muted-foreground">
            Müşteri ve tedarikçi yönetimi
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
                Yeni {activeTab === "customers" ? "Müşteri" : "Tedarikçi"}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingId ? "Kaydı Düzenle" : `Yeni ${activeTab === "customers" ? "Müşteri" : "Tedarikçi"}`}
              </DialogTitle>
              <DialogDescription>
                {activeTab === "customers" ? "Müşteri" : "Tedarikçi"} bilgilerini
                girin
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="code">Kod</Label>
                  <Input
                    id="code"
                    value={formData.code}
                    onChange={(e) =>
                      setFormData({ ...formData, code: e.target.value })
                    }
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="name">Ad *</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    required
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="taxNumber">Vergi No</Label>
                  <Input
                    id="taxNumber"
                    value={formData.taxNumber}
                    onChange={(e) =>
                      setFormData({ ...formData, taxNumber: e.target.value })
                    }
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="taxOffice">Vergi Dairesi</Label>
                  <Input
                    id="taxOffice"
                    value={formData.taxOffice}
                    onChange={(e) =>
                      setFormData({ ...formData, taxOffice: e.target.value })
                    }
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Telefon</Label>
                  <Input
                    id="phone"
                    type="tel"
                    value={formData.phone}
                    onChange={(e) =>
                      setFormData({ ...formData, phone: e.target.value })
                    }
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    value={formData.email}
                    onChange={(e) =>
                      setFormData({ ...formData, email: e.target.value })
                    }
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="address">Adres</Label>
                  <Input
                    id="address"
                    value={formData.address}
                    onChange={(e) =>
                      setFormData({ ...formData, address: e.target.value })
                    }
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="city">Şehir</Label>
                  <Input
                    id="city"
                    value={formData.city}
                    onChange={(e) =>
                      setFormData({ ...formData, city: e.target.value })
                    }
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="contactPerson">İletişim Kişisi</Label>
                  <Input
                    id="contactPerson"
                    value={formData.contactPerson}
                    onChange={(e) =>
                      setFormData({ ...formData, contactPerson: e.target.value })
                    }
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="paymentDueDays">Vade Günü</Label>
                  <Input
                    id="paymentDueDays"
                    type="number"
                    min="0"
                    value={formData.paymentDueDays}
                    onChange={(e) =>
                      setFormData({ ...formData, paymentDueDays: e.target.value })
                    }
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-3 md:col-span-2 rounded-md border p-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="linked-role-switch">
                      {activeTab === "customers" ? "Aynı zamanda Tedarikçi" : "Aynı zamanda Müşteri"}
                    </Label>
                    <Switch
                      id="linked-role-switch"
                      checked={
                        activeTab === "customers"
                          ? formData.isAlsoSupplier
                          : formData.isAlsoCustomer
                      }
                      onCheckedChange={(checked) =>
                        setFormData({
                          ...formData,
                          isAlsoSupplier: activeTab === "customers" ? checked : false,
                          isAlsoCustomer: activeTab === "suppliers" ? checked : false,
                        })
                      }
                      disabled={isLoading}
                    />
                  </div>
                  <p className="flex items-start gap-2 text-xs text-muted-foreground">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    {activeTab === "customers"
                      ? "Bu seçenek ile müşteri hesabını aynı zamanda tedarikçi hesabı olarak tek hesap düzeninde takip edebilirsiniz."
                      : "Bu seçenek ile tedarikçi hesabını aynı zamanda müşteri hesabı olarak tek hesap düzeninde takip edebilirsiniz."}
                  </p>
                </div>
              </div>
              <div className="flex justify-end space-x-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsDialogOpen(false)
                    setEditingId(null)
                  }}
                  disabled={isLoading}
                >
                  İptal
                </Button>
                <Button type="submit" disabled={isLoading}>
                  {isLoading ? "Kaydediliyor..." : "Kaydet"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex space-x-2 border-b">
        <Button
          variant={activeTab === "customers" ? "default" : "ghost"}
          onClick={() => setActiveTab("customers")}
        >
          Müşteriler
        </Button>
        <Button
          variant={activeTab === "suppliers" ? "default" : "ghost"}
          onClick={() => setActiveTab("suppliers")}
        >
          Tedarikçiler
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>
                {activeTab === "customers" ? "Müşteriler" : "Tedarikçiler"}
              </CardTitle>
              <CardDescription>
                Toplam {currentData.length} kayıt
              </CardDescription>
            </div>
            <div className="flex items-center space-x-2">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Ara..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 w-64"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kod</TableHead>
                <TableHead>Ad</TableHead>
                <TableHead>Vergi No</TableHead>
                <TableHead>Telefon</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="text-right">Bakiye</TableHead>
                <TableHead>İşlem</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {currentData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center">
                    Kayıt bulunamadı
                  </TableCell>
                </TableRow>
              ) : (
                currentData.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.code || "-"}</TableCell>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>{item.taxNumber || "-"}</TableCell>
                    <TableCell>{item.phone || "-"}</TableCell>
                    <TableCell>{item.email || "-"}</TableCell>
                    <TableCell className="text-right">
                      {item.balance !== undefined
                        ? new Intl.NumberFormat("tr-TR", {
                            style: "currency",
                            currency: "TRY",
                          }).format(item.balance)
                        : "-"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Link href={`/cari/${activeTab}/${item.id}?company=${companyId}`}>
                          <Button variant="ghost" size="sm">
                            <Eye className="h-4 w-4 mr-1" />
                            Detay
                          </Button>
                        </Link>
                        <Button variant="ghost" size="sm" onClick={() => startEdit(item)}>
                          <Pencil className="h-4 w-4 mr-1" />
                          Düzenle
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => deleteItem(item.id)}>
                          <Trash2 className="h-4 w-4 mr-1 text-red-600" />
                          Sil
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cari Yaşlandırma</CardTitle>
          <CardDescription>
            Vade günü ve bakiyeye göre yaşlandırma görünümü
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Hesap</TableHead>
                <TableHead>Vade Günü</TableHead>
                <TableHead>Yaşlandırma Dilimi</TableHead>
                <TableHead className="text-right">Bakiye</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agingRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    Yaşlandırma için bakiye verisi bulunamadı
                  </TableCell>
                </TableRow>
              ) : (
                agingRows.map((row) => (
                  <TableRow key={`aging-${row.id}`}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>{row.dueDays}</TableCell>
                    <TableCell>{row.bucket} gün</TableCell>
                    <TableCell className="text-right">
                      {new Intl.NumberFormat("tr-TR", {
                        style: "currency",
                        currency: "TRY",
                      }).format(Number(row.balance || 0))}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

